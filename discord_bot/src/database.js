const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const log = require('./utils/logger')('database');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'bot.db');

// better-sqlite3 γράφει απευθείας στο αρχείο με πραγματικό WAL journal, οπότε
// δεν υπάρχει βήμα "σειριοποίησε ΟΛΗ τη βάση και ξαναγράψ' την". Η προηγούμενη
// υλοποίηση (sql.js) το έκανε αυτό σε ΚΑΘΕ εγγραφή, μπλοκάροντας το event loop
// — δηλαδή και το heartbeat του gateway και τη ροή του ήχου — και άφηνε
// κατεστραμμένο αρχείο αν το process πέθαινε στη μέση της εγγραφής.

let _db = null;

// Cache προετοιμασμένων statements. Το prepare() κάνει parse του SQL, οπότε
// σε hot paths (logCommand σε κάθε εντολή) η επανάληψή του είναι σπατάλη.
const _stmtCache = new Map();

function prepare(sql) {
  let stmt = _stmtCache.get(sql);
  if (!stmt) {
    stmt = _db.prepare(sql);
    _stmtCache.set(sql, stmt);
  }
  return stmt;
}

// Το sql.js δεχόταν undefined ως παράμετρο και το αποθήκευε ως NULL. Το
// better-sqlite3 πετάει TypeError. Κανονικοποιούμε εδώ ώστε ένα undefined από
// call site (π.χ. logSong με άγνωστο guildId) να μη ρίχνει το bot.
function normalize(params) {
  return params.map((p) => (p === undefined ? null : p));
}

// ---------------------------------------------------------------------------
// Tiny helpers that mimic better-sqlite3's synchronous prepared-statement API
// ---------------------------------------------------------------------------

/**
 * Run a statement that does NOT return rows (INSERT, UPDATE, DELETE).
 * Returns { changes: <number> }.
 */
function run(sql, params = []) {
  return prepare(sql).run(...normalize(params));
}

/**
 * Run a SELECT and return the first row as a plain object, or undefined.
 */
function get(sql, params = []) {
  return prepare(sql).get(...normalize(params));
}

/**
 * Run a SELECT and return all rows as an array of plain objects.
 */
