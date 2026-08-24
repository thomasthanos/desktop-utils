const { Collection, REST, Routes } = require('discord.js');
const crypto = require('crypto');
const startDashboard = require('../dashboard/server');
const { startIdleLive } = require('../idle-live');
const { startAttachmentGc } = require('../utils/attachment-gc');
const { notifyOwner, startDailyDigest } = require('../utils/notify');
const { loadEmojis } = require('../utils/emojis');
const log = require('../utils/logger')('startup');

async function restoreIdleSessions(client, database) {
  let rows;
  try {
    rows = database.getIdleStatesToRestore();
  } catch (error) {
    log.error('Could not read persisted idle state:', error.message);
    return;
  }
  if (rows.length === 0) return;

  for (const row of rows) {
    const guildId = row.guild_id;
    const forget = () => {
      try {
        database.setIdleState(guildId, { voiceChannelId: null, textChannelId: null, active: false });
      } catch {}
    };

    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) { forget(); continue; }

      const voiceChannel = guild.channels.cache.get(row.active_voice_channel);
      if (!voiceChannel) {
        log.warn(`Voice channel ${row.active_voice_channel} is gone in ${guild.name} — forgetting.`);
        forget();
        continue;
      }

      const textChannel = row.active_text_channel
        ? guild.channels.cache.get(row.active_text_channel) || null
        : null;

      await startIdleLive(client, guild, voiceChannel, textChannel, client.user);
      log.info(`Idle radio resumed in ${guild.name} / #${voiceChannel.name}`);
    } catch (error) {
      log.error(`Could not resume idle radio in guild ${guildId}:`, error.message);
    }
  }
}

function applicationId() {
  return process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || null;
}

async function registerGuildCommands(guildId, slashCommands, token) {
  const clientId = applicationId();
  if (!clientId || !guildId || !slashCommands?.length) return false;

  try {
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: slashCommands });
    log.info(`Registered ${slashCommands.length} commands in the new guild ${guildId}.`);
    return true;
  } catch (error) {
    log.error(`Could not register commands in ${guildId}:`, error.message || error);
    return false;
  }
}

async function registerSlashCommands(client, database, slashCommands, dmCommands, token) {
  if (!applicationId()) {
    log.warn('DISCORD_CLIENT_ID (or CLIENT_ID) is missing. Slash command registration was skipped.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    const explicitGuildId = process.env.GUILD_ID;
    const targetGuildIds = explicitGuildId ? [explicitGuildId] : [...client.guilds.cache.keys()];

    const commandsHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        commands: slashCommands,
        dm: dmCommands,
        guilds: [...targetGuildIds].sort()
      }))
      .digest('hex');

    if (database.getStat('commands_hash') === commandsHash) {
      log.info(`Slash commands unchanged (${slashCommands.length}) — skipping registration.`);
      return;
    }

    log.info('Registering slash commands...');

    const clearGlobal = String(process.env.CLEAR_GLOBAL_COMMANDS || '0') !== '0';
    if (clearGlobal) {
      await rest.put(Routes.applicationCommands(applicationId()), { body: [] });
      log.info('Cleared global slash commands.');
    }

    for (const guildId of targetGuildIds) {
      await rest.put(Routes.applicationGuildCommands(applicationId(), guildId), { body: slashCommands });
    }

    if (!clearGlobal) {
      await rest.put(Routes.applicationCommands(applicationId()), { body: dmCommands });
    }

    database.setStat('commands_hash', commandsHash);
    log.info(
      `Registered ${slashCommands.length} commands in ${targetGuildIds.length} guild(s)`
      + `, ${dmCommands.length} in DMs.`
    );
    if (dmCommands.length > 0) {
      log.info('DM commands can take up to an hour to appear the first time.');
    }
  } catch (error) {
    log.error('Error registering commands:', error);
  }
}

function register({ client, database, sync, runtime, slashCommands, dmCommands, token }) {
  client.once('clientReady', async () => {
    log.info(`Logged in as ${client.user.tag}`);

    await loadEmojis(client);

    if (database.getStat('clean_shutdown') === '0') {
      log.warn('Previous shutdown was not clean — the bot crashed or was killed.');
      notifyOwner(
        client,
        'crash-restart',
        'Το bot ξαναξεκίνησε μετά από μη καθαρή έξοδο — crash, τερματισμό λόγω '
        + 'μνήμης ή διακοπή ρεύματος. Είναι ξανά online και λειτουργικό.'
      ).catch(() => {});
    }
    database.setStat('clean_shutdown', '0');
    database.setStat('start_time', Date.now());

    for (const guild of client.guilds.cache.values()) {
      try {
        const invites = await guild.invites.fetch();
        client.inviteCache.set(guild.id, new Collection(invites.map((inv) => [inv.code, inv.uses])));
      } catch {
        log.info(`Could not cache invites for ${guild.name}`);
      }
    }

    await registerSlashCommands(client, database, slashCommands, dmCommands, token);

    try {
      runtime.dashboard = await startDashboard(client, database);
    } catch (error) {
      log.error('Failed to start dashboard:', error);
    }

    if (!process.env.BOT_OWNER_ID && !process.env.BOT_OWNER_IDS) {
      log.warn('BOT_OWNER_ID is not set — owner-only features are disabled.');
    }

    startAttachmentGc(client);
    try {
      const pruned = database.pruneDailyStats();
      if (pruned) log.info(`Pruned ${pruned} daily counter row(s) older than 30 days.`);
    } catch (error) {
      log.debug('Could not prune daily counters:', error.message);
    }

    startDailyDigest(client);
    await restoreIdleSessions(client, database);

    sync.emitDashboardSync();
    sync.emitCommandLogsSync();
  });
}

module.exports = { registerGuildCommands, register, restoreIdleSessions };
