const { PermissionsBitField } = require('discord.js');
const { kickQuip } = require('../ai/quip');
const { emoji } = require('./emojis');

const KICK_LINES = [
  'Ε ρε, με πέταξες έξω σαν να μη γνωριζόμαστε.',
  'Καλά, τι σου έκανα; Μια τραγουδάρα σου έβαλα.',
  'Με έδιωξες. Θα το γράψω στο ημερολόγιό μου.',
  'Ούτε ένα αντίο, ούτε ένα ευχαριστώ.',
  'Με πέταξες έξω στη μέση. Έχω και συναισθήματα, ξέρεις.',
  'Εντάξει, κατάλαβα πού δεν με θέλουν.',
  'Μπράβο. Μόλις έχασες τον καλύτερο DJ που είχες.',
  'Έφυγα, αλλά αυτό το κρατάω.',
  'Πόρτα κανονική. Και μάλιστα χωρίς εξηγήσεις.',
  'Το ξέρεις ότι δουλεύω τζάμπα, έτσι;',
  'Φεύγω, αλλά θα γυρίσω και θα βάλω χειρότερα.',
  'Με έβγαλες έξω σαν να χάλασα. Μια χαρά είμαι.'
];

const MOVE_LINES = [
  'Με κουβάλησες σε άλλο κανάλι σαν έπιπλο.',
  'Α, μετακομίσαμε. Κανείς δεν με ρώτησε φυσικά.',
  'Μετακίνηση χωρίς προειδοποίηση. Το σημειώνω.',
  'Νέο κανάλι, ίδιος εγώ. Πάμε πάλι.',
  'Με μετέφερες σαν βαλίτσα. Ωραία εμπειρία.',
  'Άλλαξες κανάλι και με πήρες σβάρνα μαζί σου.'
];

const lastLineByGuild = new Map();

function pickFallback(kind, guildId, random = Math.random) {
  const lines = kind === 'move' ? MOVE_LINES : KICK_LINES;
  const key = `${guildId || 'global'}:${kind}`;
  const previous = lastLineByGuild.get(key);

  const choices = lines.length > 1 ? lines.filter((line) => line !== previous) : lines;
  const picked = choices[Math.floor(random() * choices.length)] || lines[0];

  lastLineByGuild.set(key, picked);
  return picked;
}

async function kickLine(facts, database, deps = {}) {
  let line = null;
  try {
    line = await kickQuip(facts, database, deps);
  } catch {
    line = null;
  }
  return line || pickFallback(facts.kind, facts.guildId, deps.random);
}

function formatKickMessage(line, facts) {
  const icon = facts.kind === 'move' ? emoji('bot_shuffle') : emoji('bot_kick');
  const parts = [`${icon} ${line}`];

  if (facts.byName) {
    const where = facts.kind === 'move'
      ? `από το **${facts.channelName || 'κανάλι'}** στο **${facts.toChannelName || 'άλλο κανάλι'}**`
      : `από το **${facts.channelName || 'κανάλι'}**`;
    const verb = facts.kind === 'move' ? 'Με μετακίνησε' : 'Με πέταξε έξω';
    parts.push(`-# ${verb} ο/η **${facts.byName}** ${where}`);
  }

  return parts.join('\n');
}

async function buildKickMessage(facts, database, deps = {}) {
  const line = await kickLine(facts, database, deps);
  return formatKickMessage(line, facts);
}

function canSpeakIn(channel, me) {
  if (!channel?.isTextBased?.() || channel.isDMBased?.()) return false;
  const perms = channel.permissionsFor?.(me);
  if (!perms) return false;
  return perms.has(PermissionsBitField.Flags.ViewChannel)
    && perms.has(PermissionsBitField.Flags.SendMessages);
}

async function resolveComplaintChannel(client, guildId, database, extra = []) {
  const guild = client.guilds?.cache?.get(guildId);
  if (!guild) return null;

  const me = guild.members?.me;
  if (!me) return null;

  const ids = [];
  try {
    const lastCommandChannel = database?.getLastCommandChannelId?.(guildId);
    if (lastCommandChannel) ids.push(String(lastCommandChannel));
  } catch {
    // η βάση δεν πρέπει ποτέ να εμποδίσει το μήνυμα
  }

  for (const candidate of extra) {
    if (!candidate) continue;
    ids.push(String(typeof candidate === 'string' ? candidate : candidate.id));
  }

  for (const id of [...new Set(ids)]) {
    const channel = guild.channels.cache.get(id)
      || await guild.channels.fetch(id).catch(() => null);
    if (canSpeakIn(channel, me)) return channel;
  }

  return null;
}

module.exports = {
  buildKickMessage,
  formatKickMessage,
  pickFallback,
  resolveComplaintChannel,
  canSpeakIn,
  KICK_LINES,
  MOVE_LINES
};
