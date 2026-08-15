const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { defineCommand } = require('../utils/command-context');
const {
  getPlaybackState,
  getUpcoming,
  formatDuration,
  buildProgressBar,
  trackDurationMs
} = require('../utils/music');
const { getIdleLiveSession } = require('../idle-live');

module.exports = {
  category: 'Music',
  aliases: ['np', 'now', 'νπ'],
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show what is playing, with a progress bar.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('This command works only inside servers.');
    }

    const state = getPlaybackState(client, ctx.guildId);
    if (!state.hasAnything) {
      return ctx.replyPrivate('Nothing is playing right now.');
    }

    const embed = new EmbedBuilder().setColor(state.isPaused ? 0x95a5a6 : 0x1db954);

    if (state.idleActive) {
      // Το ραδιόφωνο είναι συνεχής ροή: δεν υπάρχει διάρκεια ούτε πρόοδος,
      // μόνο πόση ώρα ακούγεται.
      const session = getIdleLiveSession(client, ctx.guildId);
      const track = client.currentTrack;
      const elapsed = track?.startedAt ? Date.now() - track.startedAt : 0;

      embed
        .setTitle(state.isPaused ? '📻 Idle radio (paused)' : '📻 Idle radio')
        .setDescription(track?.title ? `**${track.title}**` : '*Live stream*')
        .addFields(
          { name: 'Source', value: track?.author || 'Unknown', inline: true },
          { name: 'Playing for', value: formatDuration(elapsed), inline: true },
          { name: 'Volume', value: `${session?.volume ?? '—'}%`, inline: true },
          { name: 'Progress', value: '🔴 LIVE', inline: false }
        );

      if (track?.thumbnail) embed.setThumbnail(track.thumbnail);
    } else {
      const track = state.queue.currentTrack;
      const totalMs = trackDurationMs(track);
      const elapsedMs = Number(state.queue.node?.streamTime) || 0;
      const upcoming = getUpcoming(client, ctx.guildId);

      embed
        .setTitle(state.isPaused ? '⏸ Paused' : '▶ Now playing')
        .setDescription(track.url ? `**[${track.title}](${track.url})**` : `**${track.title}**`)
        .addFields(
          { name: 'Artist', value: track.author || 'Unknown', inline: true },
          { name: 'Requested by', value: String(track.requestedBy || 'Unknown'), inline: true },
          { name: 'Volume', value: `${state.queue.node?.volume ?? '—'}%`, inline: true },
          {
            name: 'Progress',
            value: `${buildProgressBar(elapsedMs, totalMs)}\n\`${formatDuration(elapsedMs)} / ${totalMs ? formatDuration(totalMs) : 'LIVE'}\``,
            inline: false
          }
        );

      if (upcoming.length > 0) {
        embed.addFields({ name: 'Up next', value: `${upcoming[0].title}${upcoming.length > 1 ? ` *(+${upcoming.length - 1} more)*` : ''}`, inline: false });
      }
      if (track.thumbnail) embed.setThumbnail(track.thumbnail);
    }

    return ctx.reply({ embeds: [embed] });
  })
};
