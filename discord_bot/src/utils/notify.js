const { EmbedBuilder } = require('discord.js');
const { getBotOwnerIds } = require('./authorization');
const log = require('./logger')('notify');

/**
 * Ειδοποιήσεις κατάστασης στον ιδιοκτήτη, μέσω DM.
 *
 * Ο σκοπός: να μαθαίνεις ότι κάτι έσπασε από το bot, όχι από τους χρήστες.
 * Οι πιο ύπουλες βλάβες αυτού του bot είναι οι σιωπηλές — ληγμένα cookies,
 * ραδιόφωνο που δεν ξαναρχίζει, γεμάτος δίσκος — γιατί το bot φαίνεται
 * κανονικά online όσο συμβαίνουν.
 *
 * Τα μηνύματα είναι στα ελληνικά επίτηδες: παραλήπτης είναι ένα συγκεκριμένο
 * άτομο, όχι οι χρήστες των servers.
 */

// Το ίδιο πρόβλημα το πολύ μία φορά την ώρα. Χωρίς αυτό, ένα ραδιόφωνο σε
// βρόχο αποτυχίας θα έστελνε εκατοντάδες DM — και θα μάθαινες να τα αγνοείς,
// που είναι χειρότερο από το να μην τα λαμβάνεις καθόλου.
const COOLDOWN_MS = 60 * 60 * 1000;
const lastSentByType = new Map();

const STYLES = {
  'crash-restart': {
    color: 0xe67e22,
    title: '⚠️ Το bot ξαναξεκίνησε μετά από crash',
    fix: 'Δες τι προηγήθηκε:\n```\njournalctl -u discord-bot --since "30 min ago" -p warning\n```'
  },
  'yt-auth-expired': {
    color: 0xe74c3c,
    title: '🔑 Το YouTube απορρίπτει τα αιτήματα',
    fix: 'Συνήθως λήγουν τα cookies. Δες τη §9 του DEPLOY.md — ή αγνόησέ το αν παίζει μέσω SoundCloud.'
  },
  'disk-pressure': {
    color: 0xe67e22,
    title: '💾 Ο δίσκος γεμίζει',
    fix: 'Χαμήλωσε το `ATTACHMENT_MAX_TOTAL_MB` ή σβήσε παλιά backups:\n```\ndu -sh /opt/discord-bot/data/*\n```'
  },
  'idle-radio-failing': {
    color: 0xe74c3c,
    title: '📻 Το ραδιόφωνο δεν ξαναρχίζει',
    fix: 'Αν το `IDLE_MUSIC_URL` δείχνει σε YouTube, βάλε Icecast — δεν έχει έλεγχο bot.'
  },
  'recovered': {
    color: 0x2ecc71,
    title: '✅ Όλα ξανά στη θέση τους'
  },
  'daily-digest': {
    color: 0x3498db,
    title: '📊 Σύνοψη ημέρας'
  },
  'startup-warning': {
    color: 0xf1c40f,
    title: '⚠️ Προειδοποίηση εκκίνησης'
  }
};

// Μία πηγή αλήθειας με το authorization.js — βλ. σχόλιο στο getBotOwnerIds.
const getOwnerIds = getBotOwnerIds;

/**
 * @param {import('discord.js').Client} client
 * @param {string} type κλειδί του STYLES· ελέγχει και τον περιοριστή ρυθμού
 * @param {string} detail τι συνέβη, με απλά λόγια
 * @param {object} [options]
 * @param {boolean} [options.force] παράκαμψη του cooldown
 * @param {Array<{name: string, value: string, inline?: boolean}>} [options.fields]
 * @returns {Promise<boolean>} αν όντως παραδόθηκε
 */
async function notifyOwner(client, type, detail, options = {}) {
  const owners = getOwnerIds();
  if (owners.length === 0) return false; // χωρίς BOT_OWNER_ID δεν υπάρχει παραλήπτης

  if (!options.force) {
    const last = lastSentByType.get(type) || 0;
    if (Date.now() - last < COOLDOWN_MS) return false;
  }
  lastSentByType.set(type, Date.now());

  const style = STYLES[type] || { color: 0x95a5a6, title: 'ℹ️ Ειδοποίηση' };

  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setTitle(style.title)
    .setDescription(detail)
    .setTimestamp();

  if (options.fields?.length) embed.addFields(options.fields);
  if (style.fix) embed.addFields({ name: '🔧 Τι να κάνεις', value: style.fix });

  // Το hostname ξεχωρίζει τον server από μια τοπική δοκιμή — χρήσιμο όταν
  // τρέχεις και τα δύο και δεν θυμάσαι ποιο σου μίλησε.
  embed.setFooter({ text: `${require('os').hostname()} • ${client.user?.tag || 'bot'}` });

  let delivered = false;
  for (const ownerId of owners) {
    try {
      const user = await client.users.fetch(ownerId);
      await user.send({ embeds: [embed] });
      delivered = true;
    } catch (error) {
      // Κλειστά DM ή λάθος ID. Το logάρουμε ώστε να μη νομίζεις ότι
      // ειδοποιείσαι ενώ δεν φτάνει τίποτα.
      log.warn(`Δεν στάλθηκε DM στον ${ownerId}:`, error.message);
    }
  }
  return delivered;
}

/**
 * Αναγνωρίζει τα μηνύματα του YouTube που σημαίνουν «χρειάζεται σύνδεση».
 * Αποτυγχάνει σιωπηλά αλλιώς: η αναπαραγωγή απλώς σταματά να δουλεύει.
 */
function isYouTubeAuthError(error) {
  const text = String(error?.message || error || '');
  return /sign in to confirm|not a bot|login required|age.?restricted|consent/i.test(text);
}

/**
 * Μετρητές για τη σύνοψη ημέρας. Κρατιούνται στη μνήμη: αν το bot πέσει, το
 * γεγονός της πτώσης είναι ούτως ή άλλως πιο σημαντικό από τους μετρητές.
 */
const counters = { commands: 0, ytRefused: 0, soundcloudRescues: 0, radioRestarts: 0, errors: 0 };
function bump(key, by = 1) {
  if (key in counters) counters[key] += by;
}

/**
 * Μία σύνοψη το εικοσιτετράωρο — μόνο αν συνέβη κάτι. Έτσι η σιωπή σημαίνει
 * «όλα καλά» και δεν σε μαθαίνει να αγνοείς τα μηνύματα.
 */
function startDailyDigest(client) {
  const timer = setInterval(async () => {
    const total = Object.values(counters).reduce((a, b) => a + b, 0);
    if (total === 0) return;

    await notifyOwner(
      client,
      'daily-digest',
      'Τι έγινε το τελευταίο 24ωρο:',
      {
        force: true,
        fields: [
          { name: 'Εντολές', value: String(counters.commands), inline: true },
          { name: 'Σφάλματα', value: String(counters.errors), inline: true },
          { name: 'Επανεκκινήσεις ραδιοφώνου', value: String(counters.radioRestarts), inline: true },
          { name: 'Αρνήσεις YouTube', value: String(counters.ytRefused), inline: true },
          { name: 'Διάσωση από SoundCloud', value: String(counters.soundcloudRescues), inline: true }
        ]
      }
    ).catch(() => { /* η σύνοψη δεν πρέπει ποτέ να ρίξει το bot */ });

    for (const key of Object.keys(counters)) counters[key] = 0;
  }, 24 * 60 * 60 * 1000);

  timer.unref();
  return timer;
}

module.exports = { notifyOwner, isYouTubeAuthError, getOwnerIds, bump, counters, startDailyDigest };
