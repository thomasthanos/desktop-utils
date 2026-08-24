const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { isCommandAuthorized, isGuildAdmin, replyUnauthorized } = require('../utils/authorization');
const { serializeMessage } = require('../utils/transcript');
const { emoji } = require('../utils/emojis');

const log = require('../utils/logger')('wipe-channel');
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}



const MAX_BATCHES = 100;

async function wipeChannelStreaming(channel, guildId, onProgress, state) {
  const transcript = [];
  let deletedCount = 0;
  let failedCount = 0;
  let before = null;

  for (let batchIndex = 0; batchIndex < MAX_BATCHES; batchIndex += 1) {
    if (state && state.stopped) break;
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });
    if (!batch.size) break;

    const newBefore = batch.last().id;
    const targets = Array.from(batch.values())
      .filter((msg) => !msg.pinned && !msg.system && !(state?.protectedIds?.has?.(msg.id)));

    for (const message of targets) {
      if (state && state.stopped) break;

      const entry = await serializeMessage(message, guildId);
      try {
        await message.delete();
        deletedCount += 1;
        transcript.push(entry);
      } catch {
        failedCount += 1;
      }
      await sleep(700);
    }

    if (onProgress) await onProgress(deletedCount, failedCount);

    if (newBefore === before) break;
    before = newBefore;
    if (batch.size < 100) break;
    if (state && state.stopped) break;
  }

  transcript.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

  return { transcript, deletedCount, failedCount };
}

module.exports = {
  category: 'Moderation',
  aliases: ['wc', 'wipe', 'ςψ'],
  data: new SlashCommandBuilder()
    .setName('wipe-channel')
    .setDescription('Καθαρίζει σιγά σιγά όλα τα μηνύματα στο κανάλι. (μπορείς να το σταματήσεις).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, client, database) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: `${emoji('bot_warn')} Μάστορα, αυτό δουλεύει μόνο μέσα σε server.`, flags: MessageFlags.Ephemeral });
      return;
    }

    // Administrator, ή όποιος έχει ρητά εξουσιοδοτηθεί από τον ιδιοκτήτη.
    if (!isGuildAdmin(interaction) && !isCommandAuthorized(interaction, database, 'wipe-channel')) {
      await replyUnauthorized(interaction, '`/wipe-channel`');
      return;
    }

    const channel = interaction.channel;
    const botPerms = channel.permissionsFor(client.user?.id || client.user);
    if (!botPerms?.has(PermissionFlagsBits.ManageMessages) || !botPerms.has(PermissionFlagsBits.ReadMessageHistory)) {
      await interaction.reply({
        content: `${emoji('bot_error')} Μου λείπουν τα δικαιώματα \`Manage Messages\` και \`Read Message History\` για να καθαρίσω τα σκουπίδια σου.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const confirmId = `wipe_confirm_${interaction.id}`;
    const cancelId = `wipe_cancel_${interaction.id}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: `${emoji('bot_warn')} Σίγουρα ολικό άδειασμα στο <#${channel.id}>; Δεν γυρίζει πίσω.`,
      components: [row],
      flags: MessageFlags.Ephemeral
    });

    const reply = await interaction.fetchReply();
    let componentInteraction;
    try {
      componentInteraction = await reply.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
        time: 30000
      });
    } catch {
      await interaction.editReply({ content: `${emoji('bot_warn')} Πέρασε η ώρα. Δεν έκανα τίποτα.`, components: [] });
      return;
    }

    if (componentInteraction.customId === cancelId) {
      await componentInteraction.update({ content: `${emoji('bot_ok')} Ακυρώθηκε. Δεν πείραξα τίποτα.`, components: [] });
      return;
    }

    const stopId = `wipe_stop_${interaction.id}`;
    const stopRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(stopId).setLabel('Stop').setStyle(ButtonStyle.Danger)
    );

    await componentInteraction.update({ 
      content: `${emoji('bot_clear')} Άδειασμα ξεκίνησε... σβήνω σιγά σιγά.`, 
      components: [stopRow] 
    });

    const state = { stopped: false, protectedIds: new Set() };

    const controlMessage = await interaction.fetchReply().catch(() => null);
    if (controlMessage?.id) state.protectedIds.add(controlMessage.id);

    const stopCollector = interaction.channel.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id && i.customId === stopId,
      time: 6 * 60 * 60 * 1000
    });

    stopCollector.on('collect', async (i) => {
      state.stopped = true;
      await i.update({ content: `${emoji('bot_warn')} Το άδειασμα σταμάτησε από τον χρήστη.`, components: [] });
      stopCollector.stop();
    });

    let lastProgressAt = 0;
    const onProgress = async (deleted, failed) => {
      if (state.stopped) return;
      const now = Date.now();
      if (now - lastProgressAt < 5000) return;
      lastProgressAt = now;
      try {
        await interaction.editReply({
          content: `${emoji('bot_clear')} Αδειάζω... Σβήστηκαν: **${deleted}** | Απέτυχαν: **${failed}**`,
          components: [stopRow]
        });
      } catch (error) {
        log.warn('Progress update failed:', error.message);
      }
    };

    const { transcript, deletedCount, failedCount } = await wipeChannelStreaming(
      channel,
      interaction.guildId,
      onProgress,
      state
    );
    stopCollector.stop();

    if (transcript.length > 0) {
      database.logClear(interaction.user, channel, interaction.guild, transcript);
      client.emit('dashboard:clearLogs');
    }

    try {
      await interaction.editReply({
        content: `${emoji('bot_ok')} Τελείωσα. Σβήστηκαν: **${deletedCount}** | Απέτυχαν: **${failedCount}**.`,
        components: []
      });
    } catch {
      await channel.send(`${emoji('bot_ok')} Τελείωσα. Σβήστηκαν: **${deletedCount}** | Απέτυχαν: **${failedCount}**.`).catch(() => {});
    }

    client.emit('dashboard:sync');
  }
};
