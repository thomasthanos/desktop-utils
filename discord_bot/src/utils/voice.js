const log = require('./logger')('voice');

function countHumans(channel) {
  if (!channel?.members) return 0;
  return channel.members.filter((member) => !member.user.bot).size;
}

function isVoiceEmpty(channel) {
  if (!channel?.members) return false;
  return countHumans(channel) === 0;
}

function buildNodeOptions(database, guildId, metadata, overrides = {}) {
  const stay = Boolean(database.getStay247?.(guildId));

  return {
    metadata,
    leaveOnEnd: !stay,
    leaveOnEndCooldown: LEAVE_ON_END_COOLDOWN_MS,
    leaveOnStop: !stay,
    leaveOnStopCooldown: LEAVE_ON_STOP_COOLDOWN_MS,

    leaveOnEmpty: !stay,
    leaveOnEmptyCooldown: emptyGraceMs(),
    volume: database.getGuildVolume(guildId),
    ...overrides
  };
}

const LEAVE_ON_END_COOLDOWN_MS = 300000;
const LEAVE_ON_STOP_COOLDOWN_MS = 120000;
const DEFAULT_EMPTY_GRACE_MS = 300000;

function emptyGraceMs() {
  const raw = Number(process.env.VOICE_EMPTY_GRACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_EMPTY_GRACE_MS;
}

async function findUserVoiceGuild(client, userId) {
  if (!userId) return null;

  const scanned = [];

  for (const guild of client.guilds?.cache?.values?.() || []) {
    const state = guild.voiceStates?.cache?.get(userId);
    scanned.push(`${guild.name}${state?.channelId ? '=' + state.channelId : ''}`);
    if (!state?.channelId) continue;

    const member = state.member
      || guild.members?.cache?.get(userId)
      || await guild.members?.fetch?.(userId).catch(() => null);

    if (member) return { guild, member };
    log.warn(`${userId} is in voice in ${guild.name} but the member could not be resolved.`);
  }

  log.info(`No voice channel found for ${userId}. Guilds searched: ${scanned.join(', ') || 'ΚΑΝΕΝΑ'}`);
  return null;
}

function canControlMusic(client, guildId, userId) {
  if (!guildId) {
    return { ok: false, reason: 'no-guild', message: 'Διάλεξε πρώτα server.' };
  }

  if (!userId) {
    return {
      ok: false,
      reason: 'no-identity',
      message: 'Συνδέσου με Discord για να χειριστείς τη μουσική.'
    };
  }

  const guild = client?.guilds?.cache?.get(guildId);
  if (!guild) {
    return { ok: false, reason: 'unknown-guild', message: 'Δεν βρίσκω αυτόν τον server.' };
  }

  const state = guild.voiceStates?.cache?.get(String(userId)) || null;
  const userChannelId = state?.channelId || null;

  if (!userChannelId) {
    return {
      ok: false,
      reason: 'not-in-voice',
      message: `Μπες σε ένα voice κανάλι στον ${guild.name} για να χειριστείς τη μουσική.`
    };
  }

  if (guild.afkChannelId && userChannelId === guild.afkChannelId) {
    return {
      ok: false,
      reason: 'afk-channel',
      message: 'Είσαι στο AFK κανάλι. Έλα εκεί που ακούγεται η μουσική.'
    };
  }

  if (state?.serverDeaf) {
    return {
      ok: false,
      reason: 'server-deafened',
      message: 'Είσαι deafened από τη διαχείριση — δεν αλλάζεις μουσική που δεν ακούς.'
    };
  }

  const botChannelId = guild.members?.me?.voice?.channelId || null;
  if (botChannelId && botChannelId !== userChannelId) {
    return {
      ok: false,
      reason: 'other-channel',
      message: 'Παίζω σε άλλο κανάλι. Έλα σε αυτό για να με χειριστείς.'
    };
  }

  return { ok: true, reason: 'ok', message: null };
}

function applyStay247(queue, stay) {
  if (!queue?.options) return false;

  queue.options.leaveOnEnd = !stay;
  queue.options.leaveOnStop = !stay;
  queue.options.leaveOnEmpty = !stay;

  if (stay && queue.timeouts) {
    for (const [key, timer] of queue.timeouts) {
      if (!String(key).startsWith('empty_')) continue;
      clearTimeout(timer);
      queue.timeouts.delete(key);
    }
  }

  return true;
}

module.exports = {
  countHumans,
  isVoiceEmpty,
  buildNodeOptions,
  emptyGraceMs,
  applyStay247,
  findUserVoiceGuild,
  canControlMusic,
  LEAVE_ON_END_COOLDOWN_MS,
  LEAVE_ON_STOP_COOLDOWN_MS
};
