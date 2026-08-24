const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const log = require('../utils/logger')('attachments');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const ATTACHMENTS_DIR = path.join(DATA_DIR, 'attachments');

const MAX_ATTACHMENT_BYTES = Number(process.env.ATTACHMENT_MAX_MB || 25) * 1024 * 1024;

if (!fs.existsSync(ATTACHMENTS_DIR)) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

const ensuredDirs = new Set();

function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._\-]/g, '_')
    .slice(0, 128);
}

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
    await fsp.unlink(partPath).catch(() => {});

    if (error?.message === 'size_limit_exceeded') {
      return { filePath: null, storedOnDisk: false, storeError: `file_too_large (> ${limitMb}MB)` };
    }

    log.error(`Download failed for ${fileName}:`, error.message);
    return { filePath: null, storedOnDisk: false, storeError: `download_failed (${error.message})` };
  }
}

async function removeStoredFiles(relativePaths) {
  let removed = 0;

  for (const relative of relativePaths || []) {
    if (!relative) continue;

    const full = path.resolve(ATTACHMENTS_DIR, String(relative));
    const inside = full === ATTACHMENTS_DIR || full.startsWith(ATTACHMENTS_DIR + path.sep);
    if (!inside) {
      log.warn(`Refusing to delete outside the attachments folder: ${relative}`);
      continue;
    }

    try {
      await fsp.unlink(full);
      removed += 1;
    } catch (error) {
      if (error.code !== 'ENOENT') log.warn(`Could not delete ${relative}:`, error.message);
    }
  }

  return removed;
}

module.exports = {
  buildSessionDir,
  saveAttachmentToDisk,
  removeStoredFiles,
  ATTACHMENTS_DIR,
  DATA_DIR,
  MAX_ATTACHMENT_BYTES
};
