const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState, getUpcoming, formatDuration, trackDurationMs } = require('../utils/music');

const PAGE_SIZE = 10;
const COLLECTOR_MS = 120000;

function buildEmbed(state, upcoming, page, guildName) {
  const pages = Math.max(1, Math.ceil(upcoming.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const slice = upcoming.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle(`🎵 Queue — ${guildName}`);

  const current = state.idleActive
    ? '📻 **Idle radio** (live stream)'
    : state.queue?.currentTrack
      ? `**${state.queue.currentTrack.title}** — ${state.queue.currentTrack.author || 'Unknown'}`
      : '*Nothing playing*';

  embed.addFields({
    name: state.isPaused ? 'Now playing (paused)' : 'Now playing',
    value: current,
    inline: false
  });

  if (upcoming.length === 0) {
    embed.addFields({ name: 'Up next', value: '*Queue is empty*', inline: false });
  } else {
    const lines = slice.map((track, index) => {
      const position = safePage * PAGE_SIZE + index + 1;
      const duration = track.duration ? ` \`${track.duration}\`` : '';
      return `\`${String(position).padStart(2, ' ')}.\` ${track.title}${duration}`;
    });
    embed.addFields({ name: `Up next — ${upcoming.length} track(s)`, value: lines.join('\n'), inline: false });

    const totalMs = upcoming.reduce((sum, t) => sum + trackDurationMs(t), 0);
    if (totalMs > 0) embed.setDescription(`Total remaining: **${formatDuration(totalMs)}**`);
  }

  embed.setFooter({ text: `Page ${safePage + 1} / ${pages}` });
  return { embed, pages, safePage };
}

function buildButtons(page, pages, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('queue_prev').setLabel('◀').setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page <= 0),
    new ButtonBuilder().setCustomId('queue_next').setLabel('▶').setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= pages - 1)
  );
}

module.exports = {
  category: 'Music',
  aliases: ['q', 'list', 'κ'],
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('This command works only inside servers.');
    }

    const state = getPlaybackState(client, ctx.guildId);
    if (!state.hasAnything) {
      return ctx.replyPrivate('Nothing is playing right now.');
    }

    const upcoming = getUpcoming(client, ctx.guildId);
    let page = 0;
    const { embed, pages } = buildEmbed(state, upcoming, page, ctx.guild.name);

    // Χωρίς πολλαπλές σελίδες τα κουμπιά είναι σκέτος θόρυβος.
    const useButtons = pages > 1;
    const reply = await ctx.reply({
      embeds: [embed],
      components: useButtons ? [buildButtons(page, pages)] : [],
      fetchReply: true
    });

    if (!useButtons || typeof reply?.createMessageComponentCollector !== 'function') return;

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: COLLECTOR_MS
    });

    collector.on('collect', async (buttonInteraction) => {
      if (buttonInteraction.user.id !== ctx.user.id) {
        await buttonInteraction.reply({ content: 'Only the person who ran the command can page through it.', ephemeral: true });
        return;
      }
      page += buttonInteraction.customId === 'queue_next' ? 1 : -1;

      // Η ουρά αλλάζει ενόσω κοιτάς — ξαναδιαβάζουμε αντί να δείχνουμε στιγμιότυπο.
      const freshState = getPlaybackState(client, ctx.guildId);
      const freshUpcoming = getUpcoming(client, ctx.guildId);
      const rebuilt = buildEmbed(freshState, freshUpcoming, page, ctx.guild.name);
      page = rebuilt.safePage;

      await buttonInteraction.update({
        embeds: [rebuilt.embed],
        components: [buildButtons(page, rebuilt.pages)]
      });
    });

    collector.on('end', async () => {
      try {
        await reply.edit({ components: [buildButtons(page, pages, true)] });
      } catch {
        // Το μήνυμα διαγράφηκε ή το token έληξε — δεν υπάρχει τίποτα να κάνουμε.
      }
    });
  })
};
