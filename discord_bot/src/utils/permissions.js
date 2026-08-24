const { PermissionsBitField } = require('discord.js');
const { isBotOwner } = require('./authorization');

const CAPABILITIES = {
  view: {
    label: 'Επισκόπηση',
    note: 'Στατιστικά, τι παίζει τώρα, κατάσταση του bot',
    flag: PermissionsBitField.Flags.ManageGuild,
    flagLabel: 'Manage Server'
  },
  music: {
    label: 'Έλεγχος μουσικής',
    note: 'Play, pause, skip, ένταση — και πάλι μόνο μέσα από voice',
    flag: PermissionsBitField.Flags.ManageGuild,
    flagLabel: 'Manage Server'
  },
  commands: {
    label: 'Ιστορικό εντολών',
    note: 'Ποιος έτρεξε τι και πότε',
    flag: PermissionsBitField.Flags.ManageGuild,
    flagLabel: 'Manage Server'
  },
  invites: {
    label: 'Προσκλήσεις',
    note: 'Ποιος έφερε ποιον στον server',
    flag: PermissionsBitField.Flags.ManageGuild,
    flagLabel: 'Manage Server'
  },
  transcripts: {
    label: 'Ιστορικό διαγραφών',
    note: 'Το πλήρες κείμενο διαγραμμένων μηνυμάτων',
    flag: PermissionsBitField.Flags.Administrator,
    flagLabel: 'Administrator'
  }
};

const CAPABILITY_NAMES = Object.keys(CAPABILITIES);

function everything(value) {
  return Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, value]));
}

async function resolveMember(guild, userId) {
  if (!guild || !userId) return null;

  const cached = guild.members?.cache?.get(String(userId));
  if (cached) return cached;

  const pending = guild.members?.fetch?.(String(userId));
  if (!pending || typeof pending.catch !== 'function') return null;
  return pending.catch(() => null);
}

function discordAllows(member, capability) {
  const spec = CAPABILITIES[capability];
  if (!member || !spec) return false;
  return Boolean(member.permissions?.has?.(spec.flag));
}

async function capabilitiesFor(client, database, guildId, userId) {
  if (isBotOwner(userId)) return everything(true);
  if (!guildId || !userId) return everything(false);

  const guild = client?.guilds?.cache?.get(guildId) || null;
  if (!guild) return everything(false);

  const member = await resolveMember(guild, userId);

  let overrides = {};
  try {
    overrides = database?.getDashboardPermissions?.(guildId, userId) || {};
  } catch {
    overrides = {};
  }

  const result = {};
  for (const name of CAPABILITY_NAMES) {
    result[name] = name in overrides ? overrides[name] : discordAllows(member, name);
  }
  return result;
}

async function canManagePermissions(client, database, guildId, userId) {
  if (isBotOwner(userId)) return true;
  if (!guildId || !userId) return false;

  const guild = client?.guilds?.cache?.get(guildId) || null;
  if (!guild) return false;

  // Ο ιδιοκτήτης του server δεν κλειδώνεται ποτέ έξω — αλλιώς μια λάθος
  // ρύθμιση θα άφηνε τον server χωρίς κανέναν να μπορεί να τη διορθώσει.
  if (guild.ownerId && String(guild.ownerId) === String(userId)) return true;

  const member = await resolveMember(guild, userId);
  if (!member?.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return false;

  // Χωρίς αυτό, το να κλείσεις την Επισκόπηση σε έναν Administrator δεν έκανε
  // τίποτα: άνοιγε τη σελίδα δικαιωμάτων και την ξανάναβε μόνος του.
  let override;
  try {
    override = database?.getDashboardPermissions?.(guildId, userId)?.view;
  } catch {
    override = undefined;
  }
  return override !== false;
}

async function visibleGuilds(client, database, userId) {
  const guilds = [];

  for (const guild of client?.guilds?.cache?.values?.() || []) {
    const capabilities = await capabilitiesFor(client, database, guild.id, userId);
    if (!capabilities.view) continue;

    guilds.push({
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL?.({ size: 64, forceStatic: false }) || null
    });
  }

  return guilds.sort((a, b) => a.name.localeCompare(b.name));
}

async function canSeeAnyGuild(client, database, userId) {
  if (isBotOwner(userId)) return (client?.guilds?.cache?.size || 0) > 0;

  for (const guild of client?.guilds?.cache?.values?.() || []) {
    const capabilities = await capabilitiesFor(client, database, guild.id, userId);
    if (capabilities.view) return true;
  }
  return false;
}

module.exports = {
  CAPABILITIES,
  CAPABILITY_NAMES,
  capabilitiesFor,
  canManagePermissions,
  visibleGuilds,
  canSeeAnyGuild,
  discordAllows,
  resolveMember,
  everything
};
