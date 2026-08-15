const { spawn } = require('child_process');
const { create: createYoutubeDl } = require('youtube-dl-exec');
const database = require('./database');
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

// Πηγή του 24/7 ραδιοφώνου. Δέχεται οτιδήποτε δέχεται το ffmpeg — ένα Icecast
// stream δεν έχει έλεγχο bot και δεν σπάει από datacenter IP, σε αντίθεση με
// το YouTube. Το παλιό hardcoded link μένει ως default για συμβατότητα.
const IDLE_MUSIC_URL = process.env.IDLE_MUSIC_URL || 'https://www.youtube.com/watch?v=4xDzrJKXOOY';
const log = require('./utils/logger')('idle-live');

// ffmpeg-static είναι devDependency: υπάρχει στα Windows για ανάπτυξη, λείπει
// σε production όπου χρησιμοποιούμε το ffmpeg του συστήματος. Αν το είχαμε ως
// κανονική εξάρτηση, το prism-media θα το προτιμούσε ενώ το @discord-player/
// ffmpeg προτιμά το PATH — δηλαδή δύο διαφορετικά binaries στο ίδιο process.
function resolveFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require('ffmpeg-static');
  } catch {
    return 'ffmpeg';
  }
}

const ffmpegPath = resolveFfmpegPath();

// Σε Linux το youtube-dl-exec κατεβάζει το Python zipapp του yt-dlp, όχι το
// static binary — δηλαδή απαιτεί εγκατεστημένη Python. Στον server βάζουμε το
// static binary και το δείχνουμε με YTDLP_PATH.
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

async function resolveLiveStream() {
  const info = await youtubedl(IDLE_MUSIC_URL, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificates: true,
    skipDownload: true,
    preferFreeFormats: true,
    format: 'bestaudio/best',
    // Ο προεπιλεγμένος client του yt-dlp μπλοκάρεται από datacenter IPs με
    // «Sign in to confirm you're not a bot». Το tv_embedded περνάει καθαρά,
    // χωρίς cookies — επιβεβαιωμένο στον server. Αδιάφορο για μη-YouTube πηγές
    // όπως το Icecast, οπότε το περνάμε πάντα.
    extractorArgs: process.env.YTDLP_EXTRACTOR_ARGS || 'youtube:player_client=tv_embedded,android_vr',
    // Το yt-dlp θέλει αρχείο Netscape cookies.txt — διαφορετική μορφή από το
    // YT_COOKIE (raw header) που χρησιμοποιεί το /play. Μην τα μπερδέψεις.
    ...(process.env.YT_COOKIES_FILE ? { cookies: process.env.YT_COOKIES_FILE } : {})
  });

  if (!info?.url) {
    throw new Error('Could not resolve live stream URL.');
  }

  return {
    streamUrl: info.url,
    title: info.title || 'Idle Live Music',
    author: info.uploader || 'Unknown',
    thumbnail: info.thumbnail || info?.thumbnails?.[0]?.url || null
  };
}

/**
 * @param {object} options
 * @param {boolean} [options.destroyConnection=true]
 * @param {boolean} [options.clearPersisted=true] Αν false, η αποθηκευμένη
 *   κατάσταση μένει ώστε το ραδιόφωνο να ξαναρχίσει στην επόμενη εκκίνηση.
 *   Το θέλουμε false στον τερματισμό: κλείνουμε το bot, δεν ακυρώνουμε την
 *   πρόθεση του χρήστη να παίζει μουσική.
 */
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
      session.connection?.destroy();
    }
  } catch (error) {
    // Καθαρισμός: το καθένα μπορεί ήδη να έχει τερματιστεί. Δεν σταματάμε τη
    // διαδικασία, αλλά ούτε το κρύβουμε — ένα ffmpeg που δεν πεθαίνει εδώ
    // γίνεται ορφανή διεργασία.
    log.debug('Teardown step failed:', error.message);
  }

  sessions.delete(guildId);

  if (clearPersisted) {
    // Σταμάτησε επίτηδες — να μην ξαναρχίσει μόνο του στην επόμενη εκκίνηση.
    try {
      database.setIdleState(guildId, { voiceChannelId: null, textChannelId: null, active: false });
    } catch (error) {
      log.warn('Could not clear persisted idle state:', error.message);
    }
  }

  if (client.currentTrack?.guildId === guildId) {
    client.currentTrack = null;
    client.emit('dashboard:sync');
  }
  debugAudioLog('idle-live:stopped', `guild=${guildId}`);
  return true;
}

