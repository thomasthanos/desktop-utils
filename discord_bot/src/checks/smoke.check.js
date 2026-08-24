#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { start, ROOT } = require('./harness');

const { pass, fail, warn, section, finish } = start();

const SRC = path.join(ROOT, 'src');
const REAL_DATA = process.env.DATA_DIR || path.join(ROOT, 'data');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botsmoke-'));
const realDb = path.join(REAL_DATA, 'bot.db');
if (fs.existsSync(realDb)) fs.copyFileSync(realDb, path.join(tmp, 'bot.db'));
process.env.DATA_DIR = tmp;

function cleanup() {
  try { require(path.join(SRC, 'database.js')).close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

section('Modules');
const CORE = [
  'database.js', 'prefix-commands.js', 'idle-live.js', 'idle-pending.js',
  'utils/authorization.js', 'utils/attachments.js', 'utils/attachment-gc.js'
];
for (const rel of CORE) {
  try { require(path.join(SRC, rel)); pass(rel); }
  catch (err) { fail(`${rel} — ${err.message}`); }
}

section('Commands');
const commands = [];
const cmdDir = path.join(SRC, 'commands');
for (const file of fs.readdirSync(cmdDir).filter((f) => f.endsWith('.js')).sort()) {
  try {
    const mod = require(path.join(cmdDir, file));

    if (mod.disabled) {
      pass(`${file} — disabled on purpose (${mod.disabled})`);
      continue;
    }

    const problems = [];
    if (!mod.data) problems.push('no data');
    if (typeof mod.execute !== 'function') problems.push('no execute()');
    if (!mod.category) problems.push('no category');
    try { mod.data.toJSON(); } catch (e) { problems.push(`data.toJSON(): ${e.message}`); }
    if (problems.length) fail(`${file} — ${problems.join(', ')}`);
    else { commands.push(mod); pass(`/${mod.data.name} [${mod.category}] ${(mod.aliases || []).join(' ')}`); }
  } catch (err) {
    fail(`${file} — ${err.message}`);
  }
}

section('Name collisions');
const seenNames = new Map();
const seenAliases = new Map();
const norm = (s) => String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
let collisions = 0;
for (const mod of commands) {
  const name = mod.data.name;
  if (seenNames.has(name)) { collisions++; fail(`duplicate command /${name}`); }
  seenNames.set(name, true);
  for (const alias of mod.aliases || []) {
    const key = norm(alias);
    if (seenAliases.has(key)) { collisions++; fail(`alias '${alias}' collides with ${seenAliases.get(key)}`); }
    else seenAliases.set(key, `/${name}`);
  }
}
if (collisions === 0) pass(`${seenNames.size} commands, ${seenAliases.size} aliases, no collisions`);

section('Emoji assets');
{
  const { FALLBACK } = require(path.join(SRC, 'utils/emojis.js'));
  const dir = path.join(ROOT, 'assets', 'emoji', 'png');
  const names = Object.keys(FALLBACK);

  if (!fs.existsSync(dir)) {
    warn(`${dir} δεν υπάρχει — ο έλεγχος εικονιδίων παραλείπεται`);
  } else {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.replace('.png', ''));
      const noIcon = names.filter((n) => !files.includes(n));
      const noName = files.filter((f) => !names.includes(f));

      noIcon.length === 0
        ? pass(`${names.length} ονόματα, όλα έχουν εικονίδιο`)
        : fail(`χωρίς εικονίδιο στο assets/emoji/png: ${noIcon.join(', ')}`);

      noName.length === 0
        ? pass('κανένα αχρησιμοποίητο εικονίδιο')
        : warn(`εικονίδια που δεν τα ζητά ο κώδικας: ${noName.join(', ')}`);

      const tooBig = files.filter((f) => fs.statSync(path.join(dir, `${f}.png`)).size > 256 * 1024);
      tooBig.length === 0
        ? pass('όλα κάτω από το όριο των 256 KB του Discord')
        : fail(`πάνω από 256 KB: ${tooBig.join(', ')}`);
    } catch (err) {
      fail(`emoji assets — ${err.message}`);
    }
  }
}

section('Database');
try {
  const database = require(path.join(SRC, 'database.js'));
  const integrity = database.db.pragma('integrity_check', { simple: true });
  integrity === 'ok' ? pass('integrity_check ok') : fail(`integrity_check: ${integrity}`);

  const mode = database.db.pragma('journal_mode', { simple: true });
  mode === 'wal' ? pass('journal_mode wal') : warn(`journal_mode is '${mode}', expected wal`);

  const junk = database.db
    .prepare("SELECT COUNT(*) c FROM bot_stats WHERE key GLOB '[0-9]*' AND key NOT GLOB '*[^0-9]*'")
    .get().c;
  junk === 0 ? pass('bot_stats has no timestamp-keyed junk rows') : fail(`${junk} junk rows in bot_stats`);

  database.getStats();
  pass('getStats() works');
} catch (err) {
  fail(`database — ${err.message}`);
}

section('Audio stack');
try {
  const dependencyReport = require('@discordjs/voice').generateDependencyReport();

  const values = new Map();
  for (const line of dependencyReport.split('\n')) {
    const match = line.match(/^-\s*(.+?):\s*(.*)$/);
    if (match) values.set(match[1].trim(), match[2].trim());
  }

  const opus = values.get('@discordjs/opus');
  if (opus && opus !== 'not found') {
    pass(`@discordjs/opus ${opus} — idle radio uses the native encoder`);
  } else {
    warn('@discordjs/opus NOT found — idle radio falls back to opusscript (pure JS, high CPU on a small VPS)');
  }

  values.get('native crypto support for aes-256-gcm') === 'yes'
    ? pass('native aes-256-gcm available (sodium-native not needed)')
    : warn('no native aes-256-gcm — voice encryption falls back to the pure-JS path');

  const ffmpegVersion = values.get('version');
  if (ffmpegVersion) {
    pass(`ffmpeg ${ffmpegVersion.slice(0, 40)}`);
    values.get('libopus') === 'yes'
      ? pass('ffmpeg built with libopus')
      : warn('ffmpeg lacks libopus — the IDLE_STREAM_MODE=opus path will not work');
  } else {
    fail('ffmpeg not detected by @discordjs/voice');
  }
} catch (err) {
  fail(`audio stack — ${err.message}`);
}

section('Binaries');
for (const [label, bin] of [
  ['ffmpeg', process.env.FFMPEG_PATH || (() => { try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; } })()],
  ['yt-dlp', process.env.YTDLP_PATH || null]
]) {
  if (!bin) { warn(`${label}: no explicit path set (using the npm-bundled copy)`); continue; }
  const res = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  const alt = res.error ? spawnSync(bin, ['--version'], { encoding: 'utf8' }) : res;
  if (alt.error) fail(`${label} not runnable at '${bin}' — ${alt.error.message}`);
  else pass(`${label} ok (${String(alt.stdout || alt.stderr).split('\n')[0].slice(0, 60)})`);
}

cleanup();
finish('all checks passed');
