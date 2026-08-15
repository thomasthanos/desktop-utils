const { MessageFlags } = require('discord.js');
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

    // Άμυνα σε βάθος. Το Discord δεν πρέπει να παραδίδει εντολή που δεν
    // καταχωρήθηκε για DM, αλλά ο έλεγχος εξουσιοδότησης παρακάτω εξαρτάται
    // από την ύπαρξη guild: ό,τι δεν δηλώνει ρητά `dmCapable` θα προσπερνούσε
    // τον έλεγχο αντί να τον περάσει.
    if (!interaction.inGuild() && !command.dmCapable) {
      await interaction.reply({
        content: 'Αυτή η εντολή δουλεύει μόνο μέσα σε server.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      // Το /addauthorized εξαιρείται πάντα, αλλιώς ένας λάθος περιορισμός θα
      // σε κλείδωνε έξω από το εργαλείο που τον διορθώνει.
      if (
        interaction.inGuild()
        && interaction.commandName !== 'addauthorized'
        && database.hasAuthorizedEntriesForCommand(interaction.guildId, interaction.commandName)
        && !isCommandAuthorized(interaction, database, interaction.commandName)
      ) {
        await interaction.reply({
          content: `You are not authorized to use \`/${interaction.commandName}\`.`,
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
      const reply = { content: 'An error occurred while executing this command.', flags: MessageFlags.Ephemeral };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
          return;
        }
        await interaction.reply(reply);
      } catch (responseError) {
        // 40060 = ήδη απαντημένο, 10062 = άγνωστο interaction (έληξε το token).
        // Και τα δύο είναι θόρυβος όταν η αρχική εντολή έχει ήδη αποτύχει.
        const code = responseError?.code;
        if (code !== 40060 && code !== 10062) {
          log.error('Failed to send interaction error response:', responseError);
        }
      }
    }
  });
}

module.exports = { register };
