const { QueryType } = require('discord-player');
const { isIdleLiveActive, startIdleLive } = require('../idle-live');
const { hasIdlePending, startNextPendingTrack } = require('../idle-pending');
const { buildNowPlayingEmbed } = require('../utils/embeds');
const { emoji } = require('../utils/emojis');
const { notifyOwner, isYouTubeAuthError, bump } = require('../utils/notify');
const { buildNodeOptions, LEAVE_ON_END_COOLDOWN_MS } = require('../utils/voice');
const { expectLeave, clearExpected } = require('../utils/voice-departure');
const { setCurrentTrack, clearCurrentTrack } = require('../utils/now-playing');
const log = require('../utils/logger')('player');

const SOURCE_NOTE_TTL_MS = 45000;

async function announceSourceSwitch(channel, track) {
  if (!channel) return;

  try {
    const note = await channel.send(
      `${emoji('bot_loop')} Το YouTube αρνήθηκε τη ροή — συνεχίζω από **SoundCloud**: ${track?.title || 'το ίδιο κομμάτι'}`
    );
    setTimeout(() => note.delete().catch(() => {}), SOURCE_NOTE_TTL_MS).unref?.();
  } catch {
    // αν δεν μπορούμε να γράψουμε εκεί, δεν χαλάει η αναπαραγωγή
  }
}

