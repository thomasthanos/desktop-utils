const { PREFIX } = require('./prefix-commands');
const log = require('./utils/logger')('dm');

/**
 * Απάντηση όταν κάποιος γράφει στο bot σε DM.
 *
 * Χωρίς αυτό το bot διαβάζει το μήνυμα και δεν λέει τίποτα, που είναι χειρότερο
 * από το να μην το διάβαζε καθόλου: φαίνεται χαλασμένο.
 *
 * Οι εντολές με prefix ΔΕΝ δουλεύουν εδώ, και είναι σκόπιμο — ο router τους
 * απαιτεί guild για τον έλεγχο δικαιωμάτων. Σε DM δουλεύουν οι slash εντολές.
 *
 * Το AI, όταν υπάρχει κλειδί, θα μπει ως ανώτερο επίπεδο πάνω από αυτή τη
 * συνάρτηση· εδώ μένει η απάντηση που δουλεύει πάντα και χωρίς ποσόστωση.
 */

// ΠΡΟΣΟΧΗ με το `\b` εδώ: βασίζεται στο `\w`, που είναι μόνο [A-Za-z0-9_].
// Δίπλα σε ελληνικό γράμμα δεν υπάρχει ποτέ όριο λέξης, οπότε ένα `\bευχαριστ`
// δεν ταιριάζει ΠΟΤΕ. Τα ελληνικά μοτίβα μένουν χωρίς όριο· τα αγγλικά το
// κρατούν, ώστε το «this» να μη μετράει για «hi».
const GREETINGS = /^\s*(γεια|για|καλησπ|καλημ|χαιρετ|hello|hi|hey|yo)/i;
const THANKS = /(ευχαριστ|thanks|thank you|thx)/i;
const HELP_WORDS = /(βοηθεια|βοήθεια|τι κανεις|τι κάνεις|εντολ|\bhelp\b|\bcommands?\b)/i;

// Πόσο συχνά το ίδιο άτομο μπορεί να πάρει απάντηση. Χωρίς όριο, δύο bots που
// βρίσκονται σε DM θα απαντούσαν το ένα στο άλλο για πάντα — και ένας άνθρωπος
// που γράφει δέκα γραμμές στη σειρά δεν θέλει δέκα ίδιες απαντήσεις.
const COOLDOWN_MS = 15000;
const lastReplyByUser = new Map();

function buildReply(content) {
  const text = String(content || '').trim();

  if (GREETINGS.test(text)) {
    return `Γεια! 👋 Γράψε \`/help\` για να δεις τι μπορώ να κάνω.\n`
      + `Μέσα σε server δουλεύω και με \`${PREFIX}\` μπροστά από την εντολή.`;
  }

  if (THANKS.test(text)) {
    return 'Τίποτα! 🙂';
  }

  if (HELP_WORDS.test(text)) {
    return 'Γράψε `/help` εδώ για όλη τη λίστα εντολών.\n'
      + 'Η μουσική χρειάζεται κανάλι φωνής, οπότε αυτές δουλεύουν μόνο μέσα σε server.';
  }

  return 'Δεν κατάλαβα τι θέλεις. Γράψε `/help` για τη λίστα εντολών.';
}

/**
 * @returns {boolean} αν απαντήθηκε
 */
async function handleDirectMessage(message, client, database) {
  // Ο κύκλος bot-προς-bot είναι ο λόγος που αυτό είναι το πρώτο check.
  if (message.author?.bot) return false;
  if (message.guild) return false;

  const userId = message.author?.id;
  if (!userId) return false;

  const last = lastReplyByUser.get(userId) || 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  lastReplyByUser.set(userId, Date.now());

  const reply = await resolveReply(message, client, database);
  await message.reply(reply).catch(() => { /* έκλεισε τα DM */ });
  return true;
}

/**
 * Με κλειδί AI απαντάει το μοντέλο· χωρίς, τα μοτίβα παρακάτω.
 *
 * Η αποτυχία του AI δεν είναι λόγος σιωπής — πέφτουμε πίσω στο `buildReply`,
 * που δουλεύει πάντα και χωρίς ποσόστωση.
 *
 * @returns {Promise<string|object>} κείμενο, ή payload του discord.js όταν
 *   υπάρχει embed να δείξουμε.
 */
async function resolveReply(message, client, database) {
  if (!client || !database) return buildReply(message.content);

  const ai = require('./ai');
  if (!ai.isEnabled()) return buildReply(message.content);

  try {
    const { upgradeDmContext } = require('./utils/command-context');

    // Το ίδιο μονοπάτι με την /ask από DM: αν κάθεσαι σε κανάλι φωνής, οι
    // εντολές μουσικής δουλεύουν εκεί χωρίς να χρειάζεται να πας στον server.
    const ctx = await upgradeDmContext({
      guildId: null,
      guild: null,
      member: null,
      user: message.author,
      channel: message.channel,
      inGuild: () => false
    }, client);

    const { text, embed } = await ai.ask(ctx, message.content, client, database);
    if (embed) return { content: text || undefined, embeds: [embed] };
    return text || buildReply(message.content);
  } catch (error) {
    log.warn('AI reply failed, falling back to the keyword reply:', error.message || error);
    return buildReply(message.content);
  }
}

module.exports = { handleDirectMessage, resolveReply, buildReply, COOLDOWN_MS };
