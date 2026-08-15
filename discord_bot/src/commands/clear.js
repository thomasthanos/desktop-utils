const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { buildSessionDir, saveAttachmentToDisk } = require('../utils/attachments');

const log = require('../utils/logger')('clear');
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

/** Ημέρα σε τέλος-ημέρας, με ΕΛΕΓΧΟ ότι υπάρχει πραγματικά. */
function buildDate(year, month, day) {
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  // Η JavaScript δεν απορρίπτει ανύπαρκτες ημερομηνίες — τις μεταφέρει:
  // new Date(2024, 1, 31) γίνεται σιωπηλά 2 Μαρτίου. Σε εντολή που διαγράφει
  // μηνύματα αυτό σημαίνει διαγραφή από λάθος σημείο, οπότε επιβεβαιώνουμε
  // ότι η ημερομηνία που βγήκε είναι αυτή που ζητήθηκε.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * Διαβάζει ημερομηνία από κείμενο, με ανοχή στο πώς τη γράφει ο καθένας.
 *
 * Δέχεται σχετικές εκφράσεις (`7d`, `χθες`, `2 εβδομάδες`), ISO (`2024-06-15`)
 * και ευρωπαϊκή μορφή (`15/06/2024`, `15.06.24`).
 *
 * @returns {{date: Date|null, error: string|null}} — το μήνυμα λέει τι φταίει
 *   συγκεκριμένα, αντί για ένα γενικό «λάθος μορφή».
 */
function parseDate(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return { date: null, error: 'Δώσε μια ημερομηνία.' };

  // --- σχετικές εκφράσεις ---------------------------------------------------
  if (/^(σήμερα|today)$/.test(raw)) return { date: daysAgo(0), error: null };
  if (/^(χθες|χτες|yesterday)$/.test(raw)) return { date: daysAgo(1), error: null };

  const relative = raw.match(
    /^(\d{1,6})\s*(d|day|days|μερ|μέρα|μέρες|μερες|w|week|weeks|εβδ|εβδομάδα|εβδομάδες|εβδομαδες|m|month|months|μήνα|μήνες|μηνες|y|year|years|χρόνο|χρόνια|χρονια)$/
  );
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2];
    const perUnit = /^(w|week|weeks|εβδ|εβδομ)/.test(unit) ? 7
      : /^(m|month|months|μήν|μην)/.test(unit) ? 30
        : /^(y|year|years|χρόν|χρον)/.test(unit) ? 365
          : 1;
    const days = n * perUnit;
    if (days > 3650) return { date: null, error: 'Αυτό είναι πάνω από 10 χρόνια πίσω — δώσε κάτι πιο κοντινό.' };
    return { date: daysAgo(days), error: null };
  }

  // --- απόλυτες ημερομηνίες -------------------------------------------------
  let year;
  let month;
  let day;

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const eu = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);

  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (eu) {
    [, day, month, year] = eu.map(Number);
    // Διψήφιο έτος: το 24 σημαίνει 2024, όχι 1924.
    if (year < 100) year += 2000;
  } else {
    return {
      date: null,
      error: 'Δεν κατάλαβα την ημερομηνία. Δοκίμασε `7d` (7 μέρες πίσω), `χθες`, '
        + '`15/06/2024` ή `2024-06-15`.'
    };
  }

  if (month < 1 || month > 12) return { date: null, error: `Ο μήνας **${month}** δεν υπάρχει — πρέπει να είναι 1 έως 12.` };
  if (day < 1 || day > 31) return { date: null, error: `Η ημέρα **${day}** δεν υπάρχει — πρέπει να είναι 1 έως 31.` };

  const date = buildDate(year, month, day);
  if (!date) return { date: null, error: `Η **${day}/${month}/${year}** δεν είναι υπαρκτή ημερομηνία.` };

  if (date.getTime() > Date.now()) {
    return { date: null, error: 'Αυτή η ημερομηνία είναι στο μέλλον — δώσε παρελθοντική.' };
  }
  return { date, error: null };
}

/**
 * Deep-delete: fetch messages from newest to oldest, deleting one-by-one,
 * until we reach the cutoff date. This bypasses Discord's 14-day bulkDelete limit.
 *
 * @param {TextChannel} channel
 * @param {Date} cutoffDate  – stop deleting when messages are older than this date
 * @param {Function} onProgress – called with (deletedSoFar, currentBatch)
 * @returns {{ deleted: Message[], skipped: number }}
 */
