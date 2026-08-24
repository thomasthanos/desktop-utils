const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const { defineCommand } = require('../utils/command-context');
const { emoji, plainEmoji } = require('../utils/emojis');
const { getPlaybackState, getUpcoming, formatDuration, trackDurationMs } = require('../utils/music');

const PAGE_SIZE = 10;
const COLLECTOR_MS = 120000;

function buildEmbed(state, upcoming, page, guildName) {
  const pages = Math.max(1, Math.ceil(upcoming.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const slice = upcoming.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle(`${plainEmoji('bot_music')} Ουρά — ${guildName}`);

  const current = state.idleActive
    ? `${emoji('bot_radio')} **Ραδιόφωνο** (ζωντανή μετάδοση)`
    : state.queue?.currentTrack
      ? `**${state.queue.currentTrack.title}** — ${state.queue.currentTrack.author || 'Άγνωστος'}`
      : '*Δεν παίζει τίποτα*';

  embed.addFields({
    name: state.isPaused ? 'Αναπαράγεται (σε παύση)' : 'Αναπαράγεται τώρα',
    value: current,
    inline: false
  });

  if (upcoming.length === 0) {
    embed.addFields({ name: 'Επόμενο', value: '*Η ουρά είναι άδεια*', inline: false });
  } else {
    const lines = slice.map((track, index) => {
      const position = safePage * PAGE_SIZE + index + 1;
      const duration = track.duration ? ` \`${track.duration}\`` : '';
      return `\`${String(position).padStart(2, ' ')}.\` ${track.title}${duration}`;
    });
    embed.addFields({ name: `Επόμενα — ${upcoming.length} κομμάτι(α)`, value: lines.join('\n'), inline: false });

    const totalMs = upcoming.reduce((sum, t) => sum + trackDurationMs(t), 0);
    if (totalMs > 0) embed.setDescription(`Συνολικός χρόνος: **${formatDuration(totalMs)}**`);
  }

  embed.setFooter({ text: `Σελίδα ${safePage + 1} / ${pages}` });
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
    .setDescription('Τι παίζει μετά; Δες την ουρά αναμονής.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Αυτό δουλεύει μόνο μέσα σε server.');
    }

    const state = getPlaybackState(client, ctx.guildId);
    if (!state.hasAnything) {
      return ctx.replyPrivate('Δεν παίζει τίποτα αυτή τη στιγμή.');
    }

    const upcoming = getUpcoming(client, ctx.guildId);
    let page = 0;
    const { embed, pages } = buildEmbed(state, upcoming, page, ctx.guild.name);

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
        await buttonInteraction.reply({ content: `${emoji('bot_warn')} Μόνο όποιος έγραψε την εντολή γυρίζει σελίδα.`, ephemeral: true });
        return;
      }
      page += buttonInteraction.customId === 'queue_next' ? 1 : -1;

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
      }
    });
  })
};
