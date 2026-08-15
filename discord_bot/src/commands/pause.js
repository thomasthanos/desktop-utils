const { SlashCommandBuilder } = require('discord.js');
const { defineCommand } = require('../utils/command-context');
const { setPaused } = require('../utils/music');

module.exports = {
  category: 'Music',
  aliases: ['pa', 'πα'],
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause playback.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('This command works only inside servers.');
    }

    const result = setPaused(client, ctx.guildId, true);
    if (!result.ok) return ctx.replyPrivate('Nothing is playing right now.');
    if (result.alreadyInState) return ctx.replyPrivate('Already paused.');

    client.emit('dashboard:sync');
    return ctx.reply('Paused.');
  })
};