async function startIdleLive(client, guild, voiceChannel, textChannel, requestedBy) {
  const sessions = getSessionsMap(client);
  await stopIdleLive(client, guild.id);

  // Το ραδιόφωνο παίρνει τον έλεγχο της σύνδεσης φωνής, οπότε ό,τι υπάρχει
  // από πριν πρέπει να φύγει. Αποτυχία σημαίνει συνήθως «ήταν ήδη νεκρό».
  const queue = client.player?.nodes?.get(guild.id);
  if (queue) {
    try { queue.delete(); } catch (error) { log.debug('Existing queue delete failed:', error.message); }
  }

  let connection = getVoiceConnection(guild.id);
  if (connection) {
    try { connection.destroy(); } catch (error) { log.debug('Existing connection destroy failed:', error.message); }
  }

  connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15000);

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
    // Μετρητής για την εκθετική υποχώρηση· μηδενίζεται σε κάθε επιτυχή ροή.
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

    session.ffmpeg = ffmpeg;
    // Το ffmpeg τρέχει με -loglevel error, άρα ό,τι φτάνει εδώ είναι πραγματικό
    // σφάλμα. Παλιότερα φαινόταν μόνο με DEBUG_AUDIO=1 — δηλαδή τα σφάλματα
    // αποκωδικοποίησης του 24/7 ραδιοφώνου ήταν αόρατα από προεπιλογή.
    ffmpeg.stderr.on('data', (chunk) => {
      const line = chunk.toString().trim();
      if (line) log.warn('ffmpeg:', line);
    });

    ffmpeg.on('close', (code) => {
      debugAudioLog('idle-live:ffmpeg-close', `guild=${guild.id}`, `code=${code}`);
    });

    // Φτάσαμε ως εδώ, άρα η πηγή απαντά — καθαρίζουμε την υποχώρηση.
    session.consecutiveFailures = 0;

    const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    if (resource.volume) {
      resource.volume.setVolume(Math.max(0, Math.min(1, session.volume / 100)));
    }
    session.resource = resource;
    player.play(resource);

    client.currentTrack = {
      title: source.title,
      author: source.author,
      url: IDLE_MUSIC_URL,
      thumbnail: source.thumbnail,
      duration: 'LIVE',
      guildId: guild.id,
      requestedBy: requestedBy?.username || requestedBy?.tag || 'Unknown',
      startedAt: Date.now()
    };
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

  /**
   * Επανεκκίνηση της ροής με εκθετική υποχώρηση.
   *
   * Η προηγούμενη έκδοση ξαναπροσπαθούσε κάθε 1,5 δευτερόλεπτο για πάντα. Αν η
   * πηγή πέθαινε (μπλοκαρισμένο YouTube, νεκρό Icecast), αυτό γινόταν ατέρμονος
   * βρόχος που χτυπούσε το yt-dlp δύο φορές το δευτερόλεπτο χωρίς κανένα ίχνος
   * ότι κάτι πάει στραβά.
   */
  const scheduleRestart = (reason) => {
    if (session.stopping) return;
    const attempt = session.consecutiveFailures;
    const delay = Math.min(1500 * 2 ** Math.min(attempt, 5), 60000);

    session.restartTimer = setTimeout(async () => {
      if (session.stopping) return;
      try {
        await playFromSource();
      } catch (error) {
        session.consecutiveFailures += 1;
        log.error(
          `idle-live restart failed (attempt ${session.consecutiveFailures}, ${reason}):`,
          error?.message || error
        );

        const { notifyOwner, bump } = require('./utils/notify');
        bump('radioRestarts');

        if (session.consecutiveFailures === 3) {
          notifyOwner(
            client,
            'idle-radio-failing',
            `Το ραδιόφωνο στον **${guild.name}** απέτυχε να ξαναρχίσει 3 φορές στη σειρά.`,
            {
              fields: [
                { name: 'Πηγή', value: `\`${IDLE_MUSIC_URL.slice(0, 90)}\`` },
                { name: 'Τελευταίο σφάλμα', value: `\`${String(error?.message || error).slice(0, 200)}\`` }
              ]
            }
          ).catch(() => { /* η ειδοποίηση δεν πρέπει να ρίξει τον handler */ });
        }
        scheduleRestart(reason);
      }
    }, delay);
  };

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

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    debugAudioLog('idle-live:voice-disconnected', `guild=${guild.id}`);
  });

  const result = await playFromSource();

  // Αποθηκεύεται ΜΟΝΟ αφού ξεκινήσει όντως η ροή — αλλιώς μια αποτυχημένη
  // εκκίνηση θα ζητούσε επαναφορά σε κάθε επόμενο boot.
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
  return getSessionsMap(client).has(guildId);
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
  startIdleLive,
  stopIdleLive,
  isIdleLiveActive,
  getIdleLiveSession,
  setIdleLiveVolume,
  toggleIdleLivePause
};
