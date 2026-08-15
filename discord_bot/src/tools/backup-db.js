#!/usr/bin/env node
/**
 * Νυχτερινό αντίγραφο της βάσης.
 *
 *   node scripts/backup-db.js [--push]
 *
 * Χρησιμοποιεί το online backup API του SQLite, ΟΧΙ σκέτο cp: με ενεργό WAL,
 * η αντιγραφή του bot.db ενώ γράφεται δίνει αντίγραφο χωρίς τις πιο πρόσφατες
 * συναλλαγές — ή κατεστραμμένο.
 *
 * Με --push, τα αντίγραφα ανεβαίνουν σε ξεχωριστό ΙΔΙΩΤΙΚΟ repo. Δωρεάν,
 * εκτός μηχανήματος και με ιστορικό. Τα attachments ΔΕΝ ανεβαίνουν — είναι
 * εκατοντάδες MB και υπάρχουν ήδη στο CDN του Discord.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 14);

function log(...args) {
  console.log('[backup]', ...args);
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    log(`No database at ${DB_PATH} — nothing to back up.`);
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);
  const target = path.join(BACKUP_DIR, `bot-${stamp}.db`);

  const db = new Database(DB_PATH, { readonly: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }

  // Επαλήθευση: ένα αντίγραφο που δεν ανοίγει δεν είναι αντίγραφο.
  const check = new Database(target, { readonly: true });
  try {
    const integrity = check.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity_check said: ${integrity}`);
    const rows = check.prepare('SELECT COUNT(*) c FROM clear_logs').get().c;
    log(`Wrote ${path.basename(target)} (${Math.round(fs.statSync(target).size / 1024)}KB, ${rows} transcripts, integrity ok)`);
  } finally {
    check.close();
  }

  // Το άνοιγμα μιας βάσης σε WAL δημιουργεί -shm/-wal δίπλα της. Στο αντίγραφο
  // είναι άχρηστα (τα δεδομένα είναι ήδη ενσωματωμένα) και θα κατέληγαν στο
  // repo των backups.
  for (const sidecar of [`${target}-shm`, `${target}-wal`]) {
    try { fs.unlinkSync(sidecar); } catch { /* δεν δημιουργήθηκε */ }
  }

  // Διαγραφή παλιών.
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!/^bot-\d{4}-\d{2}-\d{2}\.db$/.test(name)) continue;
    const full = path.join(BACKUP_DIR, name);
    if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); pruned++; }
  }
  if (pruned > 0) log(`Pruned ${pruned} backup(s) older than ${KEEP_DAYS} days.`);

  if (process.argv.includes('--push')) pushToGit();
}

/**
 * Ανεβάζει τον φάκελο backups σε ξεχωριστό ιδιωτικό repo. Το BACKUP_GIT_REMOTE
 * πρέπει να δείχνει σε αυτό, με deploy key που έχει δικαίωμα εγγραφής.
 */
function pushToGit() {
  const remote = process.env.BACKUP_GIT_REMOTE;
  if (!remote) {
    log('BACKUP_GIT_REMOTE is not set — skipping off-box push.');
    return;
  }
  const git = (...args) => execFileSync('git', args, { cwd: BACKUP_DIR, encoding: 'utf8' });

  try {
    if (!fs.existsSync(path.join(BACKUP_DIR, '.git'))) {
      git('init', '-q');
      git('remote', 'add', 'origin', remote);
      git('branch', '-M', 'main');
    }
    git('add', '-A');
    // Χωρίς αλλαγές, το commit αποτυγχάνει — αυτό δεν είναι σφάλμα.
    const status = git('status', '--porcelain');
    if (!status.trim()) { log('No backup changes to push.'); return; }
    git('-c', 'user.email=bot@localhost', '-c', 'user.name=backup', 'commit', '-q', '-m', `backup ${new Date().toISOString()}`);
    git('push', '-q', '-u', 'origin', 'main');
    log('Pushed backups off-box.');
  } catch (error) {
    // Ένα αποτυχημένο push δεν πρέπει να ακυρώνει ένα επιτυχημένο τοπικό
    // αντίγραφο — αλλά πρέπει να φαίνεται καθαρά στα logs.
    console.error('[backup] Off-box push failed:', error.message);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[backup] FAILED:', error.message);
  process.exit(1);
});
