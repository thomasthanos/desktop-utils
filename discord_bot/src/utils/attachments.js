const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const log = require('../utils/logger')('attachments');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');

// Ήταν 500MB. Ένα και μόνο τέτοιο αρχείο γέμιζε τη RAM ολόκληρου του server,
// επειδή η παλιά υλοποίηση κρατούσε δύο πλήρη αντίγραφα στη μνήμη πριν καν
// αγγίξει τον δίσκο. 25MB καλύπτει ό,τι στέλνουν οι απλοί χρήστες στο Discord.
const MAX_ATTACHMENT_BYTES = Number(process.env.ATTACHMENT_MAX_MB || 25) * 1024 * 1024;

if (!fs.existsSync(ATTACHMENTS_DIR)) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

// Οι φάκελοι συνεδρίας δημιουργούνταν με σύγχρονο mkdir για ΚΑΘΕ μήνυμα μέσα
// στον βρόχο του /clear. Θυμόμαστε ποιους έχουμε ήδη φτιάξει.
const ensuredDirs = new Set();

function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._\-]/g, '_')
    .slice(0, 128);
}

/**
 * Build a session directory for a user's attachments.
 * Pattern: data/attachments/<guildId>/<userId>/
 * Same user always writes to the same folder — no new folder per operation.
 */
function buildSessionDir(guildId, _channelId, userId) {
  const sessionDir = path.join(ATTACHMENTS_DIR, String(guildId), String(userId || 'unknown'));
  if (!ensuredDirs.has(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
    ensuredDirs.add(sessionDir);
  }
  return sessionDir;
}

function toRelative(fullPath) {
  return path.relative(ATTACHMENTS_DIR, fullPath).replace(/\\/g, '/');
}

/**
 * Κατεβάζει ένα attachment σε ροή και το γράφει στον δίσκο.
 *
 * Η προηγούμενη υλοποίηση έκανε `await response.arrayBuffer()` και μετά
 * `Buffer.from(...)` — δύο πλήρη αντίγραφα του αρχείου στη μνήμη — και έγραφε
 * με μπλοκαριστικό writeFileSync. Εδώ τα bytes περνούν κατευθείαν στον δίσκο
 * και το όριο ελέγχεται ΚΑΤΑ τη ροή, όχι μόνο από το δηλωμένο μέγεθος: το
 * `attachment.size` έρχεται από το Discord και το Content-Length μπορεί να
 * λείπει, οπότε κανένα από τα δύο δεν είναι από μόνο του αρκετό.
 *
 * Γράφουμε πρώτα σε `.part` και μετονομάζουμε — έτσι ένα διακομμένο κατέβασμα
 * δεν αφήνει ημιτελές αρχείο που μοιάζει έγκυρο.
 *
 * @returns {{filePath: string|null, storedOnDisk: boolean, storeError: string|null}}
 */
async function saveAttachmentToDisk(attachment, sessionDir, messageId) {
  const url = attachment.proxyURL || attachment.url || '';
  if (!url) return { filePath: null, storedOnDisk: false, storeError: 'missing_url' };

  const limitMb = Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024);
  if (attachment.size && attachment.size > MAX_ATTACHMENT_BYTES) {
    return {
      filePath: null,
      storedOnDisk: false,
      storeError: `file_too_large (${Math.round(attachment.size / 1024 / 1024)}MB > ${limitMb}MB)`
    };
  }

  const safeName = sanitizeFilename(attachment.name || 'file');
  const fileName = `${messageId}_${safeName}`;
  const fullPath = path.join(sessionDir, fileName);
  const partPath = `${fullPath}.part`;

  // Ήδη αποθηκευμένο (ίδιο messageId = ίδιο αρχείο).
  if (fs.existsSync(fullPath)) {
    return { filePath: toRelative(fullPath), storedOnDisk: true, storeError: null };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { filePath: null, storedOnDisk: false, storeError: `http_${response.status}` };
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) {
      return {
        filePath: null,
        storedOnDisk: false,
        storeError: `file_too_large (${Math.round(declared / 1024 / 1024)}MB > ${limitMb}MB)`
      };
    }

    let written = 0;
    let exceeded = false;
    const source = Readable.fromWeb(response.body);

    // Κόβει τη ροή μόλις ξεπεραστεί το όριο, ώστε ένα ψευδές Content-Length να
    // μη μπορεί να γεμίσει τον δίσκο.
    source.on('data', (chunk) => {
      written += chunk.length;
      if (written > MAX_ATTACHMENT_BYTES && !exceeded) {
        exceeded = true;
        source.destroy(new Error('size_limit_exceeded'));
      }
    });

    await pipeline(source, fs.createWriteStream(partPath));
    await fsp.rename(partPath, fullPath);

    return { filePath: toRelative(fullPath), storedOnDisk: true, storeError: null };
  } catch (error) {
    // Το ημιτελές .part δεν πρέπει ποτέ να μείνει πίσω.
    await fsp.unlink(partPath).catch(() => {});

    if (error?.message === 'size_limit_exceeded') {
      return { filePath: null, storedOnDisk: false, storeError: `file_too_large (> ${limitMb}MB)` };
    }

    // Η παλιά έκδοση κατάπινε ΚΑΘΕ αποτυχία σε ένα σκέτο 'download_failed',
    // κάνοντας αδύνατη τη διάγνωση.
    log.error(`Download failed for ${fileName}:`, error.message);
    return { filePath: null, storedOnDisk: false, storeError: `download_failed (${error.message})` };
  }
}

module.exports = {
  buildSessionDir,
  saveAttachmentToDisk,
  ATTACHMENTS_DIR,
  DATA_DIR,
  MAX_ATTACHMENT_BYTES
};
