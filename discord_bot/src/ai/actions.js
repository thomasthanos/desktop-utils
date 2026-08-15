const { QueryType } = require('discord-player');
const { getQueue, getPlaybackState, getUpcoming, setPaused, formatDuration } = require('../utils/music');
const { buildNodeOptions, applyStay247 } = require('../utils/voice');
const { canManageAuthorization } = require('../utils/authorization');
const { buildNowPlayingEmbed } = require('../utils/embeds');
const { READ_ACTIONS, PLAYBACK_ACTIONS } = require('./schema');
const log = require('../utils/logger')('ai');

/**
 * Χάρτης «όνομα → χειρόγραφη συνάρτηση».
 *
 * Το AI **δεν επιλέγει ποτέ εκτελεστή**. Επιστρέφει ένα όνομα, και το όνομα
 * αναζητείται εδώ. Ποτέ `client.commands.get(name).execute(...)` — αυτό θα
 * έδινε στο μοντέλο πρόσβαση σε ΚΑΘΕ εντολή, συμπεριλαμβανομένων εκείνων που
 * το schema.js φρόντισε να μην μπορεί καν να ονομάσει. Η λίστα εδώ και το enum
 * εκεί είναι δύο ανεξάρτητα σημεία επιβολής: ένα χειροποίητο `{action:"clear"}`
 * που παρακάμπτει το μοντέλο πέφτει σε αυτόν τον χάρτη και δεν βρίσκει τίποτα.
 */

// Φτάνει εδώ μόνο από DM: μέσα σε server υπάρχει πάντα guildId. Και σε DM το
// guild αναζητείται πρώτα από το κανάλι φωνής του χρήστη, οπότε αν φτάσαμε
// εδώ σημαίνει ότι δεν κάθεται πουθενά σε φωνή.
const NEEDS_GUILD = 'Δεν σε βρίσκω σε κανάλι φωνής. Μπες σε ένα και ξαναπές μου.';
const NOTHING_PLAYING = 'Δεν παίζει τίποτα αυτή τη στιγμή.';

/**
 * Ο ΙΔΙΟΣ έλεγχος που θα περνούσε ο χρήστης με το χέρι.
 *
 * Το AI δεν είναι παράκαμψη δικαιωμάτων. Αν μια εντολή είναι περιορισμένη σε
 * αυτό το guild και δεν έχεις πρόσβαση, δεν την αποκτάς επειδή τη ζήτησες με
 * φυσική γλώσσα.
 */
function mayRunPlayback(ctx, database, commandName) {
  if (!ctx.guildId) return false;
  if (canManageAuthorization(ctx)) return true;
  if (!database.hasAuthorizedEntriesForCommand(ctx.guildId, commandName)) return true;
  return database.isAuthorizedUser(ctx.guildId, commandName, ctx.user.id);
}