function all(sql, params = []) {
  return prepare(sql).all(...normalize(params));
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

_db = new Database(DB_PATH);

// WAL: οι αναγνώσεις δεν μπλοκάρουν τις εγγραφές και το commit είναι atomic —
// crash στη μέση μιας εγγραφής δεν αφήνει πλέον κατεστραμμένο αρχείο.
_db.pragma('journal_mode = WAL');
// NORMAL: το fsync γίνεται στα checkpoints αντί για κάθε commit. Με WAL αυτό
// είναι ασφαλές για crash της εφαρμογής· μόνο απώλεια ρεύματος μπορεί να χάσει
// τις τελευταίες συναλλαγές, κάτι απολύτως αποδεκτό για logs bot.
_db.pragma('synchronous = NORMAL');
// Αν κάποιο άλλο process κρατάει τη βάση, περίμενε αντί να πετάξεις SQLITE_BUSY.
_db.pragma('busy_timeout = 5000');
_db.pragma('foreign_keys = ON');

_db.exec(`
    CREATE TABLE IF NOT EXISTS command_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_tag TEXT NOT NULL,
      guild_id TEXT,
      guild_name TEXT,
      channel_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clear_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      moderator_id TEXT NOT NULL,
      moderator_tag TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      guild_name TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      messages TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invite_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_id TEXT NOT NULL,
      inviter_tag TEXT NOT NULL,
      invited_id TEXT NOT NULL,
      invited_tag TEXT NOT NULL,
      invite_code TEXT,
      guild_id TEXT NOT NULL,
      guild_name TEXT NOT NULL,
      total_invites INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS songs_played (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      artist TEXT,
      url TEXT,
      requested_by TEXT,
      guild_id TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bot_stats (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      volume INTEGER NOT NULL DEFAULT 50
    );

    CREATE TABLE IF NOT EXISTS command_authorized_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      command_name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      added_by_id TEXT NOT NULL,
      added_by_tag TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guild_id, command_name, user_id)
    );
`);

// Καθαρισμός παλιών σκουπιδιών: μια προηγούμενη έκδοση έγραφε
// `INSERT OR IGNORE INTO bot_stats (key, value) VALUES (<timestamp>, '0')`,
// χρησιμοποιώντας τη χρονοσήμανση ως primary key. Το OR IGNORE δεν συγκρουόταν
// ποτέ, οπότε ο πίνακας μεγάλωνε κατά μία γραμμή σε κάθε εκκίνηση για πάντα.
// Τα κλειδιά αυτά είναι αμιγώς αριθμητικά, σε αντίθεση με τα πραγματικά.
_db.exec("DELETE FROM bot_stats WHERE key GLOB '[0-9]*' AND key NOT GLOB '*[^0-9]*'");

run('INSERT OR IGNORE INTO bot_stats (key, value) VALUES (?, ?)', ['start_time', Date.now().toString()]);
run('INSERT OR IGNORE INTO bot_stats (key, value) VALUES (?, ?)', ['total_commands', '0']);

// ---------------------------------------------------------------------------
// Μεταναστεύσεις σχήματος
//
// Το CREATE TABLE IF NOT EXISTS δεν προσθέτει στήλες σε πίνακα που ήδη
// υπάρχει, οπότε οι νέες στήλες χρειάζονται ρητό ALTER. Το SQLite δεν έχει
// "ADD COLUMN IF NOT EXISTS", γι' αυτό ελέγχουμε πρώτα το table_info.
// ---------------------------------------------------------------------------

function ensureColumn(table, column, definition) {
  const columns = _db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  _db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  log.info(`Added column ${table}.${column}`);
}

// Κατάσταση αναπαραγωγής, ώστε το ραδιόφωνο να ξαναρχίζει μόνο του μετά από
// reboot ή ενημέρωση αντί να περιμένει να ξαναγράψεις /idlemusic.
ensureColumn('guild_settings', 'active_voice_channel', 'TEXT');
ensureColumn('guild_settings', 'active_text_channel', 'TEXT');
ensureColumn('guild_settings', 'idle_active', 'INTEGER NOT NULL DEFAULT 0');

// Διακόπτης 24/7: το bot μένει στο κανάλι ό,τι κι αν γίνει. Προεπιλογή 0, ώστε
// μια υπάρχουσα βάση να κρατήσει ακριβώς τη σημερινή συμπεριφορά.
ensureColumn('guild_settings', 'stay_24_7', 'INTEGER NOT NULL DEFAULT 0');

// ---------------------------------------------------------------------------
// Public API  — identical shape to the old better-sqlite3 module
// ---------------------------------------------------------------------------

const api = {
  /**
   * Η αρχικοποίηση είναι πλέον σύγχρονη — το better-sqlite3 δεν φορτώνει WASM.
   * Κρατάμε τη μέθοδο ως Promise ώστε το `await database.ready()` στο
   * src/index.js να μη χρειάζεται αλλαγή.
   */
  ready() { return Promise.resolve(api); },

  /** Raw db handle (better-sqlite3 Database instance). */
  get db() { return _db; },

  /** Διάβασμα μιας τιμής από τον πίνακα bot_stats. */
  getStat(key) {
    return get('SELECT value FROM bot_stats WHERE key = ?', [key])?.value ?? null;
  },

  /** Εγγραφή/ενημέρωση μιας τιμής στον πίνακα bot_stats. */
  setStat(key, value) {
    run(`
      INSERT INTO bot_stats (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [key, String(value)]);
  },

  /**
   * Κλείσιμο της βάσης στον τερματισμό. Το better-sqlite3 κάνει checkpoint του
   * WAL στο close(), οπότε τα δεδομένα βρίσκονται στο κύριο αρχείο.
   */
  close() {
    if (!_db) return;
    try {
      _db.close();
    } finally {
      _db = null;
      _stmtCache.clear();
    }
  },

  logCommand(command, user, guild, channelId) {
    run(
      `INSERT INTO command_logs (command, user_id, user_tag, guild_id, guild_name, channel_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [command, user.id, user.tag || user.username, guild?.id || null, guild?.name || null, channelId || null]
    );
    // Bug fix: use a single atomic SQL expression to avoid race condition
    // when two commands execute concurrently and both read the same count.
    run(
      "UPDATE bot_stats SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'total_commands'"
    );
  },

  logClear(moderator, channel, guild, messages) {
    run(
      `INSERT INTO clear_logs (moderator_id, moderator_tag, channel_id, channel_name, guild_id, guild_name, message_count, messages)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        moderator.id, moderator.tag || moderator.username,
        channel.id, channel.name,
        guild.id, guild.name,
        messages.length,
        JSON.stringify(messages)
      ]
    );
  },

  logInvite(inviter, invited, code, guild, totalInvites) {
    run(
      `INSERT INTO invite_logs (inviter_id, inviter_tag, invited_id, invited_tag, invite_code, guild_id, guild_name, total_invites)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        inviter.id, inviter.tag || inviter.username,
        invited.id, invited.tag || invited.username,
        code, guild.id, guild.name, totalInvites
      ]
    );
  },

  logSong(title, artist, url, requestedBy, guildId) {
    run(
      `INSERT INTO songs_played (title, artist, url, requested_by, guild_id)
       VALUES (?, ?, ?, ?, ?)`,
      [title, artist || 'Unknown', url, requestedBy, guildId]
    );
  },

  getStats() {
    const totalCommands = get('SELECT value FROM bot_stats WHERE key = ?', ['total_commands'])?.value || '0';
    const startTime = get('SELECT value FROM bot_stats WHERE key = ?', ['start_time'])?.value || Date.now().toString();
    const songsPlayed = get('SELECT COUNT(*) as count FROM songs_played')?.count || 0;
    const totalCleared = get('SELECT COALESCE(SUM(message_count), 0) as total FROM clear_logs')?.total || 0;
    return {
      totalCommands: parseInt(totalCommands),
      songsPlayed,
      totalCleared,
      startTime: parseInt(startTime)
    };
  },

  getClearLogs() {
    return all('SELECT * FROM clear_logs ORDER BY timestamp DESC');
  },

  getClearLogsByGuild(guildId) {
    return all(`
      SELECT *
      FROM clear_logs
      WHERE guild_id = ?
      ORDER BY timestamp DESC
    `, [guildId]);
  },

  getClearLog(id) {
    return get('SELECT * FROM clear_logs WHERE id = ?', [id]);
  },

  getInviteLogs() {
    return all('SELECT * FROM invite_logs ORDER BY timestamp DESC');
  },

  getInviteLeaderboard(limit = 10) {
    return all(`
      SELECT inviter_id, inviter_tag, MAX(total_invites) as total_invites
      FROM invite_logs
      GROUP BY inviter_id, inviter_tag
      ORDER BY total_invites DESC, inviter_tag ASC
      LIMIT ?
    `, [limit]);
  },

  getInviteLogsByGuild(guildId, limit = 50) {
    return all(`
      SELECT *
      FROM invite_logs
      WHERE guild_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [guildId, limit]);
  },

  getInviteLeaderboardByGuild(guildId, limit = 10) {
    return all(`
      SELECT inviter_id, inviter_tag, MAX(total_invites) as total_invites
      FROM invite_logs
      WHERE guild_id = ?
      GROUP BY inviter_id, inviter_tag
      ORDER BY total_invites DESC, inviter_tag ASC
      LIMIT ?
    `, [guildId, limit]);
  },

  getCommandLogs() {
    return all('SELECT * FROM command_logs ORDER BY timestamp DESC LIMIT 100');
  },

  getCommandLogsByGuild(guildId, limit = 100) {
    return all(`
      SELECT *
      FROM command_logs
      WHERE guild_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `, [guildId, limit]);
  },

  getCommandUsage(limit = 10) {
    return all(`
      SELECT command, COUNT(*) as uses
      FROM command_logs
      GROUP BY command
      ORDER BY uses DESC, command ASC
      LIMIT ?
    `, [limit]);
  },

  getCommandUsageByGuild(guildId, limit = 10) {
    return all(`
      SELECT command, COUNT(*) as uses
      FROM command_logs
      WHERE guild_id = ?
      GROUP BY command
      ORDER BY uses DESC, command ASC
      LIMIT ?
    `, [guildId, limit]);
  },

  addAuthorizedUser(guildId, commandName, user, addedBy) {
    run(`
      INSERT INTO command_authorized_users (guild_id, command_name, user_id, added_by_id, added_by_tag)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, command_name, user_id) DO UPDATE SET
        added_by_id = excluded.added_by_id,
        added_by_tag = excluded.added_by_tag,
        timestamp = CURRENT_TIMESTAMP
    `, [
      guildId,
      commandName.toLowerCase(),
      user.id,
      addedBy.id,
      addedBy.tag || addedBy.username || 'Unknown'
    ]);
  },

  removeAuthorizedUser(guildId, commandName, userId) {
    const result = run(`
      DELETE FROM command_authorized_users
      WHERE guild_id = ? AND command_name = ? AND user_id = ?
    `, [guildId, commandName.toLowerCase(), userId]);
    return result.changes > 0;
  },

  isAuthorizedUser(guildId, commandName, userId) {
    const row = get(`
      SELECT 1
      FROM command_authorized_users
      WHERE guild_id = ? AND command_name = ? AND user_id = ?
      LIMIT 1
    `, [guildId, commandName.toLowerCase(), userId]);
    return Boolean(row);
  },

  hasAuthorizedEntriesForCommand(guildId, commandName) {
    const row = get(`
      SELECT COUNT(*) as count
      FROM command_authorized_users
      WHERE guild_id = ? AND command_name = ?
    `, [guildId, commandName.toLowerCase()]);
    return Number(row?.count || 0) > 0;
  },

  getAuthorizedUsersForCommand(guildId, commandName) {
    return all(`
      SELECT user_id
      FROM command_authorized_users
      WHERE guild_id = ? AND command_name = ?
    `, [guildId, commandName.toLowerCase()]);
  },

  deleteClearLog(id) {
    const result = run('DELETE FROM clear_logs WHERE id = ?', [id]);
    return result.changes > 0;
  },

  // In-memory volume cache — avoids synchronous SQLite on every track start
  _volumeCache: new Map(),

  getGuildVolume(guildId) {
    if (this._volumeCache.has(guildId)) return this._volumeCache.get(guildId);
    const row = get('SELECT volume FROM guild_settings WHERE guild_id = ?', [guildId]);
    const vol = row ? row.volume : 50;
    this._volumeCache.set(guildId, vol);
    return vol;
  },

  setGuildVolume(guildId, volume) {
    const safe = Math.max(0, Math.min(100, Math.round(Number(volume))));
    run(`
      INSERT INTO guild_settings (guild_id, volume) VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET volume = excluded.volume
    `, [guildId, safe]);
    this._volumeCache.set(guildId, safe);
    return safe;
  },

  // -------------------------------------------------------------------------
  // Διακόπτης 24/7
  // -------------------------------------------------------------------------

  // Διαβάζεται σε ΚΑΘΕ voiceStateUpdate — κάθε mute, κάθε είσοδος, κάθε έξοδος
  // σε κάθε guild. Εκεί το cache δεν είναι πολυτέλεια· χωρίς αυτό βάζουμε
  // σύγχρονο SQLite στη διαδρομή ενός γεγονότος υψηλής συχνότητας.
  _stayCache: new Map(),

  getStay247(guildId) {
    if (this._stayCache.has(guildId)) return this._stayCache.get(guildId);
    const row = get('SELECT stay_24_7 FROM guild_settings WHERE guild_id = ?', [guildId]);
    const stay = row ? Boolean(row.stay_24_7) : false;
    this._stayCache.set(guildId, stay);
    return stay;
  },

  setStay247(guildId, enabled) {
    const value = enabled ? 1 : 0;
    // Ξεχωριστό INSERT ... ON CONFLICT που γράφει ΜΟΝΟ τη δική του στήλη. Ένα
    // κοινό «γράψε όλες τις ρυθμίσεις» θα πάταγε την ένταση με ό,τι είχε στα
    // χέρια του ο caller.
    run(`
      INSERT INTO guild_settings (guild_id, stay_24_7) VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET stay_24_7 = excluded.stay_24_7
    `, [guildId, value]);
    this._stayCache.set(guildId, Boolean(value));
    return Boolean(value);
  },

  // -------------------------------------------------------------------------
  // Κατάσταση αναπαραγωγής για αυτόματη επαναφορά μετά από restart
  // -------------------------------------------------------------------------

  /**
   * Καταγράφει ότι το ραδιόφωνο παίζει σε αυτά τα κανάλια, ώστε να μπορεί να
   * ξαναρχίσει μόνο του μετά από reboot ή ενημέρωση.
   */
  setIdleState(guildId, { voiceChannelId, textChannelId, active }) {
    run(`
      INSERT INTO guild_settings (guild_id, volume, active_voice_channel, active_text_channel, idle_active)
      VALUES (?, 50, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        active_voice_channel = excluded.active_voice_channel,
        active_text_channel = excluded.active_text_channel,
        idle_active = excluded.idle_active
    `, [guildId, voiceChannelId || null, textChannelId || null, active ? 1 : 0]);
  },

  /** Guilds στα οποία το ραδιόφωνο έπαιζε όταν σταμάτησε το bot. */
  getIdleStatesToRestore() {
    return all(`
      SELECT guild_id, active_voice_channel, active_text_channel
      FROM guild_settings
      WHERE idle_active = 1 AND active_voice_channel IS NOT NULL
    `);
  }
};

// Export the api directly for synchronous property access (e.g. database.logCommand).
// Callers that need to wait for init should call `await database.ready()`.
module.exports = api;
