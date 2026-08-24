const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { stopIdleLive, isIdleLiveActive } = require('../idle-live');
const { clearIdlePending } = require('../idle-pending');
const { teardownQueue, musicGate } = require('../utils/music');
const { clearCurrentTrack, currentTrackFor } = require('../utils/now-playing');
const log = require('../utils/logger')('stop');

module.exports = {
  category: 'Music',
  aliases: ['s', 'σ'],
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Κομμένη η μουσική. Σκούπα στην ουρά και όλοι σπίτια τους.'),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: `${emoji('bot_warn')} Δεν παίζει τίποτα για να σταματήσω... Έλα σε έναν server να τα πούμε.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const guildId = interaction.guildId;

    const denied = musicGate(client, { guildId, user: interaction.user });
    if (denied) {
      await interaction.reply({ content: denied, flags: MessageFlags.Ephemeral });
      return;
    }

    const queue = client.player?.nodes?.get(guildId) || null;
    const idleActive = isIdleLiveActive(client, guildId);

    if (!queue && !idleActive && !currentTrackFor(client, guildId)) {
      await interaction.reply({
        content: `${emoji('bot_warn')} Δεν παίζει τίποτα για να σταματήσω... Ησυχία σαν βιβλιοθήκη.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const pendingCleared = clearIdlePending(client, guildId);
    client.autoIdleGuilds?.delete(guildId);

    if (client.emptyQueueTimers?.has(guildId)) {
      clearTimeout(client.emptyQueueTimers.get(guildId));
      client.emptyQueueTimers.delete(guildId);
    }

    try {
      teardownQueue(queue, log);

      if (idleActive) {
        await stopIdleLive(client, guildId, { destroyConnection: true });
      }

      clearCurrentTrack(client, guildId);
      client.musicEmbedByGuild?.delete(guildId);
      client.emit('dashboard:sync');

      await interaction.reply(
        `${emoji('bot_stop')} Όλα κομμένα! Έσβησα τη μουσική, άδειασα την ουρά και την έκανα (${pendingCleared} στην αναμονή).`
      );
    } catch (error) {
      log.error('stop command error:', error);
      await interaction.reply({
        content: `${emoji('bot_error')} Δεν μπόρεσα να σταματήσω. Επιμένει.`,
        flags: MessageFlags.Ephemeral
      });
    }
  },

  async prefixExecute(message, argsText, client) {
    const guildId = message.guild.id;

    const denied = musicGate(client, { guildId, user: message.author });
    if (denied) {
      await message.reply(denied);
      return;
    }

    const queue = client.player?.nodes?.get(guildId) || null;
    const idleActive = isIdleLiveActive(client, guildId);

    if (!queue && !idleActive && !currentTrackFor(client, guildId)) {
      await message.reply(`${emoji('bot_warn')} Δεν παίζει τίποτα για να σταματήσω... Ησυχία σαν βιβλιοθήκη.`);
      return;
    }

    const pendingCleared = clearIdlePending(client, guildId);
    client.autoIdleGuilds?.delete(guildId);
    if (client.emptyQueueTimers?.has(guildId)) {
      clearTimeout(client.emptyQueueTimers.get(guildId));
      client.emptyQueueTimers.delete(guildId);
    }

    teardownQueue(queue, log);

    if (idleActive) {
      await stopIdleLive(client, guildId, { destroyConnection: true });
    }

    clearCurrentTrack(client, guildId);
    client.musicEmbedByGuild?.delete(guildId);
    client.emit('dashboard:sync');
    await message.reply(`${emoji('bot_stop')} Όλα κομμένα! Έσβησα τη μουσική, άδειασα την ουρά και την έκανα (${pendingCleared} στην αναμονή).`);
  }
};
