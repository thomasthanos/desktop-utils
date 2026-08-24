const { canSpeakIn } = require('./kick-message');
const { EmbedBuilder } = require('discord.js');
const { emoji } = require('./emojis');
const log = require('./logger')('invites');

const DEFAULT_FAKE_WINDOW_MS = 10 * 60 * 1000;

function fakeWindowMs() {
  const raw = Number(process.env.INVITE_FAKE_WINDOW_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_FAKE_WINDOW_MS;
}

const DEFAULT_MIN_ACCOUNT_AGE_DAYS = 3;

function minAccountAgeMs() {
  const raw = Number(process.env.INVITE_MIN_ACCOUNT_AGE_DAYS);
  const days = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MIN_ACCOUNT_AGE_DAYS;
  return days * 86400000;
}

// Λογαριασμός φτιαγμένος χθες που μπαίνει με πρόσκληση είναι το κλασικό
// μοτίβο για φουσκωμένα invites.
function isFreshAccount(user, now = Date.now()) {
  const created = Number(user?.createdTimestamp);
  if (!Number.isFinite(created) || created <= 0) return false;
  return now - created < minAccountAgeMs();
}

function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'άγνωστο διάστημα';

  if (ms < 60000) return 'λιγότερο από ένα λεπτό';

  const minutes = Math.round(ms / 60000);
  if (minutes === 1) return '1 λεπτό';
  if (minutes < 60) return `${minutes} λεπτά`;

  const hours = Math.round(minutes / 60);
  if (hours === 1) return '1 ώρα';
  if (hours < 24) return `${hours} ώρες`;

  const days = Math.round(hours / 24);
  return days === 1 ? '1 μέρα' : `${days} μέρες`;
}

