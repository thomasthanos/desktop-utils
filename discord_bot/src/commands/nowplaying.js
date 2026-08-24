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
const { emoji, plainEmoji } = require('../utils/emojis');

module.exports = {
  category: 'Music',
  aliases: ['np', 'now', 'νπ'],
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Τι θόρυβος είναι αυτός; Δες τι παίζει τώρα.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Αυτό δουλεύει μόνο μέσα σε server.');
    }

    const state = getPlaybackState(client, ctx.guildId);
    if (!state.hasAnything) {
      return ctx.replyPrivate('Δεν παίζει τίποτα αυτή τη στιγμή.');
    }

    const embed = new EmbedBuilder().setColor(state.isPaused ? 0x95a5a6 : 0x1db954);

    if (state.idleActive) {
      const session = getIdleLiveSession(client, ctx.guildId);
      const track = require('../utils/now-playing').currentTrackFor(client, ctx.guildId);
      const elapsed = track?.startedAt ? Date.now() - track.startedAt : 0;

      embed
        .setTitle(state.isPaused ? `${plainEmoji('bot_radio')} Ραδιόφωνο (σε παύση)` : `${plainEmoji('bot_radio')} Ραδιόφωνο`)
        .setDescription(track?.title ? `**${track.title}**` : '*Ζωντανή μετάδοση*')
        .addFields(
          { name: 'Πηγή', value: track?.author || 'Άγνωστη', inline: true },
          { name: 'Παίζει εδώ και', value: formatDuration(elapsed), inline: true },
          { name: 'Ένταση', value: `${session?.volume ?? '—'}%`, inline: true },
          { name: 'Πρόοδος', value: `${emoji('bot_radio')} LIVE`, inline: false }
        );

      if (track?.thumbnail) embed.setThumbnail(track.thumbnail);
    } else {
      const track = state.queue.currentTrack;
      const totalMs = trackDurationMs(track);
      const elapsedMs = Number(state.queue.node?.streamTime) || 0;
      const upcoming = getUpcoming(client, ctx.guildId);

      embed
        .setTitle(state.isPaused ? `${plainEmoji('bot_pause')} Σε παύση` : `${plainEmoji('bot_play')} Αναπαράγεται τώρα`)
        .setDescription(track.url ? `**[${track.title}](${track.url})**` : `**${track.title}**`)
        .addFields(
          { name: 'Καλλιτέχνης', value: track.author || 'Άγνωστος', inline: true },
          { name: 'Ζητήθηκε από', value: String(track.requestedBy || 'Άγνωστος'), inline: true },
          { name: 'Ένταση', value: `${state.queue.node?.volume ?? '—'}%`, inline: true },
          {
            name: 'Πρόοδος',
            value: `${buildProgressBar(elapsedMs, totalMs)}\n\`${formatDuration(elapsedMs)} / ${totalMs ? formatDuration(totalMs) : 'LIVE'}\``,
            inline: false
          }
        );

      if (upcoming.length > 0) {
        embed.addFields({ name: 'Επόμενο', value: `${upcoming[0].title}${upcoming.length > 1 ? ` *(+${upcoming.length - 1} ακόμη)*` : ''}`, inline: false });
      }
      if (track.thumbnail) embed.setThumbnail(track.thumbnail);
    }

    return ctx.reply({ embeds: [embed] });
  })
};
