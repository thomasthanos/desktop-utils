const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { isCommandAuthorized, replyUnauthorized } = require('../utils/authorization');
const { buildSessionDir, saveAttachmentToDisk } = require('../utils/attachments');

const log = require('../utils/logger')('wipe-channel');
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatAuthorTag(user) {
  if (!user) return 'Unknown#0000';
  if (user.tag) return user.tag;
  if (user.discriminator && user.discriminator !== '0') return `${user.username}#${user.discriminator}`;
  return user.username || 'Unknown';
}

async function serializeMessage(message, guildId) {
  // Each author gets their own stable folder: attachments/<guildId>/<authorId>/
  const sessionDir = buildSessionDir(guildId, null, message.author?.id || 'unknown');
  const attachments = [];
  for (const attachment of Array.from(message.attachments.values())) {
    const stored = await saveAttachmentToDisk(attachment, sessionDir, message.id);
    attachments.push({
      name: attachment.name || 'file',
      url: attachment.url || '',
      proxyUrl: attachment.proxyURL || '',
      contentType: attachment.contentType || null,
      size: attachment.size || 0,
      filePath: stored.filePath,
      storedOnDisk: stored.storedOnDisk,
      storeError: stored.storeError
    });
  }

  return {
    id: message.id,
    author: formatAuthorTag(message.author),
    authorId: message.author?.id || null,
    authorAvatarUrl: message.author?.displayAvatarURL?.({ forceStatic: false, size: 128 }) || null,
    content: message.content || '',
    createdAt: message.createdAt?.toISOString?.() || null,
    attachments,
    embeds: message.embeds.map((embed) => ({
      title: embed.title || null,
      description: embed.description || null,
      url: embed.url || null,
      author: embed.author?.name || null,
      thumbnail: embed.thumbnail?.url || null,
      image: embed.image?.url || null,
      fields: (embed.fields || []).map((field) => ({
        name: field.name,
        value: field.value,
        inline: Boolean(field.inline)
      }))
    }))
  };
}

// 100 παρτίδες x 100 = 10.000 μηνύματα, ίδιο όριο με το /clear. Ήταν 500.
const MAX_BATCHES = 100;

/**
 * Σβήνει το κανάλι σε ροή: μία παρτίδα των 100 τη φορά — φέρε, σειριοποίησε,
 * σβήσε — και μετά η επόμενη.
 *
 * Η προηγούμενη υλοποίηση μάζευε ΟΛΑ τα μηνύματα (έως 50.000 αντικείμενα
 * Message) στη μνήμη, έχτιζε παράλληλα ολόκληρο το transcript κατεβάζοντας
 * κάθε συνημμένο, και μόνο τότε άρχιζε να σβήνει. Σε μηχάνημα με 2GB αυτό
 * είναι OOM. Έτσι η αιχμή πέφτει σε ~100 μηνύματα ανεξαρτήτως μεγέθους
 * καναλιού.
 *
 * Το `before` δέχεται snowflake ήδη διαγραμμένου μηνύματος (το ID κωδικοποιεί
 * χρόνο), οπότε η σελιδοποίηση παραμένει σωστή ενώ σβήνουμε.
 */
async function wipeChannelStreaming(channel, guildId, onProgress) {
  const transcript = [];
  let deletedCount = 0;
  let failedCount = 0;
  let before = null;

  for (let batchIndex = 0; batchIndex < MAX_BATCHES; batchIndex += 1) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });
    if (!batch.size) break;

    const newBefore = batch.last().id;
    const targets = Array.from(batch.values()).filter((msg) => !msg.pinned && !msg.system);

    for (const message of targets) {
      // Σειριοποίηση ΠΡΙΝ τη διαγραφή — μετά τα δεδομένα δεν υπάρχουν πια.
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
  }

  // Οι παρτίδες έρχονται από τα νεότερα προς τα παλαιότερα, οπότε το
  // transcript ταξινομείται στο τέλος. Τα snowflakes είναι χρονολογικά.
  transcript.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

  return { transcript, deletedCount, failedCount };
}

module.exports = {
  category: 'Moderation',
  aliases: ['wc', 'wipe', 'ςψ'],
  data: new SlashCommandBuilder()
    .setName('wipe-channel')
    .setDescription('Slowly delete all messages in the current channel (authorized users only).'),

  async execute(interaction, client, database) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'This command works only inside servers.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!isCommandAuthorized(interaction, database, 'wipe-channel')) {
      await replyUnauthorized(interaction, '`/wipe-channel`');
      return;
    }

    const channel = interaction.channel;
    const botPerms = channel.permissionsFor(client.user?.id || client.user);
    if (!botPerms?.has(PermissionFlagsBits.ManageMessages) || !botPerms.has(PermissionFlagsBits.ReadMessageHistory)) {
      await interaction.reply({
        content: 'I need `Manage Messages` and `Read Message History` permissions in this channel.',
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
      content: `Confirm full wipe for channel <#${channel.id}>.`,
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
      await interaction.editReply({ content: 'Wipe request timed out.', components: [] });
      return;
    }

    if (componentInteraction.customId === cancelId) {
      await componentInteraction.update({ content: 'Wipe cancelled.', components: [] });
      return;
    }

    await componentInteraction.update({ content: 'Wipe started... deleting slowly.', components: [] });

    // Ένα wipe με 700ms ανά μήνυμα κρατάει λεπτά έως ώρες. Χωρίς ενδιάμεση
    // ενημέρωση το μήνυμα έμοιαζε παγωμένο και δεν ήξερες αν προχωράει.
    let lastProgressAt = 0;
    const onProgress = async (deleted, failed) => {
      const now = Date.now();
      if (now - lastProgressAt < 5000) return;
      lastProgressAt = now;
      try {
        await interaction.editReply({
          content: `Wiping... Deleted: **${deleted}** | Failed: **${failed}**`
        });
      } catch (error) {
        // Το interaction token λήγει μετά από 15 λεπτά — δεν σταματάμε το wipe.
        log.warn('Progress update failed:', error.message);
      }
    };

    const { transcript, deletedCount, failedCount } = await wipeChannelStreaming(
      channel,
      interaction.guildId,
      onProgress
    );

    if (transcript.length > 0) {
      database.logClear(interaction.user, channel, interaction.guild, transcript);
      client.emit('dashboard:clearLogs');
    }

    try {
      await interaction.editReply({
        content: `Wipe complete. Deleted: **${deletedCount}** | Failed: **${failedCount}**.`
      });
    } catch {
      // Ληγμένο token μετά από πολύωρο wipe — η δουλειά έγινε ούτως ή άλλως.
      await channel.send(`Wipe complete. Deleted: **${deletedCount}** | Failed: **${failedCount}**.`).catch(() => {});
    }

    client.emit('dashboard:sync');
  }
};
