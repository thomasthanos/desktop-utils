const { MessageFlags } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { isCommandAuthorized } = require('../utils/authorization');
const { bump } = require('../utils/notify');
const log = require('../utils/logger')('interaction');

function register({ client, database, sync }) {
  const { emitDashboardSync, emitCommandLogsSync } = sync;

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction, client, database);
        } catch (error) {
          log.error(`Autocomplete error for ${interaction.commandName}:`, error);
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    if (!interaction.inGuild() && !command.dmCapable) {
      await interaction.reply({
        content: 'Αυτή η εντολή δουλεύει μόνο μέσα σε server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      if (
        interaction.inGuild()
        && interaction.commandName !== 'addauthorized'
        && database.hasAuthorizedEntriesForCommand(interaction.guildId, interaction.commandName)
        && !isCommandAuthorized(interaction, database, interaction.commandName)
      ) {
        await interaction.reply({
          content: `${emoji('bot_error')} Δεν έχεις δικαίωμα για το /${interaction.commandName}. Ωραία προσπάθεια.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      database.logCommand(interaction.commandName, interaction.user, interaction.guild, interaction.channelId);
      emitCommandLogsSync();
      await command.execute(interaction, client, database);
      bump('commands');
      emitDashboardSync();
    } catch (error) {
      bump('errors');
      log.error(`Error executing ${interaction.commandName}:`, error);
      const reply = { content: `${emoji('bot_error')} Κάτι έσπασε. Το κατέγραψα, μην ανησυχείς.`, flags: MessageFlags.Ephemeral };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
          return;
        }
        await interaction.reply(reply);
      } catch (responseError) {
        const code = responseError?.code;
        if (code !== 40060 && code !== 10062) {
          log.error('Failed to send interaction error response:', responseError);
        }
      }
    }
  });
}

module.exports = { register };