// Το SQLite γράφει το CURRENT_TIMESTAMP σε UTC χωρίς ζώνη· χωρίς το Z θα το
// διάβαζε ως τοπική ώρα και ο χρόνος παραμονής θα έβγαινε λάθος κατά ώρες.
function parseStoredTime(value) {
  if (!value) return null;

  const text = String(value).trim();

  const timePart = text.slice(10);
  const alreadyZoned = /[Zz]/.test(timePart) || timePart.includes('+') || timePart.lastIndexOf('-') > 0;

  const parsed = Date.parse(alreadyZoned ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

async function inviteLogChannel(guild, database) {
  if (!guild) return null;

  let channelId = null;
  try {
    channelId = database.getInviteLogChannel(guild.id);
  } catch {
    return null;
  }
  if (!channelId) return null;

  const channel = guild.channels?.cache?.get(channelId)
    || await guild.channels?.fetch?.(channelId).catch(() => null);

  if (!canSpeakIn(channel, guild.members?.me)) {
    log.warn(`Cannot post invite events in ${channelId} (${guild.id}) — check the permissions.`);
    return null;
  }
  return channel;
}

const JOIN_COLOR = 0x57f287;
const LEAVE_COLOR = 0x8b93a1;
const KICK_COLOR = 0xe67e22;
const BAN_COLOR = 0xed4245;
const FAKE_COLOR = 0xf1c40f;

const REMOVAL_WINDOW_MS = 8000;
const TICK = String.fromCharCode(96);

function nameOf(user, fallback = 'άγνωστος') {
  return user?.tag || user?.username || user?.displayName || fallback;
}

function code(value) {
  return `${TICK}${value}${TICK}`;
}

// Το mention το αποδίδει ο client ως κανονικό, κλικαρίσιμο όνομα — και το
// allowedMentions στο announce το εμποδίζει να χτυπήσει ειδοποίηση σε κανέναν.
function mention(user) {
  return user?.id ? `<@${user.id}>` : `**${nameOf(user)}**`;
}

function mentionWithId(user) {
  return user?.id ? `${mention(user)} ${code(user.id)}` : `**${nameOf(user)}**`;
}

// Δεύτερη γραμμή σε μικρά γράμματα: κρατάει το μήνυμα μικρό, αλλά αφήνει μέσα
// ό,τι χρειάζεται για να βρεις κάποιον.
function subtext(parts) {
  const line = parts.filter(Boolean).join(' · ');
  return line ? `\n-# ${line}` : '';
}

function removalRegistry(client) {
  if (!client.recentRemovals) client.recentRemovals = new Map();
  return client.recentRemovals;
}

function rememberRemoval(client, guildId, userId, details) {
  if (!client || !guildId || !userId) return false;
  removalRegistry(client).set(`${guildId}:${userId}`, { ...details, at: Date.now() });
  return true;
}

function recentRemoval(client, guildId, userId, windowMs = REMOVAL_WINDOW_MS) {
  if (!client || !guildId || !userId) return null;

  const key = `${guildId}:${userId}`;
  const entry = removalRegistry(client).get(key);
  if (!entry) return null;

  removalRegistry(client).delete(key);
  return Date.now() - entry.at > windowMs ? null : entry;
}

function buildJoinEmbed({ member, inviter, inviteCode, totalInvites, isFake, fakeReason }) {
  const user = member?.user || member;

  const details = [user?.id ? code(user.id) : null];

  if (inviter?.id) {
    details.push(
      `τον έφερε ${mentionWithId(inviter)}`,
      inviteCode ? code(inviteCode) : null,
      `σύνολο **${Number.isFinite(totalInvites) ? totalInvites : 0}**`
    );
  } else {
    details.push('δεν βρέθηκε ποιος τον κάλεσε');
  }

  if (isFake) details.push(`fake — ${fakeReason || 'ξαναμπήκε'}`);

  return new EmbedBuilder()
    .setColor(isFake ? FAKE_COLOR : JOIN_COLOR)
    .setDescription(`${emoji('bot_join')} ${mention(user)} μπήκε${subtext(details)}`);
}

function buildLeaveEmbed({ user, stayedMs, inviter, inviterId, inviteCode, isFake, removal }) {
  const stayed = Number.isFinite(stayedMs) ? `έμεινε ${humanDuration(stayedMs)}` : null;

  const broughtBy = inviter
    ? `τον έφερε ${inviterId ? `${mention({ id: inviterId })} ${code(inviterId)}` : `**${inviter}**`}`
    : null;

  if (removal?.kind === 'kick' || removal?.kind === 'ban') {
    const banned = removal.kind === 'ban';
    const icon = banned ? emoji('bot_mod') : emoji('bot_kick');
    const verb = banned ? 'έφαγε ban' : 'έφαγε kick';
    const by = removal.executor ? ` από ${mention(removal.executor)}` : '';

    return new EmbedBuilder()
      .setColor(banned ? BAN_COLOR : KICK_COLOR)
      .setDescription(
        `${icon} ${mention(user)} ${verb}${by}`
        + subtext([
          user?.id ? code(user.id) : null,
          removal.reason ? `αιτία: «${removal.reason}»` : 'χωρίς αιτία',
          stayed,
          broughtBy
        ])
      );
  }

  return new EmbedBuilder()
    .setColor(isFake ? FAKE_COLOR : LEAVE_COLOR)
    .setDescription(
      `${emoji('bot_leave')} ${mention(user)} έφυγε`
      + subtext([
        user?.id ? code(user.id) : null,
        stayed,
        broughtBy,
        inviteCode ? code(inviteCode) : null,
        isFake ? 'μετράει ως fake' : null
      ])
    );
}

async function announce(channel, embed) {
  if (!channel || !embed) return false;

  try {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    log.warn('Could not post the invite event:', error.message || error);
    return false;
  }
}

module.exports = {
  fakeWindowMs,
  minAccountAgeMs,
  isFreshAccount,
  parseStoredTime,
  humanDuration,
  inviteLogChannel,
  rememberRemoval,
  recentRemoval,
  buildJoinEmbed,
  buildLeaveEmbed,
  announce,
  DEFAULT_FAKE_WINDOW_MS,
  REMOVAL_WINDOW_MS
};
