const { Collection, REST, Routes } = require('discord.js');
const crypto = require('crypto');
const startDashboard = require('../dashboard/server');
const { startIdleLive } = require('../idle-live');
const { startAttachmentGc } = require('../utils/attachment-gc');
const { notifyOwner, startDailyDigest } = require('../utils/notify');
const log = require('../utils/logger')('startup');

/**
 * Ξαναρχίζει το 24/7 ραδιόφωνο στα guilds όπου έπαιζε πριν σταματήσει το bot.
 *
 * Χωρίς αυτό, κάθε reboot ή ενημέρωση άφηνε το ραδιόφωνο σβηστό μέχρι να μπει
 * κάποιος και να ξαναγράψει /idlemusic — που αναιρεί το νόημα του «24/7».
 */
async function restoreIdleSessions(client, database) {
  let rows;
  try {
    rows = database.getIdleStatesToRestore();
  } catch (error) {
    log.error('Could not read persisted idle state:', error.message);
    return;
  }
  if (rows.length === 0) return;

  for (const row of rows) {
    const guildId = row.guild_id;
    const forget = () => {
      try {
        database.setIdleState(guildId, { voiceChannelId: null, textChannelId: null, active: false });
      } catch { /* η επόμενη εκκίνηση θα ξαναπροσπαθήσει */ }
    };

    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) { forget(); continue; } // το bot έφυγε από τον server

      const voiceChannel = guild.channels.cache.get(row.active_voice_channel);
      if (!voiceChannel) {
        log.warn(`Voice channel ${row.active_voice_channel} is gone in ${guild.name} — forgetting.`);
        forget();
        continue;
      }

      const textChannel = row.active_text_channel
        ? guild.channels.cache.get(row.active_text_channel) || null
        : null;

      await startIdleLive(client, guild, voiceChannel, textChannel, client.user);
      log.info(`Idle radio resumed in ${guild.name} / #${voiceChannel.name}`);
    } catch (error) {
      // Μια αποτυχία σε ένα guild δεν πρέπει να εμποδίσει τα υπόλοιπα, ούτε να
      // ρίξει την εκκίνηση. Η κατάσταση μένει ώστε να ξαναδοκιμάσει αργότερα.
      log.error(`Could not resume idle radio in guild ${guildId}:`, error.message);
    }
  }
}

/**
 * Καταχώρηση slash commands, μόνο όταν έχουν όντως αλλάξει.
 *
 * Η παλιά υλοποίηση τα ξανακαταχωρούσε σε ΚΑΘΕ εκκίνηση — μια παράλληλη ριπή
 * αιτημάτων REST προς το Discord χωρίς κανένα όφελος.
 */
async function registerSlashCommands(client, database, slashCommands, dmCommands, token) {
  if (!process.env.CLIENT_ID) {
    log.warn('CLIENT_ID is missing. Slash command registration was skipped.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    const explicitGuildId = process.env.GUILD_ID;
    const targetGuildIds = explicitGuildId ? [explicitGuildId] : [...client.guilds.cache.keys()];

    // Το `dm` ΠΡΕΠΕΙ να μπει στο hash. Αλλιώς, προσθέτοντας ή αλλάζοντας μια
    // εντολή DM χωρίς να αλλάξει τίποτα άλλο, το hash ταιριάζει, η καταχώρηση
    // παραλείπεται ολόκληρη, και η εντολή απλώς δεν εμφανίζεται ποτέ — χωρίς
    // κανένα σφάλμα πουθενά. Μοιάζει με bug του Discord και δεν είναι.
    const commandsHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        commands: slashCommands,
        dm: dmCommands,
        guilds: [...targetGuildIds].sort()
      }))
      .digest('hex');

    if (database.getStat('commands_hash') === commandsHash) {
      log.info(`Slash commands unchanged (${slashCommands.length}) — skipping registration.`);
      return;
    }

    log.info('Registering slash commands...');

    // Διακόπτης έκτακτης ανάγκης: σβήνει ΚΑΙ τις εντολές DM. Χρήσιμος αν
    // εμφανιστούν διπλές εντολές μέσα σε server.
    const clearGlobal = String(process.env.CLEAR_GLOBAL_COMMANDS || '0') !== '0';
    if (clearGlobal) {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] });
      log.info('Cleared global slash commands.');
    }

    // Σειριακά, όχι Promise.all: με πολλά guilds η παράλληλη ριπή χτυπάει
    // κατευθείαν στα rate limits.
    for (const guildId of targetGuildIds) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: slashCommands });
    }

    // Ξεχωριστή διαδρομή, όχι ρύθμιση: οι εντολές που δένονται σε guild δεν
    // εμφανίζονται ΠΟΤΕ σε DM. Περιορισμένες σε contexts:[BotDM], οπότε δεν
    // διπλασιάζονται μέσα στους servers.
    if (!clearGlobal) {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: dmCommands });
    }

    database.setStat('commands_hash', commandsHash);
    log.info(
      `Registered ${slashCommands.length} commands in ${targetGuildIds.length} guild(s)`
      + `, ${dmCommands.length} in DMs.`
    );
    if (dmCommands.length > 0) {
      // Πρώτη φορά, οι καθολικές εντολές θέλουν έως και μία ώρα να διαδοθούν.
      log.info('DM commands can take up to an hour to appear the first time.');
    }
  } catch (error) {
    log.error('Error registering commands:', error);
  }
}

