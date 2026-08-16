const { QueryType } = require('discord-player');
const { isIdleLiveActive, startIdleLive } = require('../idle-live');
const { hasIdlePending, startNextPendingTrack } = require('../idle-pending');
const { buildNowPlayingEmbed, buildSourceSwitchEmbed } = require('../utils/embeds');
const { notifyOwner, isYouTubeAuthError, bump } = require('../utils/notify');
const { buildNodeOptions } = require('../utils/voice');
const log = require('../utils/logger')('player');

/**
 * Όλα τα γεγονότα του discord-player, μαζί με το idle:start που ζωγραφίζει το
 * ίδιο embed για το ραδιόφωνο.
 */
function register({ client, database, player, sync, embeds }) {
  const { emitDashboardSync } = sync;
  const { updateMusicEmbed, deleteMusicEmbed } = embeds;

  player.events.on('playerStart', (queue, track) => {
    const announceKey = track.url || `${track.title}|${track.author}`;
    const last = client.lastAnnouncedTrackByGuild.get(queue.guild.id);
    // Το discord-player μπορεί να στείλει playerStart δύο φορές για το ίδιο
    // κομμάτι (π.χ. μετά από fallback). Χωρίς αυτό, το ίδιο τραγούδι
    // ανακοινωνόταν και καταγραφόταν διπλά.
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
      // Το `quiet` μπαίνει όταν η αναπαραγωγή ζητήθηκε από DM: εκεί η απάντηση
      // της εντολής ΕΙΝΑΙ ήδη αυτό το embed, οπότε ένα δεύτερο είναι σκέτη
      // επανάληψη μέσα σε μια ιδιωτική συνομιλία.
      if (queue.metadata?.channel && !queue.metadata?.quiet) {
        updateMusicEmbed(queue.guild.id, queue.metadata.channel, embed).catch(() => {});
      }
    }

    const savedVol = database.getGuildVolume(queue.guild.id);
    if (queue.node?.volume !== savedVol) {
      try {
        queue.node.setVolume(savedVol);
      } catch (error) {
        // Σιωπηλά, η αποθηκευμένη ένταση του χρήστη δεν εφαρμοζόταν — και το
        // μόνο σύμπτωμα ήταν «γιατί παίζει δυνατά;».
        log.warn(`Could not apply saved volume ${savedVol} in guild ${queue.guild.id}:`, error.message);
      }
    }

    client.currentTrack = {
      title: track.title,
      author: track.author,
      url: track.url,
      thumbnail: track.thumbnail,
      duration: track.duration,
      guildId: queue.guild.id,
      requestedBy: track.requestedBy?.username || track.requestedBy?.tag || 'Unknown',
      startedAt: Date.now()
    };
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

  // Μια αποτυχημένη εξαγωγή ροής ΔΕΝ πετάει σφάλμα: το κομμάτι «τελειώνει»
  // μετά από λίγα χιλιοστά και η ουρά αδειάζει. Από έξω μοιάζει με «έπαιξε και
  // τελείωσε», γι' αυτό δεν υπήρχε τίποτα στα logs. Κρατάμε πότε ξεκίνησε ώστε
  // να μπορούμε να το αναγνωρίσουμε.
  const SILENT_FAILURE_MS = 5000;
  const startedAt = new Map();

  player.events.on('playerStart', (queue) => startedAt.set(queue.guild.id, Date.now()));

  player.events.on('playerFinish', async (queue, track) => {
    client.currentTrack = null;
    emitDashboardSync();

    const guildId = queue?.guild?.id;
    if (!guildId || !track) return;

    const elapsed = Date.now() - (startedAt.get(guildId) || 0);
    startedAt.delete(guildId);

    // Κομμάτι τριών λεπτών που «τελείωσε» σε δύο δευτερόλεπτα δεν έπαιξε ποτέ.
    const durationMs = Number(track.durationMS) || 0;
    if (elapsed >= SILENT_FAILURE_MS || durationMs < 30000) return;

    // Μία απόπειρα ανά κομμάτι — αλλιώς μια νεκρή πηγή γίνεται βρόχος.
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

      // ΕΝΑ μήνυμα, και μόνο αφού ξέρουμε το αποτέλεσμα. Πριν στέλνονταν δύο —
      // «δοκιμάζω SoundCloud…» και μετά το αποτέλεσμα — που σε ιδιωτική
      // συνομιλία γίνονταν θόρυβος, και το πρώτο ήταν υπόσχεση που μπορούσε να
      // διαψευστεί.
      queue.metadata?.channel?.send({
        embeds: [buildSourceSwitchEmbed({
          from: track,
          to: alt,
          source: 'SoundCloud',
          requestedBy: track.requestedBy
        })]
      });
    } catch (error) {
      bump('errors');
      log.error('SoundCloud fallback failed:', error.message || error);
      queue.metadata?.channel?.send(`Δεν μπόρεσα να παίξω το **${track.title}** από καμία πηγή.`);
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

    // Ένα προηγούμενο emptyQueue μπορεί να έχει ήδη προγραμματίσει ενέργεια.
    if (guildId && client.emptyQueueTimers.has(guildId)) {
      clearTimeout(client.emptyQueueTimers.get(guildId));
      client.emptyQueueTimers.delete(guildId);
    }

    // 1) Υπάρχουν κομμάτια σε αναμονή από όσο έπαιζε το ραδιόφωνο.
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
        'Pending queue exists but I lost the voice channel. Rejoin a voice channel and run `/play` again.'
      );
      return;
    }

    // 2) Το ραδιόφωνο έπαιζε πριν το /play, οπότε το επαναφέρουμε.
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

    // 3) Τίποτα να παίξει — καθάρισε.
    deleteMusicEmbed(queue.guild.id).catch(() => {});
    client.currentTrack = null;
    emitDashboardSync();
  });

  // Η διαδρομή της φωνής δεν είχε καμία καταγραφή. Όταν ο ήχος «παίζει» χωρίς
  // να ακούγεται, δεν υπήρχε τίποτα να κοιτάξεις: ούτε αν έγινε σύνδεση, ούτε
  // αν άρχισε να ρέει, ούτε αν έπεσε. Στο επίπεδο debug τα βλέπεις όλα.
  player.events.on('connection', (queue) => {
    log.debug(`voice connected: guild=${queue.guild.id} channel=${queue.channel?.name || '?'}`);
  });
  player.events.on('connectionDestroyed', (queue) => {
    log.debug(`voice connection destroyed: guild=${queue.guild?.id}`);
  });
  player.events.on('disconnect', (queue) => {
    log.warn(`voice disconnected: guild=${queue.guild?.id}`);
  });
  player.events.on('playerSkip', (queue, track) => {
    // Αυτό ακριβώς συμβαίνει όταν η ροή αποτυγχάνει σιωπηλά: το κομμάτι
    // προσπερνιέται χωρίς σφάλμα, η ουρά αδειάζει, και δεν ακούγεται τίποτα.
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

    // Τα ληγμένα cookies YouTube αποτυγχάνουν σιωπηλά: η αναπαραγωγή απλώς
    // σταματά να δουλεύει, χωρίς τίποτα να λέει γιατί. Ένας ξεχωριστός δείκτης
    // στα logs κάνει το πρόβλημα διαγνώσιμο στις 2 τα ξημερώματα.
    if (isYouTubeAuthError(error)) {
      log.error('YT_AUTH_EXPIRED — YouTube is refusing this request. Refresh YT_COOKIE / YT_COOKIES_FILE.');
      notifyOwner(
        client,
        'yt-auth-expired',
        'Το YouTube ζητάει σύνδεση για να δώσει αυτό το κομμάτι. Αν το bot '
        + 'κατάφερε να το παίξει από SoundCloud, δεν χρειάζεται να κάνεις τίποτα.',
        { fields: [{ name: 'Σφάλμα', value: `\`${String(error.message).slice(0, 200)}\`` }] }
      ).catch(() => { /* η ειδοποίηση δεν πρέπει ποτέ να ρίξει τον handler */ });
    }

    const isStreamExtractError = /extract stream/i.test(error.message || '');
    if (!isStreamExtractError) queue.metadata?.channel?.send(`Error: ${error.message}`);
    if (!track || !queue?.channel) return;
    if (isIdleLiveActive(client, queue?.guild?.id)) return;

    // Μία μόνο απόπειρα ανά κομμάτι, αλλιώς μια νεκρή πηγή γίνεται βρόχος.
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
      // Ένα μήνυμα μετά το αποτέλεσμα, όπως και στο SoundCloud fallback.
      queue.metadata?.channel?.send(`🔁 Η πηγή απέτυχε — παίζω: **${fallbackTrack.title}**`);
    } catch (fallbackError) {
      log.error('Fallback playback failed:', fallbackError.message || fallbackError);
      queue.metadata?.channel?.send(`Δεν μπόρεσα να παίξω το **${track.title}**.`);
    } finally {
      client.pendingStreamFallbacks = Math.max(0, client.pendingStreamFallbacks - 1);
      setTimeout(() => client.trackFallbackAttempts.delete(fallbackKey), 300000);
    }
  });
}

module.exports = { register };
