const fsp = require('fs/promises');
const path = require('path');
const { ATTACHMENTS_DIR } = require('./attachments');

const log = require('../utils/logger')('attachment-gc');
const RETENTION_DAYS = Number(process.env.ATTACHMENT_RETENTION_DAYS || 30);
const MAX_TOTAL_BYTES = Number(process.env.ATTACHMENT_MAX_TOTAL_MB || 5000) * 1024 * 1024;
const INTERVAL_MS = 24 * 60 * 60 * 1000;

function mb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

/** Συλλέγει αναδρομικά κάθε αρχείο με μέγεθος και ώρα τροποποίησης. */
async function collectFiles(dir, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log.warn(`Cannot read ${dir}:`, error.message);
    }
    return out;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, out);
      continue;
    }
    try {
      const stat = await fsp.stat(full);
      out.push({ path: full, size: stat.size, mtime: stat.mtimeMs });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        log.warn(`Cannot stat ${full}:`, error.message);
      }
    }
  }
  return out;
}

/** Αφαιρεί φακέλους που έμειναν άδειοι μετά τις διαγραφές. */
async function pruneEmptyDirs(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) await pruneEmptyDirs(path.join(dir, entry.name));
  }

  if (dir === ATTACHMENTS_DIR) return;
  try {
    const remaining = await fsp.readdir(dir);
    if (remaining.length === 0) await fsp.rmdir(dir);
  } catch { /* έγινε ταυτόχρονη εγγραφή — το επόμενο πέρασμα θα το πιάσει */ }
}

/**
 * Δύο κανόνες, με αυτή τη σειρά:
 *   1. διαγραφή ό,τι είναι παλαιότερο από RETENTION_DAYS
 *   2. αν το σύνολο ξεπερνά ακόμα το όριο, διαγραφή παλαιότερων πρώτα
 *
 * Χωρίς αυτό ο φάκελος μεγάλωνε χωρίς κανένα φράγμα — ήδη 108MB από 70 αρχεία,
 * με δύο βίντεο των 39MB και 37MB.
 */
async function runAttachmentGc() {
  const started = Date.now();
  const files = await collectFiles(ATTACHMENTS_DIR);
  if (files.length === 0) return { deleted: 0, freedBytes: 0, remainingBytes: 0 };

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const survivors = [];
  let deleted = 0;
  let freed = 0;

  for (const file of files) {
    if (file.mtime < cutoff) {
      try {
        await fsp.unlink(file.path);
        deleted++;
        freed += file.size;
      } catch (error) {
        log.warn(`Cannot delete ${file.path}:`, error.message);
        survivors.push(file);
      }
    } else {
      survivors.push(file);
    }
  }

  let total = survivors.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    survivors.sort((a, b) => a.mtime - b.mtime); // παλαιότερα πρώτα
    for (const file of survivors) {
      if (total <= MAX_TOTAL_BYTES) break;
      try {
        await fsp.unlink(file.path);
        deleted++;
        freed += file.size;
        total -= file.size;
      } catch (error) {
        log.warn(`Cannot delete ${file.path}:`, error.message);
      }
    }
  }

  if (deleted > 0) await pruneEmptyDirs(ATTACHMENTS_DIR);

  const summary = { deleted, freedBytes: freed, remainingBytes: total };
  if (deleted > 0) {
    log.info(
      `[attachment-gc] Removed ${deleted} file(s), freed ${mb(freed)}MB, ` +
      `${mb(total)}MB remaining (${Date.now() - started}ms)`
    );
  }
  return summary;
}

/**
 * Ένας γεμάτος δίσκος σταματά τις εγγραφές στη βάση και τα κατεβάσματα, αλλά
 * το bot μοιάζει ζωντανό. Καλύτερα να το μάθεις πριν συμβεί.
 */
async function checkDiskPressure(client) {
  if (!client || typeof fsp.statfs !== 'function') return null; // statfs: Node 18.15+
  try {
    const stats = await fsp.statfs(ATTACHMENTS_DIR);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    if (!total) return null;

    const usedPct = Math.round(((total - free) / total) * 100);
    if (usedPct >= 85) {
      const { notifyOwner } = require('./notify');
      await notifyOwner(
        client,
        'disk-pressure',
        `Ο δίσκος του server είναι **${usedPct}% γεμάτος**. Αν γεμίσει τελείως, `
        + 'το bot σταματά να γράφει στη βάση και να αποθηκεύει αρχεία.',
        {
          fields: [
            { name: 'Ελεύθερος χώρος', value: `${mb(free)} MB`, inline: true },
            { name: 'Συνολικός', value: `${mb(total)} MB`, inline: true }
          ]
        }
      );
    }
    return usedPct;
  } catch (error) {
    log.warn('Could not check disk usage:', error.message);
    return null;
  }
}

/** Τρέχει τώρα και μετά μία φορά την ημέρα. */
function startAttachmentGc(client) {
  const tick = async () => {
    try {
      await runAttachmentGc();
      await checkDiskPressure(client);
    } catch (error) {
      log.error('Run failed:', error.message);
    }
  };
  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref(); // να μην κρατάει ζωντανό το process στον τερματισμό
  return timer;
}

module.exports = { runAttachmentGc, startAttachmentGc, checkDiskPressure };
