const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { formatAuthorTag, serializeMessage } = require('../utils/transcript');
const { isGuildAdmin } = require('../utils/authorization');
const { emoji } = require('../utils/emojis');
const { clearQuip, summarize } = require('../ai/quip');

function messages(n) {
  return n === 1 ? '**1** μήνυμα' : `**${n}** μηνύματα`;
}

function skippedNote(n) {
  if (!n) return '';
  return n === 1
    ? ' (**1** καρφιτσωμένο ή συστήματος παραλείφθηκε)'
    : ` (**${n}** καρφιτσωμένα ή συστήματος παραλείφθηκαν)`;
}

function daysAgoLabel(n) {
  if (!Number.isFinite(n) || n <= 0) return 'από σήμερα';
  return n === 1 ? '1 μέρα πίσω' : `${n} μέρες πίσω`;
}

async function quipLine(transcriptMessages, database) {
  try {
    const facts = summarize(transcriptMessages);
    if (!facts) return '';
    const line = await clearQuip(facts, database);
    return line ? `\n> *${line}*` : '';
  } catch {
    return '';
  }
}

const log = require('../utils/logger')('clear');


function buildDate(year, month, day) {
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function daysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  date.setHours(23, 59, 59, 999);
  return date;
}

function parseDate(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return { date: null, error: 'Δώσε μια ημερομηνία.' };

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

  let year;
  let month;
  let day;

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const eu = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);

  if (iso) {
    [, year, month, day] = iso.map(Number);
  } else if (eu) {
    [, day, month, year] = eu.map(Number);

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

async function deepDelete(channel, cutoffDate, onProgress) {
  const cutoffStart = new Date(cutoffDate);
  cutoffStart.setHours(0, 0, 0, 0);
  const cutoffTs = cutoffStart.getTime();

  const deleted = [];
  let skipped = 0;
  let totalFetched = 0;
  let beforeSnowflake = null;

  const MAX_MESSAGES = 10000;

  while (totalFetched < MAX_MESSAGES) {
    const fetchOptions = { limit: 100 };
    if (beforeSnowflake) fetchOptions.before = beforeSnowflake;

    const batch = await channel.messages.fetch(fetchOptions);
    if (batch.size === 0) break;

    const messages = Array.from(batch.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    totalFetched += messages.length;

    let reachedCutoff = false;

    for (const msg of messages) {
      if (msg.createdTimestamp < cutoffTs) {
        reachedCutoff = true;
        break;
      }

      if (msg.pinned || msg.system) {
        skipped++;
        continue;
      }

      try {
        deleted.push(msg);

        await msg.delete();

        if (deleted.length % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1100));
        }
      } catch (err) {
        log.error(`[deep-clear] Failed to delete message ${msg.id}:`, err.message);

        deleted.pop();
        skipped++;
      }
    }

    if (reachedCutoff) break;

    beforeSnowflake = messages[messages.length - 1].id;

    if (onProgress) onProgress(deleted.length, messages.length);
  }

  return { deleted, skipped };
}

