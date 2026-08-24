const { SlashCommandBuilder } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { QueueRepeatMode } = require('discord-player');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState, musicGate } = require('../utils/music');

const MODES = {
  off: { value: QueueRepeatMode.OFF, label: 'Επανάληψη: Κλειστή' },
  track: { value: QueueRepeatMode.TRACK, label: 'Επανάληψη του τρέχοντος κομματιού' },
  queue: { value: QueueRepeatMode.QUEUE, label: 'Επανάληψη όλης της ουράς' }
};

const CYCLE = ['off', 'track', 'queue'];

module.exports = {
  category: 'Music',
  aliases: ['lp', 'repeat', 'λπ'],
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Κολλήσαμε; Βάλε το τραγούδι (ή όλα) στο repeat.')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Άφησέ το κενό για να αλλάξεις τις λειτουργίες')
        .setRequired(false)
        .addChoices(
          { name: 'off', value: 'off' },
          { name: 'track', value: 'track' },
          { name: 'queue', value: 'queue' }
        )
    ),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Αυτό δουλεύει μόνο μέσα σε server.');
    }

    const denied = musicGate(client, ctx);
    if (denied) return ctx.replyPrivate(denied);

    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);

    if (idleActive) {
      return ctx.replyPrivate('Το ραδιόφωνο είναι ζωντανή μετάδοση — δεν παίρνει επανάληψη.');
    }
    if (!queue?.currentTrack) {
      return ctx.replyPrivate('Δεν παίζει τίποτα αυτή τη στιγμή.');
    }

    const requested = String(ctx.option('mode') || '').trim().toLowerCase();
    let modeKey;

    if (requested) {
      if (!MODES[requested]) {
        return ctx.replyPrivate('Η λειτουργία πρέπει να είναι μία από: `off`, `track`, `queue`.');
      }
      modeKey = requested;
    } else {
      const currentIndex = CYCLE.findIndex((key) => MODES[key].value === queue.repeatMode);
      modeKey = CYCLE[(currentIndex + 1) % CYCLE.length];
    }

    queue.setRepeatMode(MODES[modeKey].value);
    client.emit('dashboard:sync');
    return ctx.reply(`${emoji('bot_loop')} ${MODES[modeKey].label}.`);
  })
};