function register({ client, database, sync, runtime, slashCommands, dmCommands, token }) {
  client.once('clientReady', async () => {
    log.info(`Logged in as ${client.user.tag}`);

    // Ανίχνευση crash: ο καθαρός τερματισμός γράφει clean_shutdown=1. Αν στην
    // εκκίνηση βρούμε 0, η προηγούμενη έξοδος ΔΕΝ ήταν καθαρή — δηλαδή crash,
    // OOM kill ή πτώση ρεύματος. Πιο αξιόπιστο από εικασίες με χρονοσημάνσεις.
    if (database.getStat('clean_shutdown') === '0') {
      log.warn('Previous shutdown was not clean — the bot crashed or was killed.');
      notifyOwner(
        client,
        'crash-restart',
        'Το bot ξαναξεκίνησε μετά από μη καθαρή έξοδο — crash, τερματισμό λόγω '
        + 'μνήμης ή διακοπή ρεύματος. Είναι ξανά online και λειτουργικό.'
      ).catch(() => { /* η ειδοποίηση δεν πρέπει να εμποδίσει την εκκίνηση */ });
    }
    database.setStat('clean_shutdown', '0');
    database.setStat('start_time', Date.now());

    // Στιγμιότυπο των προσκλήσεων, ώστε το guildMemberAdd να μπορεί να βρει
    // ποια χρησιμοποιήθηκε συγκρίνοντας μετρητές.
    for (const guild of client.guilds.cache.values()) {
      try {
        const invites = await guild.invites.fetch();
        client.inviteCache.set(guild.id, new Collection(invites.map((inv) => [inv.code, inv.uses])));
      } catch {
        log.info(`Could not cache invites for ${guild.name}`);
      }
    }

    await registerSlashCommands(client, database, slashCommands, dmCommands, token);

    try {
      runtime.dashboard = await startDashboard(client, database);
    } catch (error) {
      log.error('Failed to start dashboard:', error);
    }

    // Χωρίς BOT_OWNER_ID το isBotOwner() επιστρέφει πάντα false, οπότε το
    // /addauthorized περιορίζεται στον ιδιοκτήτη κάθε guild και οι ειδοποιήσεις
    // βλάβης δεν έχουν παραλήπτη. Σιωπηλή υποβάθμιση — άξιζε προειδοποίηση.
    if (!process.env.BOT_OWNER_ID && !process.env.BOT_OWNER_IDS) {
      log.warn('BOT_OWNER_ID is not set — owner-only features are disabled.');
    }

    startAttachmentGc(client);
    startDailyDigest(client);
    await restoreIdleSessions(client, database);

    sync.emitDashboardSync();
    sync.emitCommandLogsSync();
  });
}

module.exports = { register, restoreIdleSessions };
