const { SlashCommandBuilder } = require('discord.js');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState } = require('../utils/music');
const { getIdlePendingList } = require('../idle-pending');

module.exports = {
  category: 'Music',
  aliases: ['rm', 'ρμ'],
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue by its position.')
    .addIntegerOption((option) =>
      option
        .setName('position')
        .setDescription('Position shown by /queue (1 = next up)')
        .setRequired(true)
        .setMinValue(1)
    ),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('This command works only inside servers.');
    }

    const raw = ctx.option('position');
    const position = Number.parseInt(raw, 10);
    if (!Number.isFinite(position) || position < 1) {
      return ctx.replyPrivate('Give a position number, e.g. `3` — see `/queue` for the list.');
    }

    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);

    // Οι θέσεις που βλέπει ο χρήστης ξεκινούν από το 1.
    const index = position - 1;

    const list = idleActive
      ? getIdlePendingList(client, ctx.guildId)
      : queue?.tracks?.data;

    if (!Array.isArray(list) || list.length === 0) {
      return ctx.replyPrivate('The queue is empty.');
    }
    if (index >= list.length) {
      return ctx.replyPrivate(`Position ${position} is out of range — the queue has ${list.length} track(s).`);
    }

    const [removed] = list.splice(index, 1);
    const title = removed?.title || removed?.query || 'track';

    client.emit('dashboard:sync');
    return ctx.reply(`Removed **${title}** from position ${position}.`);
  })
};
