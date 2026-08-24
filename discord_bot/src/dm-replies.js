const { PREFIX } = require('./prefix-commands');
const { emoji } = require('./utils/emojis');
const log = require('./utils/logger')('dm');

const GREETINGS = /^\s*(γεια|για|καλησπ|καλημ|χαιρετ|hello|hi|hey|yo)/i;
const THANKS = /(ευχαριστ|thanks|thank you|thx)/i;
const HELP_WORDS = /(βοηθεια|βοήθεια|τι κανεις|τι κάνεις|εντολ|\bhelp\b|\bcommands?\b)/i;

const COOLDOWN_MS = 15000;
const lastReplyByUser = new Map();

function buildReply(content) {
  const text = String(content || '').trim();

  if (GREETINGS.test(text)) {
    return `Γεια! ${emoji('bot_hi')} Γράψε \`/help\` για να δεις τι μπορώ να κάνω.\n`
      + `Μέσα σε server δουλεύω και με \`${PREFIX}\` μπροστά από την εντολή.`;
  }

  if (THANKS.test(text)) {
    return `Τίποτα! ${emoji('bot_ok')}`;
  }

  if (HELP_WORDS.test(text)) {
    return 'Γράψε `/help` εδώ για όλη τη λίστα εντολών.\n'
      + 'Η μουσική χρειάζεται κανάλι φωνής, οπότε αυτές δουλεύουν μόνο μέσα σε server.';
  }

  return 'Δεν κατάλαβα τι θέλεις. Γράψε `/help` για τη λίστα εντολών.';
}

async function handleDirectMessage(message, client, database) {
  if (message.author?.bot) return false;
  if (message.guild) return false;

  const userId = message.author?.id;
  if (!userId) return false;

  const last = lastReplyByUser.get(userId) || 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  lastReplyByUser.set(userId, Date.now());

  const reply = await resolveReply(message, client, database);
  await message.reply(reply).catch(() => {});
  return true;
}

async function resolveReply(message, client, database) {
  if (!client || !database) return buildReply(message.content);

  const ai = require('./ai');
  if (!ai.isEnabled()) return buildReply(message.content);

  try {
    const { upgradeDmContext } = require('./utils/command-context');

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
