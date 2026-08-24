const { spawn } = require('child_process');
const { create: createYoutubeDl } = require('youtube-dl-exec');
const { getYoutubeiInstance } = require('discord-player-youtubei');
const database = require('./database');
const Jinter = require('jintr').default;
const {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');

const { expectLeave } = require('./utils/voice-departure');
const { setCurrentTrack, clearCurrentTrack } = require('./utils/now-playing');

const IDLE_MUSIC_URL = process.env.IDLE_MUSIC_URL || 'https://lofi.stream.laut.fm/lofi';
const log = require('./utils/logger')('idle-live');

const RECONNECT_GRACE_MS = 5000;
const IDLE_FALLBACK_THUMBNAIL = process.env.IDLE_THUMBNAIL_URL || null;

function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

const ffmpegPath = resolveFfmpegPath();

const youtubedl = process.env.YTDLP_PATH
  ? createYoutubeDl(process.env.YTDLP_PATH)
  : require('youtube-dl-exec');

function debugAudioLog(...parts) {
  log.debug(...parts);
}

function getSessionsMap(client) {
  if (!client.idleLiveSessions) client.idleLiveSessions = new Map();
  return client.idleLiveSessions;
}

function isYouTubeUrl(url) {
  try {
    const raw = new URL(String(url)).hostname.toLowerCase();
    const host = raw.startsWith('www.') ? raw.slice(4) : raw;
    return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

async function resolveViaYoutubei(url) {
  const innertube = getYoutubeiInstance();
  if (!innertube) throw new Error('the youtubei session is not ready');

  const id = new URL(url).searchParams.get('v') || url.split('/').pop();
  const info = await innertube.getBasicInfo(id);

  const hls = info?.streaming_data?.hls_manifest_url;
  let streamUrl = hls;
  if (!streamUrl) {
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    if (format) {
      const js_engine = new Jinter();
      const deciphered = format.decipher(innertube.session.player, js_engine);
      streamUrl = deciphered instanceof Promise ? await deciphered : deciphered;
    }
  }

  if (!streamUrl) throw new Error('no playable format returned');

  return {
    streamUrl,
    title: info.basic_info?.title || 'Idle Live Music',
    author: info.basic_info?.author || 'Unknown',
    thumbnail: info.basic_info?.thumbnail?.[0]?.url || null,
    via: hls ? 'youtubei/hls' : 'youtubei/format'
  };
}

async function resolveViaYtDlp(url) {
  const info = await youtubedl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    skipDownload: true,
    preferFreeFormats: true,
    format: 'bestaudio/best',

    extractorArgs: process.env.YTDLP_EXTRACTOR_ARGS || 'youtube:player_client=tv_embedded,android_vr',

    ...(process.env.YT_COOKIES_FILE ? { cookies: process.env.YT_COOKIES_FILE } : {})
  });

  if (!info?.url) throw new Error('Could not resolve live stream URL.');

  return {
    streamUrl: info.url,
    title: info.title || 'Idle Live Music',
    author: info.uploader || 'Unknown',
    thumbnail: info.thumbnail || info?.thumbnails?.[0]?.url || null,
    via: 'yt-dlp'
  };
}

async function resolveLiveStream(url = IDLE_MUSIC_URL, deps = {}) {
  const viaYoutubei = deps.resolveViaYoutubei || resolveViaYoutubei;
  const viaYtDlp = deps.resolveViaYtDlp || resolveViaYtDlp;

  const hasCredentials = deps.hasCredentials
    ?? Boolean(process.env.YT_COOKIE || process.env.YT_OAUTH);

  if (isYouTubeUrl(url) && hasCredentials) {
    try {
      return await viaYoutubei(url);
    } catch (error) {
      log.warn('Authenticated YouTube path failed, falling back to yt-dlp:', error.message);
    }
  }

  if (!isYouTubeUrl(url)) {
    return {
      streamUrl: url,
      title: '24/7 Lofi Radio',
      author: 'Lofi Stream',
      thumbnail: IDLE_FALLBACK_THUMBNAIL,
      via: 'direct'
    };
  }

  return viaYtDlp(url);
}

async function stopIdleLive(client, guildId, options = {}) {
  const { destroyConnection = true, clearPersisted = true } = options;
  const sessions = getSessionsMap(client);
  const session = sessions.get(guildId);
  if (!session) return false;

  session.stopping = true;
  try {
    if (session.restartTimer) clearTimeout(session.restartTimer);
    session.player?.stop(true);
    session.ffmpeg?.kill('SIGKILL');
    if (destroyConnection) {
      expectLeave(client, guildId);
      session.connection?.destroy();
    }
  } catch (error) {
    log.debug('Teardown step failed:', error.message);
  }

  sessions.delete(guildId);

  if (clearPersisted) {
    try {
      database.setIdleState(guildId, { voiceChannelId: null, textChannelId: null, active: false });
    } catch (error) {
      log.warn('Could not clear persisted idle state:', error.message);
    }
  }

  if (clearCurrentTrack(client, guildId)) {
    client.emit('dashboard:sync');
  }
  debugAudioLog('idle-live:stopped', `guild=${guildId}`);
  return true;
}

async function startIdleLive(client, guild, voiceChannel, textChannel, requestedBy) {
  const sessions = getSessionsMap(client);
  await stopIdleLive(client, guild.id);

  const queue = client.player?.nodes?.get(guild.id);
  if (queue) {
    try { queue.delete(); } catch (error) { log.debug('Existing queue delete failed:', error.message); }
  }

  let connection = getVoiceConnection(guild.id);
  if (connection) {
    expectLeave(client, guild.id);
    try { connection.destroy(); } catch (error) { log.debug('Existing connection destroy failed:', error.message); }
  }

  connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  } catch (error) {
    expectLeave(client, guild.id);
    try { connection.destroy(); } catch { /* already gone */ }
    throw error;
  }

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play }
  });
  connection.subscribe(player);

  const session = {
    guildId: guild.id,
    connection,
    player,
    ffmpeg: null,
    resource: null,
    restartTimer: null,
    stopping: false,
    paused: false,

    consecutiveFailures: 0,
    volume: database.getGuildVolume(guild.id),
    textChannel,
    requestedBy
  };
  sessions.set(guild.id, session);

  const playFromSource = async () => {
    if (session.stopping) return;

    const source = await resolveLiveStream();
    debugAudioLog(
      'idle-live:resolved',
      `guild=${guild.id}`,
      `title=${source.title}`,
      `via=${source.via || 'unknown'}`,
      `stream=${source.streamUrl.slice(0, 96)}...`
    );

    const ffmpeg = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', source.streamUrl,
      '-vn',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    session.ffmpeg?.kill('SIGKILL');
    session.ffmpeg = ffmpeg;

    ffmpeg.stderr.on('data', (chunk) => {
      const line = chunk.toString().trim();
      if (line) log.warn('ffmpeg:', line);
    });

    ffmpeg.on('close', (code) => {
      debugAudioLog('idle-live:ffmpeg-close', `guild=${guild.id}`, `code=${code}`);
    });


    const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    if (resource.volume) {
      resource.volume.setVolume(Math.max(0, Math.min(1, session.volume / 100)));
    }
    session.resource = resource;
    player.play(resource);

    setCurrentTrack(client, guild.id, {
      title: source.title,
      author: source.author,
      url: IDLE_MUSIC_URL,
      thumbnail: source.thumbnail,
      duration: 'LIVE',
      guildId: guild.id,
      requestedBy: requestedBy?.username || requestedBy?.tag || 'Unknown',
      startedAt: Date.now()
    });
    client.emit('dashboard:sync');

    return {
      track: {
        title: source.title,
        author: source.author,
        url: IDLE_MUSIC_URL,
        duration: 'LIVE',
        thumbnail: source.thumbnail
      }
    };
  };

  const scheduleRestart = (reason) => {
    if (session.stopping) return;

    if (session.restartTimer) {
      clearTimeout(session.restartTimer);
      session.restartTimer = null;
    }

    const attempt = session.consecutiveFailures;
    const delay = Math.min(1500 * 2 ** Math.min(attempt, 5), 60000);

    session.restartTimer = setTimeout(async () => {
      if (session.stopping) return;

      session.consecutiveFailures += 1;

      const { notifyOwner, bump } = require('./utils/notify');
      bump('radioRestarts');

      if (session.consecutiveFailures === 3) {
        notifyOwner(
          client,
          'idle-radio-failing',
          `Το ραδιόφωνο στον **${guild.name}** δεν ξαναρχίζει (${reason}) — 3 αποτυχίες στη σειρά.`,
          { fields: [{ name: 'Πηγή', value: String(IDLE_MUSIC_URL).slice(0, 90) }] }
        ).catch(() => {});
      }
      try {
        await playFromSource();
      } catch (error) {
        log.error(
          `idle-live restart failed (attempt ${session.consecutiveFailures}, ${reason}):`,
          error?.message || error
        );

        scheduleRestart(reason);
      }
    }, delay);
  };

  player.on(AudioPlayerStatus.Playing, () => {
    session.consecutiveFailures = 0;
  });

  player.on(AudioPlayerStatus.Idle, () => {
    if (session.stopping) return;
    debugAudioLog('idle-live:player-idle', `guild=${guild.id}`);
    scheduleRestart('stream ended');
  });

  player.on('error', (error) => {
    if (session.stopping) return;
    log.error('idle-live player error:', error?.message || error);
    scheduleRestart('player error');
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    debugAudioLog('idle-live:voice-disconnected', `guild=${guild.id}`);
    if (session.stopping) return;

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_GRACE_MS),
        entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_GRACE_MS)
      ]);
      debugAudioLog('idle-live:voice-reconnecting', `guild=${guild.id}`);
    } catch {
      log.info(`Voice connection for ${guild.id} did not come back — tearing the radio down.`);
      await stopIdleLive(client, guild.id).catch((error) => {
        log.warn('teardown after disconnect failed:', error?.message || error);
      });
    }
  });

  let result;
  try {
    result = await playFromSource();
  } catch (error) {
    log.warn(`Idle radio could not start in ${guild.id}: ${error?.message || error}`);
    await stopIdleLive(client, guild.id).catch(() => {});
    throw error;
  }

  try {
    database.setIdleState(guild.id, {
      voiceChannelId: voiceChannel?.id || null,
      textChannelId: textChannel?.id || null,
      active: true
    });
  } catch (error) {
    log.warn('Could not persist idle state:', error.message);
  }

  client.emit('idle:start', {
    track: {
      ...result.track,
      requestedBy: requestedBy?.username || requestedBy?.tag || 'Unknown'
    },
    channel: textChannel,
    guildId: guild.id
  });

  return result;
}

