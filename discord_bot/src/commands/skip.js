const { SlashCommandBuilder } = require('discord.js');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState } = require('../utils/music');
const { hasIdlePending, startNextPendingTrack } = require('../idle-pending');
const { getIdleLiveSession } = require('../idle-live');

module.exports = {
  category: 'Music',
  aliases: ['sk', 'next', 'σκ'],
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('This command works only inside servers.');
    }

    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);

    // Στο ραδιόφωνο δεν υπάρχει "επόμενο κομμάτι" — παίζει ένα συνεχές stream.
    // Το skip έχει νόημα μόνο αν κάποιος έχει βάλει κομμάτια στην αναμονή.
    if (idleActive) {
      if (!hasIdlePending(client, ctx.guildId)) {
        return ctx.replyPrivate('Idle radio is playing and the pending queue is empty — nothing to skip to.');
      }
      const session = getIdleLiveSession(client, ctx.guildId);
      const voiceChannelId = session?.connection?.joinConfig?.channelId || null;
      const voiceChannel = voiceChannelId ? ctx.guild.channels.cache.get(voiceChannelId) : null;
      await startNextPendingTrack(client, ctx.guild, voiceChannel, session?.textChannel || ctx.channel, {
        destroyIdleConnection: false
      });
      client.emit('dashboard:sync');
      return ctx.reply('Skipped to the next pending track.');
    }

    if (!queue?.currentTrack) {
      return ctx.replyPrivate('Nothing is playing right now.');
    }

    const title = queue.currentTrack.title;

    // Με άδεια ουρά το skip() δεν έχει πού να πάει· το stop() τερματίζει καθαρά
    // και αφήνει τον handler του emptyQueue να αποφασίσει τι ακολουθεί.
    if (queue.size <= 0) {
      queue.node.stop();
    } else if (!queue.node.skip()) {
      queue.node.stop();
    }

    client.emit('dashboard:sync');
    return ctx.reply(`Skipped **${title}**.`);
  })
};
