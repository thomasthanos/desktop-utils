const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const log = require('./utils/logger')('database');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = path.join(dataDir, 'bot.db');

let _db = null;

const _stmtCache = new Map();

function prepare(sql) {
  let stmt = _stmtCache.get(sql);
  if (!stmt) {
    stmt = _db.prepare(sql);
    _stmtCache.set(sql, stmt);
  }
  return stmt;
}

function normalize(params) {
  return params.map((p) => (p === undefined ? null : p));
}

function run(sql, params = []) {
  return prepare(sql).run(...normalize(params));
}

function get(sql, params = []) {
  return prepare(sql).get(...normalize(params));
}

function all(sql, params = []) {
  return prepare(sql).all(...normalize(params));
}

_db = new Database(DB_PATH);

_db.pragma('journal_mode = WAL');

_db.pragma('synchronous = NORMAL');

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

    CREATE INDEX IF NOT EXISTS idx_command_logs_guild_time
      ON command_logs (guild_id, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_clear_logs_guild_time
      ON clear_logs (guild_id, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_invite_logs_guild_time
      ON invite_logs (guild_id, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_songs_played_guild
      ON songs_played (guild_id);

    CREATE TABLE IF NOT EXISTS dashboard_permissions (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      capability TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, user_id, capability)
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

_db.exec("DELETE FROM bot_stats WHERE key GLOB '[0-9]*' AND key NOT GLOB '*[^0-9]*'");

run('INSERT OR IGNORE INTO bot_stats (key, value) VALUES (?, ?)', ['start_time', Date.now().toString()]);
run('INSERT OR IGNORE INTO bot_stats (key, value) VALUES (?, ?)', ['total_commands', '0']);

function ensureColumn(table, column, definition) {
  const columns = _db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  _db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  log.info(`Added column ${table}.${column}`);
}

ensureColumn('guild_settings', 'active_voice_channel', 'TEXT');
ensureColumn('guild_settings', 'active_text_channel', 'TEXT');
ensureColumn('guild_settings', 'idle_active', 'INTEGER NOT NULL DEFAULT 0');

ensureColumn('guild_settings', 'stay_24_7', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('guild_settings', 'invite_log_channel', 'TEXT');

ensureColumn('invite_logs', 'event', "TEXT NOT NULL DEFAULT 'join'");
ensureColumn('invite_logs', 'is_fake', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('invite_logs', 'left_at', 'DATETIME');

// Η στήλη user_id κρατά πλέον id χρήστη ή ρόλου — και τα δύο είναι snowflakes,
// οπότε δεν συγκρούονται. Ό,τι γράφτηκε πριν από αυτή τη στήλη ήταν χρήστης.
ensureColumn('command_authorized_users', 'principal_type', "TEXT NOT NULL DEFAULT 'user'");

const api = {
  ready() { return Promise.resolve(api); },

  get db() { return _db; },

  getStat(key) {
    return get('SELECT value FROM bot_stats WHERE key = ?', [key])?.value ?? null;
  },

  pruneDailyStats(keepDays = 30) {
    const cutoff = new Date(Date.now() - keepDays * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    const boundary = `ai_quips_${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`;
    const result = run("DELETE FROM bot_stats WHERE key LIKE 'ai_quips_%' AND key < ?", [boundary]);
    return result.changes;
  },

  setStat(key, value) {
    run(`
      INSERT INTO bot_stats (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [key, String(value)]);
  },

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

  deleteInviteLogsByGuild(guildId) {
    const result = run('DELETE FROM invite_logs WHERE guild_id = ?', [String(guildId)]);
    return result.changes;
  },

  getInviteLogChannel(guildId) {
    const row = get('SELECT invite_log_channel FROM guild_settings WHERE guild_id = ?', [String(guildId)]);
    return row?.invite_log_channel || null;
  },

  setInviteLogChannel(guildId, channelId) {
    run(`
      INSERT INTO guild_settings (guild_id, invite_log_channel)
      VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET invite_log_channel = excluded.invite_log_channel
    `, [String(guildId), channelId ? String(channelId) : null]);
    return true;
  },

  countPreviousJoins(guildId, userId) {
    const row = get(`
      SELECT COUNT(*) AS count
      FROM invite_logs
      WHERE guild_id = ? AND invited_id = ? AND COALESCE(event, 'join') = 'join'
    `, [String(guildId), String(userId)]);
    return Number(row?.count || 0);
  },

  getLastJoin(guildId, userId) {
    return get(`
      SELECT id, timestamp, is_fake, inviter_id, inviter_tag, invite_code, total_invites
      FROM invite_logs
      WHERE guild_id = ? AND invited_id = ? AND COALESCE(event, 'join') = 'join'
      ORDER BY id DESC
      LIMIT 1
    `, [String(guildId), String(userId)]);
  },

  markJoinFake(id, leftAt) {
    const result = run(
      'UPDATE invite_logs SET is_fake = 1, left_at = ? WHERE id = ?',
      [leftAt || new Date().toISOString(), id]
    );
    return result.changes > 0;
  },

  logInviteEvent({ event, inviter, invited, code, guild, totalInvites = 0, isFake = false }) {
    const result = run(
      `INSERT INTO invite_logs
         (inviter_id, inviter_tag, invited_id, invited_tag, invite_code, guild_id, guild_name, total_invites, event, is_fake)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        inviter?.id || 'unknown', inviter?.tag || inviter?.username || 'Άγνωστος',
        invited.id, invited.tag || invited.username,
        code || null, guild.id, guild.name, totalInvites,
        event, isFake ? 1 : 0
      ]
    );
    return result.lastInsertRowid;
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
    // κάθε broadcast στέλνει αυτή τη λίστα· το messages blob μένει πίσω
    return all('SELECT id, moderator_id, moderator_tag, channel_id, channel_name, guild_id, guild_name, message_count, timestamp FROM clear_logs ORDER BY timestamp DESC');
  },

  getClearLogsByGuild(guildId) {
    return all(`
      SELECT id, moderator_id, moderator_tag, channel_id, channel_name, guild_id, guild_name, message_count, timestamp
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
      SELECT
        inviter_id,
        inviter_tag,
        SUM(CASE WHEN COALESCE(event, 'join') = 'join' AND is_fake = 0 THEN 1 ELSE 0 END) AS total_invites,
        SUM(CASE WHEN COALESCE(event, 'join') = 'join' AND is_fake = 1 THEN 1 ELSE 0 END) AS fake_invites,
        SUM(CASE WHEN event IN ('leave', 'kick', 'ban') THEN 1 ELSE 0 END) AS left_invites
      FROM invite_logs
      WHERE guild_id = ?
        AND inviter_id <> 'unknown'
      GROUP BY inviter_id, inviter_tag
      ORDER BY total_invites DESC, inviter_tag ASC
      LIMIT ?
    `, [guildId, limit]);
  },

  getDashboardPermissions(guildId, userId) {
    const rows = all(`
      SELECT capability, enabled
      FROM dashboard_permissions
      WHERE guild_id = ? AND user_id = ?
    `, [String(guildId), String(userId)]);

    const out = {};
    for (const row of rows) out[row.capability] = Boolean(row.enabled);
    return out;
  },

  listDashboardPermissions(guildId) {
    return all(`
      SELECT user_id, capability, enabled
      FROM dashboard_permissions
      WHERE guild_id = ?
      ORDER BY user_id, capability
    `, [String(guildId)]);
  },

  clearDashboardPermissions(guildId, userId) {
    const result = run(
      `DELETE FROM dashboard_permissions WHERE guild_id = ? AND user_id = ?`,
      [String(guildId), String(userId)]
    );
    return result.changes;
  },

  setDashboardPermission(guildId, userId, capability, enabled) {
    if (enabled === null) {
      const result = run(`
        DELETE FROM dashboard_permissions
        WHERE guild_id = ? AND user_id = ? AND capability = ?
      `, [String(guildId), String(userId), capability]);
      return result.changes > 0;
    }

    run(`
      INSERT INTO dashboard_permissions (guild_id, user_id, capability, enabled, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(guild_id, user_id, capability)
      DO UPDATE SET enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP
    `, [String(guildId), String(userId), capability, enabled ? 1 : 0]);
    return true;
  },

  getLastCommandChannelId(guildId) {
    const row = get(`
      SELECT channel_id
      FROM command_logs
      WHERE guild_id = ? AND channel_id IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 1
    `, [guildId]);
    return row ? row.channel_id : null;
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

  addAuthorizedUser(guildId, commandName, user, addedBy, principalType = 'user') {
    run(`
      INSERT INTO command_authorized_users (guild_id, command_name, user_id, principal_type, added_by_id, added_by_tag)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, command_name, user_id) DO UPDATE SET
        principal_type = excluded.principal_type,
        added_by_id = excluded.added_by_id,
        added_by_tag = excluded.added_by_tag,
        timestamp = CURRENT_TIMESTAMP
    `, [
      guildId,
      commandName.toLowerCase(),
      user.id,
      principalType === 'role' ? 'role' : 'user',
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

  clearAuthorizedUsersForCommand(guildId, commandName) {
    const result = run(`
      DELETE FROM command_authorized_users
      WHERE guild_id = ? AND command_name = ?
    `, [guildId, commandName.toLowerCase()]);
    return result.changes;
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

  // Ένα ερώτημα για τον χρήστη και όλους τους ρόλους του μαζί — όχι ένα ανά ρόλο.
  isAuthorizedPrincipal(guildId, commandName, userId, roleIds = []) {
    const ids = [userId, ...roleIds].filter(Boolean).map(String);
    if (!ids.length) return false;

    const placeholders = ids.map(() => '?').join(', ');
    const row = get(`
      SELECT 1
      FROM command_authorized_users
      WHERE guild_id = ? AND command_name = ? AND user_id IN (${placeholders})
      LIMIT 1
    `, [guildId, commandName.toLowerCase(), ...ids]);
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

  listCommandAccess(guildId) {
    return all(`
      SELECT command_name, user_id, principal_type, added_by_tag, timestamp
      FROM command_authorized_users
      WHERE guild_id = ?
      ORDER BY command_name ASC, principal_type ASC, timestamp ASC
    `, [guildId]);
  },

  deleteClearLogsByGuild(guildId) {
    const rows = all(
      'SELECT id, messages FROM clear_logs WHERE guild_id = ?',
      [String(guildId)]
    );
    if (rows.length === 0) return { deleted: 0, rows: [] };

    const result = run('DELETE FROM clear_logs WHERE guild_id = ?', [String(guildId)]);
    return { deleted: result.changes, rows };
  },

  deleteClearLog(id) {
    const result = run('DELETE FROM clear_logs WHERE id = ?', [id]);
    return result.changes > 0;
  },

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

    run(`
      INSERT INTO guild_settings (guild_id, stay_24_7) VALUES (?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET stay_24_7 = excluded.stay_24_7
    `, [guildId, value]);
    this._stayCache.set(guildId, Boolean(value));
    return Boolean(value);
  },

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

  getIdleStatesToRestore() {
    return all(`
      SELECT guild_id, active_voice_channel, active_text_channel
      FROM guild_settings
      WHERE idle_active = 1 AND active_voice_channel IS NOT NULL
    `);
  }
};

module.exports = api;