async function deepDelete(channel, cutoffDate, onProgress) {
  // cutoffDate is end-of-day, so set the boundary to the START of that day (00:00:00)
  const cutoffStart = new Date(cutoffDate);
  cutoffStart.setHours(0, 0, 0, 0);
  const cutoffTs = cutoffStart.getTime();

  const deleted = [];
  let skipped = 0;
  let totalFetched = 0;
  let beforeSnowflake = null; // null = start from the newest message

  // Safety limit: don't process more than 10 000 messages in one run
  const MAX_MESSAGES = 10000;

  while (totalFetched < MAX_MESSAGES) {
    // Fetch 100 messages, going backwards from the cursor (or from newest)
    const fetchOptions = { limit: 100 };
    if (beforeSnowflake) fetchOptions.before = beforeSnowflake;

    const batch = await channel.messages.fetch(fetchOptions);
    if (batch.size === 0) break;

    const messages = Array.from(batch.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    totalFetched += messages.length;

    let reachedCutoff = false;

    for (const msg of messages) {
      // If this message is older than the cutoff date, we're done
      if (msg.createdTimestamp < cutoffTs) {
        reachedCutoff = true;
        break;
      }

      // Skip pinned / system messages
      if (msg.pinned || msg.system) {
        skipped++;
        continue;
      }

      try {
        // Store before deleting
        deleted.push(msg);

        // Delete one-by-one (bypasses 14-day limit)
        await msg.delete();

        // Rate-limit protection: slight delay between deletes
        // Discord rate limit is roughly 5 deletes/5s per channel
        if (deleted.length % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1100));
        }
      } catch (err) {
        // Message might already be gone or permissions changed
        log.error(`[deep-clear] Failed to delete message ${msg.id}:`, err.message);
        // Remove from deleted since it wasn't actually deleted
        deleted.pop();
        skipped++;
      }
    }

    // If we've reached messages older than the cutoff, stop
    if (reachedCutoff) break;

    // Move cursor further back
    beforeSnowflake = messages[messages.length - 1].id;

    // Progress callback
    if (onProgress) onProgress(deleted.length, messages.length);
  }

  return { deleted, skipped };
}