module.exports = {
  category: 'Moderation',
  aliases: ['c', 'ψ'],
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Σκούπα και φαράσι! Σβήνει μηνύματα και κρατάει αποδεικτικά.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Πόσα πρόσφατα μηνύματα να σβήσει (1-100)')
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addStringOption((option) =>
      option
        .setName('before_date')
        .setDescription('Πόσο πίσω (π.χ. 7d, yesterday). Ξεπερνά το όριο 14 ημερών!')
    ),

  async execute(interaction, client, database) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: `${emoji('bot_warn')} Αυτό δουλεύει μόνο μέσα σε server.`, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased() || channel.type === ChannelType.DM) {
      await interaction.editReply(`${emoji('bot_error')} Σε αυτό το κανάλι δεν γίνεται διαγραφή.`);
      return;
    }

    const botPerms = channel.permissionsFor(client.user?.id || client.user);
    if (!botPerms?.has(PermissionFlagsBits.ManageMessages) || !botPerms.has(PermissionFlagsBits.ReadMessageHistory)) {
      await interaction.editReply('Χρειάζομαι τα δικαιώματα `Manage Messages` και `Read Message History` σε αυτό το κανάλι.');
      return;
    }

    const beforeDateStr = interaction.options.getString('before_date');
    const amount = interaction.options.getInteger('amount');

    // Το amount σταματά στα 100 και στις 14 μέρες· το before_date δεν έχει
    // τέτοιο φρένο, οπότε θέλει Administrator και όχι σκέτο Manage Messages.
    if (beforeDateStr && !isGuildAdmin(interaction)) {
      await interaction.editReply(
        `${emoji('bot_error')} Το \`before_date\` σβήνει χωρίς όριο, οπότε το κάνει μόνο Administrator.\n`
        + '-# Με `amount` μπορείς κανονικά, μέχρι 100 μηνύματα.'
      );
      return;
    }

    if (beforeDateStr) {
      const { date: cutoffDate, error: dateError } = parseDate(beforeDateStr);
      if (!cutoffDate) {
        await interaction.editReply(
          `${emoji('bot_error')} ${dateError}\n\n`
          + '**Παραδείγματα που δουλεύουν:**\n'
          + '`7d` — 7 μέρες πίσω  ·  `2 εβδομάδες`  ·  `3 μήνες`\n'
          + '`χθες`  ·  `σήμερα`\n'
          + '`15/06/2024`  ·  `15.06.24`  ·  `2024-06-15`'
        );
        return;
      }

      const readable = cutoffDate.toLocaleDateString('el-GR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      const daysBack = Math.round((Date.now() - cutoffDate.getTime()) / 86400000);

      await interaction.editReply(
        `${emoji('bot_clear')} Καθαρίζω τα πάντα από σήμερα μέχρι και **${readable}** `
        + `(${daysAgoLabel(daysBack)}). Μπορεί να πάρει ώρα...`
      );

      let lastProgressUpdate = Date.now();
      const onProgress = async (deletedCount, _batchSize) => {
        if (Date.now() - lastProgressUpdate > 10000) {
          lastProgressUpdate = Date.now();
          try {
            await interaction.editReply(
              `${emoji('bot_clear')} Σκουπίζω... ${messages(deletedCount)} μέχρι στιγμής.`
            );
          } catch {}
        }
      };

      const { deleted: deletedMsgs, skipped } = await deepDelete(channel, cutoffDate, onProgress);

      if (deletedMsgs.length === 0) {
        await interaction.editReply(
          `Δεν βρέθηκαν μηνύματα από σήμερα μέχρι **${readable}**.${skippedNote(skipped)}`
        );
        return;
      }

      const sortedDeleted = [...deletedMsgs].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      const transcriptMessages = [];
      for (const msg of sortedDeleted) {
        try {
          transcriptMessages.push(await serializeMessage(msg, interaction.guildId));
        } catch {
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

      const skippedLine = skippedNote(skipped);
      const quip = await quipLine(transcriptMessages, database);
      await interaction.editReply(
        `${emoji('bot_ok')} Καθάρισα ${messages(deletedMsgs.length)}, από σήμερα μέχρι **${readable}**.${skippedLine} Το transcript είναι στο dashboard.${quip}`
      ).catch(() => {
        channel.send(
          `${emoji('bot_ok')} Τελείωσα: ${messages(deletedMsgs.length)}.${skippedLine} Το transcript είναι στο dashboard.${quip}`
        ).catch(() => {});
      });

      return;
    }

    if (!amount) {
      await interaction.editReply(`${emoji('bot_warn')} Δώσε είτε \`amount\` (πόσα μηνύματα) είτε \`before_date\` (πόσο πίσω).`);
      return;
    }

    const fetched = await channel.messages.fetch({ limit: Math.min(100, amount + 5) });
    const targetMessages = Array.from(fetched.values())
      .filter((message) => !message.pinned && !message.system)
      .slice(0, amount);

    if (!targetMessages.length) {
      await interaction.editReply(`${emoji('bot_warn')} Δεν βρήκα τίποτα να σβήσω. Καθαρά είναι εδώ.`);
      return;
    }

    const sortedTarget = [...targetMessages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const preparedTranscript = [];
    for (const msg of sortedTarget) {
      preparedTranscript.push(await serializeMessage(msg, interaction.guildId));
    }

    const deleted = await channel.bulkDelete(targetMessages, true);
    if (!deleted.size) {
      await interaction.editReply(`${emoji('bot_warn')} Κανένα δεν έφυγε — μάλλον είναι παλαιότερα από 14 ημέρες. Δοκίμασε το \`before_date\`.`);
      return;
    }

    const deletedIds = new Set(Array.from(deleted.keys()));
    const transcriptMessages = preparedTranscript.filter((entry) => deletedIds.has(entry.id));

    database.logClear(interaction.user, channel, interaction.guild, transcriptMessages);
    client.emit('dashboard:sync');
    client.emit('dashboard:clearLogs');

    const quip = await quipLine(transcriptMessages, database);
    await interaction.editReply(
      `${emoji('bot_ok')} Εξαφάνισα ${messages(deleted.size)}. Το transcript είναι στο dashboard.${quip}`
    );
  }
};