function register({ client, database, player, sync, embeds }) {
  const { emitDashboardSync } = sync;
  const { updateMusicEmbed, deleteMusicEmbed } = embeds;

  player.events.on('playerStart', (queue, track) => {
    clearExpected(client, queue.guild.id);
    client.lastTrackByGuild?.set(queue.guild.id, { title: track.title, author: track.author });

    const announceKey = track.url || `${track.title}|${track.author}`;
    const last = client.lastAnnouncedTrackByGuild.get(queue.guild.id);

    const isDuplicateStart = last && last.key === announceKey && Date.now() - last.at < 45000;

    if (!isDuplicateStart) {
      setImmediate(() => database.logSong(
        track.title, track.author, track.url,
        track.requestedBy?.username || 'Unknown', queue.guild.id
      ));
      client.lastAnnouncedTrackByGuild.set(queue.guild.id, { key: announceKey, at: Date.now() });

      const embed = buildNowPlayingEmbed({
        title: track.title,
        url: track.url,
        author: track.author,
        duration: track.duration,
        thumbnail: track.thumbnail,
        requestedBy: track.requestedBy?.username || track.requestedBy?.tag || 'Unknown'
      });

      if (queue.metadata?.channel && !queue.metadata?.quiet) {
        updateMusicEmbed(queue.guild.id, queue.metadata.channel, embed).catch(() => {});
      }
    }

    const savedVol = database.getGuildVolume(queue.guild.id);
    if (queue.node?.volume !== savedVol) {
      try {
        queue.node.setVolume(savedVol);
      } catch (error) {
        log.warn(`Could not apply saved volume ${savedVol} in guild ${queue.guild.id}:`, error.message);
      }
    }

    setCurrentTrack(client, queue.guild.id, {
      title: track.title,
      author: track.author,
      url: track.url,
      thumbnail: track.thumbnail,
      duration: track.duration,
      guildId: queue.guild.id,
      requestedBy: track.requestedBy?.username || track.requestedBy?.tag || 'Unknown',
      startedAt: Date.now()
    });
    emitDashboardSync();
  });

  client.on('idle:start', ({ track, channel, guildId }) => {
    if (!channel) return;
    const embed = buildNowPlayingEmbed({
      title: track.title,
      url: track.url,
      author: track.author,
      duration: track.duration || 'LIVE',
      thumbnail: track.thumbnail,
      requestedBy: track.requestedBy || 'Unknown'
    });
    updateMusicEmbed(guildId, channel, embed).catch(() => {});
  });

  const SILENT_FAILURE_MS = 5000;
  const startedAt = new Map();

  player.events.on('playerStart', (queue) => startedAt.set(queue.guild.id, Date.now()));

  player.events.on('playerFinish', async (queue, track) => {
    clearCurrentTrack(client, queue?.guild?.id);
    emitDashboardSync();

    const guildId = queue?.guild?.id;
    if (!guildId || !track) return;

    const elapsed = Date.now() - (startedAt.get(guildId) || 0);
    startedAt.delete(guildId);

    const durationMs = Number(track.durationMS) || 0;
    if (elapsed >= SILENT_FAILURE_MS || durationMs < 30000) return;

    const key = `sc:${track.url || track.title}`;
    if (client.trackFallbackAttempts.has(key)) return;
    client.trackFallbackAttempts.add(key);
    setTimeout(() => client.trackFallbackAttempts.delete(key), 300000);

    const query = [track.title, track.author].filter(Boolean).join(' ').trim();
    if (!query || !queue.channel) return;

    bump('ytRefused');
    log.warn(
      `"${track.title}" ended after ${elapsed}ms of ${Math.round(durationMs / 1000)}s — `
      + 'the stream never played. Retrying on SoundCloud.'
    );

    try {
      client.pendingStreamFallbacks += 1;
      const { track: alt } = await client.player.play(queue.channel, query, {
        requestedBy: track.requestedBy || null,
        searchEngine: QueryType.SOUNDCLOUD_SEARCH,
        nodeOptions: buildNodeOptions(database, guildId, queue.metadata)
      });
      bump('soundcloudRescues');

      announceSourceSwitch(queue.metadata?.channel, alt);
    } catch (error) {
      bump('errors');
      log.error('SoundCloud fallback failed:', error.message || error);
      queue.metadata?.channel?.send(`Έλα πάμε λίγο, τώρα παίζει: **${track.title}** στο ραδιόφωνο.`);
    } finally {
      client.pendingStreamFallbacks = Math.max(0, client.pendingStreamFallbacks - 1);
    }
  });
  player.events.on('audioTrackAdd', () => { emitDashboardSync(); });
  player.events.on('audioTracksAdd', () => { emitDashboardSync(); });
  player.events.on('audioTrackRemove', () => { emitDashboardSync(); });
  player.events.on('audioTracksRemove', () => { emitDashboardSync(); });

  player.events.on('emptyQueue', (queue) => {
    if (client.pendingStreamFallbacks > 0) return;
    const guildId = queue?.guild?.id;

    if (guildId && client.emptyQueueTimers.has(guildId)) {
      clearTimeout(client.emptyQueueTimers.get(guildId));
      client.emptyQueueTimers.delete(guildId);
    }

    if (guildId && hasIdlePending(client, guildId)) {
      const voiceChannel = queue.channel || queue.guild?.members?.me?.voice?.channel || null;
      const textChannel = queue.metadata?.channel || null;
      if (voiceChannel) {
        const timer = setTimeout(async () => {
          client.emptyQueueTimers.delete(guildId);
          try {
            await startNextPendingTrack(client, queue.guild, voiceChannel, textChannel);
            emitDashboardSync();
          } catch (error) {
            log.error('Pending-next failed:', error?.message || error);
          }
        }, 0);
        client.emptyQueueTimers.set(guildId, timer);
        return;
      }
      queue.metadata?.channel?.send(
        `${emoji('bot_warn')} Έχω κομμάτια στην αναμονή αλλά έχασα το κανάλι φωνής. Μπες ξανά και πάτα /play.`
      );
      return;
    }

    if (guildId && client.autoIdleGuilds?.has(guildId) && !isIdleLiveActive(client, guildId)) {
      const voiceChannel = queue.channel;
      const textChannel = queue.metadata?.channel || null;
      if (voiceChannel) {
        const timer = setTimeout(async () => {
          client.emptyQueueTimers.delete(guildId);
          try {
            await startIdleLive(client, queue.guild, voiceChannel, textChannel, client.user);
          } catch (error) {
            log.error('Auto-idle restart failed:', error?.message || error);
          }
        }, 1000);
        client.emptyQueueTimers.set(guildId, timer);
        return;
      }
    }

    client.lastTrackByGuild?.delete(queue.guild.id);
    expectLeave(client, queue.guild.id, Number(queue.options?.leaveOnEndCooldown || LEAVE_ON_END_COOLDOWN_MS) + 30000);

    deleteMusicEmbed(queue.guild.id).catch(() => {});
    clearCurrentTrack(client, queue.guild.id);
    emitDashboardSync();
  });

  player.events.on('connection', (queue) => {
    log.debug(`voice connected: guild=${queue.guild.id} channel=${queue.channel?.name || '?'}`);
  });
  player.events.on('emptyChannel', (queue) => {
    if (queue.guild?.id) expectLeave(client, queue.guild.id);
  });
  player.events.on('connectionDestroyed', (queue) => {
    log.debug(`voice connection destroyed: guild=${queue.guild?.id}`);
  });
  player.events.on('disconnect', (queue) => {
    log.warn(`voice disconnected: guild=${queue.guild?.id}`);
  });
  player.events.on('playerSkip', (queue, track) => {
    log.warn(`track skipped without playing: ${track?.title || '?'} (guild=${queue.guild?.id})`);
  });
  player.events.on('debug', (queue, message) => {
    log.debug(`queue[${queue?.guild?.id || '-'}]: ${message}`);
  });
  player.on('debug', (message) => log.debug(`player: ${message}`));

  player.events.on('error', (_, error) => {
    if (error?.name === 'AbortError' || /operation was aborted/i.test(error?.message || '')) return;
    log.error(`Player error: ${error.message}`);
  });

  player.events.on('playerError', async (queue, error, track) => {
    if (error?.name === 'AbortError' || /operation was aborted/i.test(error?.message || '')) return;

    log.error(`Player error: ${error.message}`);

    if (isYouTubeAuthError(error)) {
      log.error('YT_AUTH_EXPIRED — YouTube is refusing this request. Refresh YT_COOKIE / YT_COOKIES_FILE.');
      notifyOwner(
        client,
        'yt-auth-expired',
        'Το YouTube ζητάει σύνδεση για να δώσει αυτό το κομμάτι. Αν το bot '
        + 'κατάφερε να το παίξει από SoundCloud, δεν χρειάζεται να κάνεις τίποτα.',
        { fields: [{ name: 'Σφάλμα', value: `\`${String(error.message).slice(0, 200)}\`` }] }
      ).catch(() => {});
    }

    const isStreamExtractError = /extract stream/i.test(error.message || '');
    if (!isStreamExtractError) queue.metadata?.channel?.send(`${emoji('bot_error')} Κάτι στράβωσε με αυτό το κομμάτι. Το κατέγραψα.`).catch(() => {});
    if (!track || !queue?.channel) return;
    if (isIdleLiveActive(client, queue?.guild?.id)) return;

    const fallbackKey = track.url || `${track.title}|${track.author}`;
    if (client.trackFallbackAttempts.has(fallbackKey)) return;
    client.trackFallbackAttempts.add(fallbackKey);

    const fallbackQuery = [track.title, track.author].filter(Boolean).join(' ').trim();
    if (!fallbackQuery) return;

    try {
      client.pendingStreamFallbacks += 1;
      const { track: fallbackTrack } = await client.player.play(queue.channel, fallbackQuery, {
        requestedBy: track.requestedBy || null,
        searchEngine: QueryType.YOUTUBE_SEARCH,
        nodeOptions: buildNodeOptions(database, queue.guild.id, queue.metadata)
      });

      queue.metadata?.channel?.send(`${emoji('bot_loop')} Συνεχίζουμε ακάθεκτοι (fallback): **${fallbackTrack.title}**`);
    } catch (fallbackError) {
      log.error('Fallback playback failed:', fallbackError.message || fallbackError);
      queue.metadata?.channel?.send(`Κομμάτι από fallback: **${track.title}**`);
    } finally {
      client.pendingStreamFallbacks = Math.max(0, client.pendingStreamFallbacks - 1);
      setTimeout(() => client.trackFallbackAttempts.delete(fallbackKey), 300000);
    }
  });
}

module.exports = { register };
