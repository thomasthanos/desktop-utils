const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { PREFIX } = require('../prefix-commands');
const { musicGate } = require('../utils/music');

module.exports = {
  category: 'Music',
  aliases: ['v', 'β'],
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Τσίτα τα γκάζια (ή χαμήλωσε μην ξυπνήσουμε τους γείτονες).')
    .addIntegerOption((option) =>
      option
        .setName('level')
        .setDescription('Ένταση (1-100). Κενό για να δεις την τρέχουσα.')
        .setMinValue(0)
        .setMaxValue(100)
        .setRequired(false)
    ),

  async execute(interaction, client, database) {
    if (!interaction.guildId) {
      await interaction.reply({ content: `${emoji('bot_warn')} Αυτό δουλεύει μόνο μέσα σε server.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const { isIdleLiveActive, setIdleLiveVolume } = require('../idle-live');
    const queue = client.player?.nodes?.get(interaction.guildId);
    const idleActive = isIdleLiveActive(client, interaction.guildId);

    if (!queue && !idleActive) {
      await interaction.reply({ content: `${emoji('bot_warn')} Δεν παίζει τίποτα για να του αλλάξω ένταση.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const level = interaction.options.getInteger('level', false);
    if (level === null) {
      const current = queue ? queue.node.volume : database.getGuildVolume(interaction.guildId);
      await interaction.reply(`${emoji('bot_volume')} Ένταση: **${current}%**`);
      return;
    }

    const denied = musicGate(client, { guildId: interaction.guildId, user: interaction.user });
    if (denied) {
      await interaction.reply({ content: denied, flags: MessageFlags.Ephemeral });
      return;
    }

    database.setGuildVolume(interaction.guildId, level);
    if (queue) queue.node.setVolume(level);
    if (idleActive) setIdleLiveVolume(client, interaction.guildId, level);

    client.emit('dashboard:sync');
    await interaction.reply(`${emoji('bot_volume')} Ένταση στο **${level}%**.`);
  },

  async prefixExecute(message, argsText, client, database) {
    const { isIdleLiveActive, setIdleLiveVolume } = require('../idle-live');
    const queue = client.player?.nodes?.get(message.guild.id);
    const idleActive = isIdleLiveActive(client, message.guild.id);

    if (!queue && !idleActive) {
      await message.reply(`${emoji('bot_warn')} Δεν παίζει τίποτα αυτή τη στιγμή.`);
      return;
    }

    if (!argsText) {
      const current = queue ? queue.node.volume : database.getGuildVolume(message.guild.id);
      await message.reply(`${emoji('bot_volume')} Ένταση: **${current}%**`);
      return;
    }

    const level = Number.parseInt(argsText, 10);
    if (!Number.isInteger(level) || level < 0 || level > 100) {
      await message.reply(`Χρήση: \`${PREFIX}v <0-100>\``);
      return;
    }

    const denied = musicGate(client, { guildId: message.guild.id, user: message.author });
    if (denied) {
      await message.reply(denied);
      return;
    }

    database.setGuildVolume(message.guild.id, level);
    if (queue) queue.node.setVolume(level);
    if (idleActive) setIdleLiveVolume(client, message.guild.id, level);

    await message.reply(`${emoji('bot_volume')} Ένταση στο **${level}%**.`);
    client.emit('dashboard:sync');
  }
};