const EXECUTORS = {
  // --- Επίπεδο 1: μόνο ανάγνωση --------------------------------------------

  async nowplaying(ctx, client) {
    if (!ctx.guildId) return NEEDS_GUILD;
    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);
    if (idleActive) return '📻 Παίζει το ραδιόφωνο.';
    const track = queue?.currentTrack;
    if (!track) return NOTHING_PLAYING;
    return `🎵 Παίζει: **${track.title}** — ${track.author || 'άγνωστος'}`;
  },

  async queue(ctx, client) {
    if (!ctx.guildId) return NEEDS_GUILD;
    const upcoming = getUpcoming(client, ctx.guildId, 5);
    if (!upcoming.length) return 'Η ουρά είναι άδεια.';
    return `📋 Επόμενα:\n${upcoming.map((t, i) => `${i + 1}. ${t.title}`).join('\n')}`;
  },

  async stats(ctx, client, database) {
    // ΜΟΝΟ συγκεντρωτικά. Τίποτα από τα clear_logs — βλ. σχόλιο στο index.js.
    const total = database.getStat('total_commands') || '0';
    const guilds = client.guilds.cache.size;
    const uptime = formatDuration(Date.now() - Number(database.getStat('start_time') || Date.now()));
    return `📊 ${total} εντολές συνολικά, σε ${guilds} server(s). Σε λειτουργία ${uptime}.`;
  },

  async help() {
    return 'Γράψε `/help` για όλη τη λίστα εντολών.';
  },

  // --- Επίπεδο 2: αλλάζουν την αναπαραγωγή ----------------------------------

  async play(ctx, client, database, args) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'play')) return 'Δεν έχεις δικαίωμα για το `/play` εδώ.';

    const voiceChannel = ctx.member?.voice?.channel;
    if (!voiceChannel) return 'Μπες πρώτα σε ένα κανάλι φωνής.';

    const query = String(args.query || '').trim();
    if (!query) return 'Πες μου τι να παίξω.';

    // Από DM η απάντηση της εντολής είναι ήδη το embed παρακάτω. Το `quiet`
    // εμποδίζει το player-events να στείλει δεύτερο — τέσσερα μηνύματα για ένα
    // «βάλε ένα τραγούδι» δεν είναι απάντηση, είναι θόρυβος.
    const fromDm = Boolean(ctx.channel?.isDMBased?.());

    const { track } = await client.player.play(voiceChannel, query, {
      requestedBy: ctx.user,
      searchEngine: QueryType.YOUTUBE_SEARCH,
      fallbackSearchEngine: QueryType.YOUTUBE_SEARCH,
      nodeOptions: buildNodeOptions(database, ctx.guildId, { channel: ctx.channel, quiet: fromDm })
    });

    return {
      text: '',
      embed: buildNowPlayingEmbed({
        title: track.title,
        url: track.url,
        author: track.author,
        duration: track.duration,
        thumbnail: track.thumbnail,
        requestedBy: ctx.user?.username || ctx.user?.tag || 'Unknown'
      })
    };
  },

  async pause(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'pause')) return 'Δεν έχεις δικαίωμα για το `/pause` εδώ.';
    return setPaused(client, ctx.guildId, true) ? '⏸️ Παύση.' : NOTHING_PLAYING;
  },

  async resume(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'pause')) return 'Δεν έχεις δικαίωμα για το `/resume` εδώ.';
    return setPaused(client, ctx.guildId, false) ? '▶️ Συνεχίζω.' : NOTHING_PLAYING;
  },

  async skip(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'skip')) return 'Δεν έχεις δικαίωμα για το `/skip` εδώ.';
    const queue = getQueue(client, ctx.guildId);
    if (!queue?.currentTrack) return NOTHING_PLAYING;
    queue.node.skip();
    return '⏭️ Επόμενο.';
  },

  async stop(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'stop')) return 'Δεν έχεις δικαίωμα για το `/stop` εδώ.';
    const queue = getQueue(client, ctx.guildId);
    if (!queue) return NOTHING_PLAYING;
    queue.node.stop();
    return '⏹️ Σταμάτησα.';
  },

  async volume(ctx, client, database, args) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'volume')) return 'Δεν έχεις δικαίωμα για το `/volume` εδώ.';

    const level = Math.round(Number(args.value));
    if (!Number.isFinite(level) || level < 0 || level > 100) return 'Η ένταση είναι από 0 μέχρι 100.';

    database.setGuildVolume(ctx.guildId, level);
    getQueue(client, ctx.guildId)?.node?.setVolume(level);
    return `🔊 Ένταση στο ${level}%.`;
  },

  async loop(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'loop')) return 'Δεν έχεις δικαίωμα για το `/loop` εδώ.';
    return 'Για την επανάληψη τρέξε `/loop mode:track` ή `/loop mode:queue`.';
  },

  async stay247(ctx, client, database, args) {
    if (!ctx.guildId) return NEEDS_GUILD;
    // Το 24/7 είναι ρύθμιση του server, όχι της αναπαραγωγής — ίδιος έλεγχος
    // με την εντολή /247 και όχι ο χαλαρότερος της αναπαραγωγής.
    if (!canManageAuthorization(ctx)) return 'Μόνο ο ιδιοκτήτης του server το αλλάζει αυτό.';

    const enabled = args.value !== 0;
    database.setStay247(ctx.guildId, enabled);
    applyStay247(client.player?.nodes?.get(ctx.guildId), enabled);
    client.voiceWatcher?.refresh(ctx.guildId);
    return enabled ? '🔁 Το 24/7 ενεργοποιήθηκε.' : '⏱️ Το 24/7 απενεργοποιήθηκε.';
  }
};

/**
 * @returns {Promise<string|null>} το κείμενο του αποτελέσματος, ή null αν η
 *   ενέργεια δεν αναγνωρίζεται — που είναι και η άμυνα σε βάθος.
 */
async function runAction(name, ctx, client, database, args = {}) {
  if (!name || name === 'none') return null;

  const executor = Object.prototype.hasOwnProperty.call(EXECUTORS, name) ? EXECUTORS[name] : null;
  if (!executor) {
    // Εδώ καταλήγει ένα χειροποίητο {action:"clear"}. Καταγράφεται γιατί
    // σημαίνει είτε ότι κάτι προσπάθησε να παρακάμψει το schema, είτε ότι
    // πρόσθεσα τιμή στο enum χωρίς εκτελεστή.
    log.warn(`AI asked for an action with no executor: ${String(name).slice(0, 40)}`);
    return null;
  }

  try {
    return await executor(ctx, client, database, args);
  } catch (error) {
    log.error(`AI action ${name} failed:`, error.message || error);
    return 'Κάτι πήγε στραβά με αυτό.';
  }
}

module.exports = {
  runAction,
  mayRunPlayback,
  EXECUTOR_NAMES: Object.keys(EXECUTORS),
  READ_ACTIONS,
  PLAYBACK_ACTIONS
};
