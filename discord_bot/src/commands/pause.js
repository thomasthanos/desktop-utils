const { SlashCommandBuilder } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { defineCommand } = require('../utils/command-context');
const { setPaused, musicGate } = require('../utils/music');

module.exports = {
  category: 'Music',
  aliases: ['pa', 'πα'],
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Κάνε κράτει. Παύση στο τραγούδι.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Αυτό δουλεύει μόνο μέσα σε server.');
    }

    const denied = musicGate(client, ctx);
    if (denied) return ctx.replyPrivate(denied);

    const result = setPaused(client, ctx.guildId, true);
    if (!result.ok) return ctx.replyPrivate('Δεν παίζει τίποτα αυτή τη στιγμή.');
    if (result.alreadyInState) return ctx.replyPrivate('Είναι ήδη σε παύση.');

    client.emit('dashboard:sync');
    return ctx.reply(`${emoji('bot_pause')} Πάγωσα. Πες πότε.`);
  })
};