function isIdleLiveActive(client, guildId) {
  const sessions = getSessionsMap(client);
  const session = sessions.get(guildId);
  if (!session) return false;
  if (session.stopping) return false;

  const status = session.connection?.state?.status || null;
  if (!session.connection || status === 'destroyed') {
    sessions.delete(guildId);
    log.info(`Cleared a stale radio session in ${guildId} (connection ${status || 'missing'}).`);
    return false;
  }

  return true;
}

function getIdleLiveSession(client, guildId) {
  return getSessionsMap(client).get(guildId) || null;
}

function setIdleLiveVolume(client, guildId, volume) {
  const session = getIdleLiveSession(client, guildId);
  if (!session) return false;
  const safe = Math.max(0, Math.min(100, Math.round(Number(volume))));
  session.volume = safe;
  if (session.resource?.volume) {
    session.resource.volume.setVolume(safe / 100);
  }
  return true;
}

function toggleIdleLivePause(client, guildId) {
  const session = getIdleLiveSession(client, guildId);
  if (!session) return null;
  if (session.paused) {
    session.player.unpause();
    session.paused = false;
  } else {
    session.player.pause();
    session.paused = true;
  }
  return { paused: session.paused };
}

module.exports = {
  resolveLiveStream,
  isYouTubeUrl,
  startIdleLive,
  stopIdleLive,
  isIdleLiveActive,
  getIdleLiveSession,
  setIdleLiveVolume,
  toggleIdleLivePause
};
