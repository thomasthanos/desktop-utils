const { isCommandAuthorized } = require('./utils/authorization');
const { emoji } = require('./utils/emojis');

const log = require('./utils/logger')('prefix');

const PREFIX = process.env.COMMAND_PREFIX || '!';

function normalizeAlias(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

let aliasMap = null;

function getAliasMap(client) {
  if (aliasMap) return aliasMap;
  aliasMap = new Map();

  client.commands.forEach((cmd) => {
    const name = cmd.data.name;
    aliasMap.set(normalizeAlias(name), name);

    if (Array.isArray(cmd.aliases)) {
      for (const alias of cmd.aliases) {
        aliasMap.set(normalizeAlias(alias), name);
      }
    }
  });

  return aliasMap;
}

function canUseCommand(message, database, commandName) {
  if (!message.guild) return false;
  if (!database.hasAuthorizedEntriesForCommand(message.guild.id, commandName)) return true;
  const pseudoInteraction = {
    inGuild: () => Boolean(message.guild),
    user: message.author,
    member: message.member,
    guild: message.guild,
    guildId: message.guild.id
  };
  return isCommandAuthorized(pseudoInteraction, database, commandName);
}

async function handlePrefixMessage(message, client, database, emitCommandLogsSync, emitDashboardSync) {
  if (!message.guild || message.author.bot) return false;
  if (!message.content.startsWith(PREFIX)) return false;

  const withoutPrefix = message.content.slice(PREFIX.length).trim();
  if (!withoutPrefix) return false;

  const [rawAlias] = withoutPrefix.split(/\s+/);
  const argsText = withoutPrefix.slice(rawAlias.length).trim();

  const map = getAliasMap(client);
  const commandName = map.get(normalizeAlias(rawAlias));
  if (!commandName) return false;

  const command = client.commands.get(commandName);
  if (!command) return false;

  if (!canUseCommand(message, database, commandName)) {
    await message.reply(`${emoji('bot_error')} Δεν έχεις δικαίωμα για το \`${PREFIX}${rawAlias}\`. Ωραία προσπάθεια.`);
    return true;
  }

  database.logCommand(commandName, message.author, message.guild, message.channel.id);
  emitCommandLogsSync();

  try {
    if (typeof command.prefixExecute === 'function') {
      await command.prefixExecute(message, argsText, client, database);
    } else {
      await message.reply(`${emoji('bot_warn')} Αυτή δουλεύει μόνο ως \`/${commandName}\`.`);
    }
  } catch (error) {
    log.error(`prefix ${commandName} error:`, error);
    await message.reply(`${emoji('bot_error')} Κάτι έσπασε. Το κατέγραψα, μην ανησυχείς.`);
  }

  emitDashboardSync();
  return true;
}

module.exports = {
  PREFIX,
  handlePrefixMessage
};