module.exports = {
  category: 'Moderation',
  aliases: ['c', 'ψ'],
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete messages. Supports deep-delete beyond the 14-day limit.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('How many recent messages to delete (1-100). Ignored if before_date is set.')
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addStringOption((option) =>
      option
        .setName('before_date')
        .setDescription('Πόσο πίσω: 7d, χθες, 2 εβδομάδες, 15/06/2024 ή 2024-06-15. Παρακάμπτει το όριο 14 ημερών.')
    ),

  async execute(interaction, client, database) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Αυτή η εντολή δουλεύει μόνο μέσα σε servers.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
      await interaction.editReply('Σε αυτό το κανάλι δεν γίνεται διαγραφή μηνυμάτων.');
      return;
    }

    const botPerms = channel.permissionsFor(client.user?.id || client.user);
    if (!botPerms?.has(PermissionFlagsBits.ManageMessages) || !botPerms.has(PermissionFlagsBits.ReadMessageHistory)) {
      await interaction.editReply('Χρειάζομαι τα δικαιώματα `Manage Messages` και `Read Message History` σε αυτό το κανάλι.');
      return;
    }

    const beforeDateStr = interaction.options.getString('before_date');
    const amount = interaction.options.getInteger('amount');

    // ── Deep-delete mode (before_date) ──────────────────────────────────
    if (beforeDateStr) {
      const { date: cutoffDate, error: dateError } = parseDate(beforeDateStr);
      if (!cutoffDate) {
        await interaction.editReply(
          `❌ ${dateError}\n\n`
          + '**Παραδείγματα που δουλεύουν:**\n'
          + '`7d` — 7 μέρες πίσω  ·  `2 εβδομάδες`  ·  `3 μήνες`\n'
          + '`χθες`  ·  `σήμερα`\n'
          + '`15/06/2024`  ·  `15.06.24`  ·  `2024-06-15`'
        );
        return;
      }

      // Ημερομηνία σε αναγνώσιμη μορφή — το ISO δεν λέει τίποτα με μια ματιά,
      // και εδώ επιβεβαιώνεις κάτι μη αναστρέψιμο.
      const readable = cutoffDate.toLocaleDateString('el-GR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      const daysBack = Math.round((Date.now() - cutoffDate.getTime()) / 86400000);

      await interaction.editReply(
        `🔄 Διαγράφω όλα τα μηνύματα από σήμερα μέχρι και **${readable}** `
        + `(${daysBack} ημέρες πίσω). Μπορεί να πάρει ώρα...`
      );

      let lastProgressUpdate = Date.now();
      const onProgress = async (deletedCount, _batchSize) => {
        // Update every 10 seconds to avoid rate limits on editReply
        if (Date.now() - lastProgressUpdate > 10000) {
          lastProgressUpdate = Date.now();
          try {
            await interaction.editReply(
              `🔄 Διαγραφή σε εξέλιξη... **${deletedCount}** μηνύματα μέχρι στιγμής.`
            );
          } catch { /* interaction may have expired */ }
        }
      };

      const { deleted: deletedMsgs, skipped } = await deepDelete(channel, cutoffDate, onProgress);

      if (deletedMsgs.length === 0) {
        await interaction.editReply(
          `Δεν βρέθηκαν μηνύματα από σήμερα μέχρι **${readable}**.${skipped ? ` (${skipped} παραλείφθηκαν: καρφιτσωμένα/συστήματος)` : ''}`
        );
        return;
      }

      // Serialize for transcript (messages are already deleted, so attachments may not download)
      const sortedDeleted = [...deletedMsgs].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      const transcriptMessages = [];
      for (const msg of sortedDeleted) {
        try {
          transcriptMessages.push(await serializeMessage(msg, interaction.guildId));
        } catch {
          // Best-effort serialization — message data might be partial after delete
          transcriptMessages.push({
            id: msg.id,
            author: formatAuthorTag(msg.author),
            authorId: msg.author?.id || null,
            authorAvatarUrl: null,
            content: msg.content || '',
            createdAt: msg.createdAt?.toISOString?.() || null,
            attachments: [],
            embeds: []
          });
        }
      }

      database.logClear(interaction.user, channel, interaction.guild, transcriptMessages);
      client.emit('dashboard:sync');
      client.emit('dashboard:clearLogs');

      const skippedNote = skipped ? ` (${skipped} pinned/system skipped)` : '';
      await interaction.editReply(
        `✅ Διαγράφηκαν **${deletedMsgs.length}** μηνύματα, από σήμερα μέχρι **${readable}**.${skippedNote} Το transcript αποθηκεύτηκε στο dashboard.`
      ).catch(() => {
        // Interaction may have expired for very long operations
        channel.send(
          `✅ Η διαγραφή ολοκληρώθηκε: **${deletedMsgs.length}** μηνύματα.${skippedNote} Transcript saved to dashboard.`
        ).catch(() => {});
      });

      return;
    }

    // ── Normal mode (amount) ────────────────────────────────────────────
    if (!amount) {
      await interaction.editReply('Δώσε είτε `amount` (πόσα μηνύματα) είτε `before_date` (πόσο πίσω).');
      return;
    }

    const fetched = await channel.messages.fetch({ limit: Math.min(100, amount + 5) });
    const targetMessages = Array.from(fetched.values())
      .filter((message) => !message.pinned && !message.system)
      .slice(0, amount);

    if (!targetMessages.length) {
      await interaction.editReply('Δεν βρέθηκαν μηνύματα προς διαγραφή.');
      return;
    }

    // Serialize before deleting so Discord URLs are still valid
    // Each message author gets their own stable folder: attachments/<guildId>/<authorId>/
    const sortedTarget = [...targetMessages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const preparedTranscript = [];
    for (const msg of sortedTarget) {
      preparedTranscript.push(await serializeMessage(msg, interaction.guildId));
    }

    const deleted = await channel.bulkDelete(targetMessages, true);
    if (!deleted.size) {
      await interaction.editReply('Δεν διαγράφηκε κανένα μήνυμα — μάλλον είναι παλαιότερα από 14 ημέρες. Δοκίμασε το `before_date`.');
      return;
    }

    const deletedIds = new Set(Array.from(deleted.keys()));
    const transcriptMessages = preparedTranscript.filter((entry) => deletedIds.has(entry.id));

    database.logClear(interaction.user, channel, interaction.guild, transcriptMessages);
    client.emit('dashboard:sync');
    client.emit('dashboard:clearLogs');

    await interaction.editReply(`Διαγράφηκαν **${deleted.size}** μηνύματα. Το transcript αποθηκεύτηκε στο dashboard.`);
  }
};
