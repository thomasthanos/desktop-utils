const { SlashCommandBuilder } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { defineCommand } = require('../utils/command-context');
const { setPaused, musicGate } = require('../utils/music');

module.exports = {
  category: 'Music',
  aliases: ['re', 'unpause', 'ρε'],
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Φύγαμε! Συνέχισε τη μουσική.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Αυτό δουλεύει μόνο μέσα σε server.');
    }

    const denied = musicGate(client, ctx);
    if (denied) return ctx.replyPrivate(denied);

    const result = setPaused(client, ctx.guildId, false);
    if (!result.ok) return ctx.replyPrivate('Δεν παίζει τίποτα αυτή τη στιγμή.');
    if (result.alreadyInState) return ctx.replyPrivate('Παίζει ήδη.');

    client.emit('dashboard:sync');
    return ctx.reply(`${emoji('bot_play')} Και συνεχίζουμε.`);
  })
};
