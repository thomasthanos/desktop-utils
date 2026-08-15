const { SlashCommandBuilder } = require('discord.js');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState, parseTimestamp, formatDuration, trackDurationMs } = require('../utils/music');

const log = require('../utils/logger')('seek');
module.exports = {
  category: 'Music',
  aliases: ['se', 'σε'],
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Jump to a position in the current track.')
    .addStringOption((option) =>
      option
        .setName('position')
        .setDescription('Seconds (90), mm:ss (1:30) or 1m30s')
        .setRequired(true)
    ),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('This command works only inside servers.');
    }

    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);

    // Μια ζωντανή ροή δεν έχει χρονική γραμμή να μετακινηθείς μέσα της.
    if (idleActive) {
      return ctx.replyPrivate('Idle radio is a live stream — seeking is not possible.');
    }
    if (!queue?.currentTrack) {
      return ctx.replyPrivate('Nothing is playing right now.');
    }

    const targetMs = parseTimestamp(ctx.option('position'));
    if (targetMs === null) {
      return ctx.replyPrivate('Could not read that position. Use `90`, `1:30` or `1m30s`.');
    }

    const totalMs = trackDurationMs(queue.currentTrack);
    if (totalMs > 0 && targetMs > totalMs) {
      return ctx.replyPrivate(`That is past the end of the track (${formatDuration(totalMs)}).`);
    }

    try {
      await queue.node.seek(targetMs);
    } catch (error) {
      log.error('Failed:', error.message);
      return ctx.replyPrivate('This track does not support seeking.');
    }

    client.emit('dashboard:sync');
    return ctx.reply(`Jumped to \`${formatDuration(targetMs)}\`.`);
  })
};
