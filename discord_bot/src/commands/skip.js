const { SlashCommandBuilder } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState, musicGate } = require('../utils/music');
const { hasIdlePending, startNextPendingTrack } = require('../idle-pending');
const { getIdleLiveSession } = require('../idle-live');

module.exports = {
  category: 'Music',
  aliases: ['sk', 'next', 'σκ'],
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Επόμενο! Αυτό ήταν μάπα.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Μάστορα, αυτό το κουμπί πατιέται μόνο μέσα σε server!');
    }

    const denied = musicGate(client, ctx);
    if (denied) return ctx.replyPrivate(denied);

    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);

    if (idleActive) {
      if (!hasIdlePending(client, ctx.guildId)) {
        return ctx.replyPrivate('Παίζει το ραδιόφωνο και η ουρά αναμονής είναι άδεια — δεν υπάρχει κάτι για να γίνει skip.');
      }
      const session = getIdleLiveSession(client, ctx.guildId);
      const voiceChannelId = session?.connection?.joinConfig?.channelId || null;
      const voiceChannel = voiceChannelId ? ctx.guild.channels.cache.get(voiceChannelId) : null;
      await startNextPendingTrack(client, ctx.guild, voiceChannel, session?.textChannel || ctx.channel, {
        destroyIdleConnection: false
      });
      client.emit('dashboard:sync');
      return ctx.reply(`${emoji('bot_skip')} Πάμε στο επόμενο.`);
    }

    if (!queue?.currentTrack) {
      return ctx.reply(`${emoji('bot_warn')} Δεν παίζει τίποτα για να το κάνω skip.`);
    }

    const title = queue.currentTrack.title;

    if (queue.size <= 0) {
      queue.node.stop();
    } else if (!queue.node.skip()) {
      queue.node.stop();
    }

    client.emit('dashboard:sync');
    return ctx.reply(`${emoji('bot_skip')} Έφυγε το **${title}**. Δεν άρεσε σε κανέναν.`);
  })
};
