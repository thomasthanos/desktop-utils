const fs = require('fs');
const path = require('path');
const { getVoiceConnection } = require('@discordjs/voice');
const { stopIdleLive } = require('./idle-live');
const log = require('./utils/logger')('lifecycle');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INSTANCE_LOCK_FILE = path.join(DATA_DIR, '.bot.instance.lock');

// Κάτω από systemd το lock είναι περιττό — ο supervisor εγγυάται ήδη ένα
// instance — και επιβλαβές, γιατί μια ανακύκλωση PID μπορεί να εμποδίσει το
// boot. Ενεργοποιείται μόνο ρητά, για χειροκίνητη εκτέλεση σε desktop.
const INSTANCE_LOCK_ENABLED = String(process.env.INSTANCE_LOCK || '0') !== '0';

/**
 * Τα PIDs στο Linux ανακυκλώνονται πολύ γρηγορότερα από ό,τι στα Windows, οπότε
 * σκέτο `kill(pid, 0)` μπορεί να δείξει ζωντανή μια εντελώς άσχετη διεργασία
 * που έτυχε να πάρει τον ίδιο αριθμό. Όπου υπάρχει /proc επιβεβαιώνουμε ότι το
 * PID ανήκει όντως σε node.
 */
function isOurProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('node');
  } catch {
    // Χωρίς /proc (Windows/macOS) μένουμε στο σήμα 0.
    return true;
  }
}

function acquireInstanceLock() {
  if (!INSTANCE_LOCK_ENABLED) return;
  try {
    if (fs.existsSync(INSTANCE_LOCK_FILE)) {
      const raw = fs.readFileSync(INSTANCE_LOCK_FILE, 'utf8').trim();
      const existingPid = Number.parseInt(raw, 10);
      if (isOurProcessAlive(existingPid) && existingPid !== process.pid) {
        throw new Error(`Another bot instance is already running (PID ${existingPid}). Stop it first.`);
      }
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INSTANCE_LOCK_FILE, String(process.pid), 'utf8');
  } catch (error) {
    throw new Error(`Failed to acquire instance lock: ${error.message}`);
  }
}

function releaseInstanceLock() {
  if (!INSTANCE_LOCK_ENABLED) return;
  try {
    if (!fs.existsSync(INSTANCE_LOCK_FILE)) return;
    const raw = fs.readFileSync(INSTANCE_LOCK_FILE, 'utf8').trim();
    if (Number.parseInt(raw, 10) === process.pid) fs.unlinkSync(INSTANCE_LOCK_FILE);
  } catch (error) {
    log.warn('Could not release instance lock:', error.message);
  }
}

/**
 * Χτίζει τον χειριστή τερματισμού και συνδέει τα σήματα.
 *
 * Χωρίς αυτό, το SIGTERM του systemd σκότωνε το process ακαριαία: το Discord
 * δεν μάθαινε ποτέ ότι φύγαμε (το bot φαινόταν κολλημένο στο voice channel για
 * 30-60 δευτερόλεπτα) και οι θυγατρικές διεργασίες ffmpeg του ραδιοφώνου
 * επιβίωναν ορφανές.
 *
 * @param {object} deps
 * @param {import('discord.js').Client} deps.client
 * @param {object} deps.database
 * @param {{dashboard: object|null}} deps.runtime γεμίζει αργότερα στο clientReady
 */
function installLifecycle({ client, database, runtime }) {
  let shuttingDown = false;

  async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received — closing down`);

    // Δίχτυ ασφαλείας: αν κάτι κολλήσει, βγες πριν προλάβει το systemd να
    // στείλει SIGKILL (TimeoutStopSec=15).
    const hardExit = setTimeout(() => {
      log.error('Teardown timed out after 10s — forcing exit');
      process.exit(exitCode || 1);
    }, 10_000);
    hardExit.unref();

    // 1. Το ραδιόφωνο πρώτο: εδώ σκοτώνονται οι διεργασίες ffmpeg.
    //    clearPersisted:false ώστε να ξαναρχίσει μόνο του στην επανεκκίνηση —
    //    κλείνουμε το bot, δεν ακυρώνουμε την πρόθεση του χρήστη.
    for (const guildId of [...(client.idleLiveSessions?.keys() || [])]) {
      try {
        await stopIdleLive(client, guildId, { clearPersisted: false });
      } catch (error) {
        log.warn(`idle session ${guildId}:`, error.message);
      }
    }

    // 2. Ουρές του discord-player — καταστρέφουν και τις δικές τους συνδέσεις.
    for (const queue of [...(client.player?.nodes?.cache?.values() || [])]) {
      try {
        queue.delete();
      } catch (error) {
        log.warn('queue teardown:', error.message);
      }
    }

    // 3. Σάρωση για συνδέσεις φωνής που ξέφυγαν από τα δύο προηγούμενα βήματα.
    for (const guildId of client.guilds.cache.keys()) {
      try {
        getVoiceConnection(guildId)?.destroy();
      } catch { /* ήδη κατεστραμμένη */ }
    }

    // 4. Αποσύνδεση από το Discord — εδώ το bot γίνεται offline.
    try {
      await client.destroy();
    } catch (error) {
      log.warn('client.destroy:', error.message);
    }

    // 5. Dashboard.
    if (runtime.dashboard?.server) {
      await new Promise((resolve) => {
        runtime.dashboard.server.close(() => resolve());
        // Τα ανοιχτά WebSockets κρατούν το close() σε αναμονή επ' αόριστον.
        runtime.dashboard.io?.close();
        setTimeout(resolve, 3000).unref();
      });
    }

    // 6. Βάση τελευταία, ώστε να προλάβει να γράψει ό,τι παρήγαγαν τα παραπάνω.
    try {
      // Σημειώνουμε καθαρή έξοδο ΜΟΝΟ όταν όντως τερματίζουμε ομαλά. Αν το
      // process πεθάνει απότομα, η σημαία μένει 0 και η επόμενη εκκίνηση το
      // αναφέρει ως crash.
      if (exitCode === 0) database.setStat('clean_shutdown', '1');
      database.close();
    } catch (error) {
      log.warn('database.close:', error.message);
    }

    releaseInstanceLock();
    clearTimeout(hardExit);
    log.info('Clean exit');
    process.exit(exitCode);
  }

  process.on('exit', releaseInstanceLock);
  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection:', reason);
  });

  /**
   * Μετά από uncaught exception το process βρίσκεται σε απροσδιόριστη
   * κατάσταση: μπορεί να κρατάει μισοκλεισμένα streams, χαλασμένες συνδέσεις
   * φωνής ή ασυνεπή δεδομένα. Το να συνεχίσει να τρέχει απλώς κρύβει το
   * πρόβλημα και παράγει δυσεξήγητες βλάβες αργότερα. Βγαίνουμε και αφήνουμε
   * το systemd να μας ξανασηκώσει καθαρούς.
   */
  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception:', error);
    shutdown('uncaughtException', 1);
  });

  return shutdown;
}

module.exports = { acquireInstanceLock, releaseInstanceLock, installLifecycle, DATA_DIR };
