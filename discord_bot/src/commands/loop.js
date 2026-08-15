const { SlashCommandBuilder } = require('discord.js');
const { QueueRepeatMode } = require('discord-player');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState } = require('../utils/music');

const MODES = {
  off: { value: QueueRepeatMode.OFF, label: 'Loop off' },
  track: { value: QueueRepeatMode.TRACK, label: 'Looping the current track' },
  queue: { value: QueueRepeatMode.QUEUE, label: 'Looping the whole queue' }
};

// Χωρίς όρισμα κάνει κύκλο off -> track -> queue -> off.
const CYCLE = ['off', 'track', 'queue'];

module.exports = {
  category: 'Music',
  aliases: ['lp', 'repeat', 'λπ'],
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Set repeat mode: off, track or queue.')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Leave empty to cycle through the modes')
        .setRequired(false)
        .addChoices(
          { name: 'off', value: 'off' },
          { name: 'track', value: 'track' },
          { name: 'queue', value: 'queue' }
        )
    ),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('This command works only inside servers.');
    }

    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);

    // Το ραδιόφωνο είναι ήδη ατέρμονο stream — η επανάληψη δεν σημαίνει τίποτα.
    if (idleActive) {
      return ctx.replyPrivate('Idle radio is a continuous stream — repeat does not apply.');
    }
    if (!queue?.currentTrack) {
      return ctx.replyPrivate('Nothing is playing right now.');
    }

    const requested = String(ctx.option('mode') || '').trim().toLowerCase();
    let modeKey;

    if (requested) {
      if (!MODES[requested]) {
        return ctx.replyPrivate('Mode must be one of: `off`, `track`, `queue`.');
      }
      modeKey = requested;
    } else {
      const currentIndex = CYCLE.findIndex((key) => MODES[key].value === queue.repeatMode);
      modeKey = CYCLE[(currentIndex + 1) % CYCLE.length];
    }

    queue.setRepeatMode(MODES[modeKey].value);
    client.emit('dashboard:sync');
    return ctx.reply(`🔁 ${MODES[modeKey].label}.`);
  })
};
