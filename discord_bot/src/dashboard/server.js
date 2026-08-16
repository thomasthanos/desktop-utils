const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { GatewayIntentBits, PermissionsBitField } = require('discord.js');
const { version: discordPlayerVersion } = require('discord-player');
const {
  isIdleLiveActive,
  getIdleLiveSession,
  stopIdleLive,
  setIdleLiveVolume,
  toggleIdleLivePause
} = require('../idle-live');
const { hasIdlePending, startNextPendingTrack, getIdlePendingList, clearIdlePending } = require('../idle-pending');
const { DATA_DIR } = require('../utils/attachments');
const { teardownQueue } = require('../utils/music');
const { createAuth } = require('./auth');
const log = require('../utils/logger')('dashboard');

function debugAudioLog(...parts) {
  log.debug(...parts);
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

// getStats() κάνει COUNT(*) και SUM() σαρώσεις πινάκων, και το memberCount
// είναι reduce πάνω σε όλο το guild cache. Καλείται από κάθε poll κάθε ανοιχτής
// καρτέλας. Τα δεδομένα είναι μετρητές — 3 δευτερόλεπτα παλαιότητας δεν
// φαίνονται, ενώ η επανάληψη του υπολογισμού φαίνεται στη CPU.
const STATS_TTL_MS = 3000;
let statsCache = { at: 0, value: null };

function buildStats(client, database) {
  const now = Date.now();
  if (statsCache.value && now - statsCache.at < STATS_TTL_MS) {
    // Το uptime πρέπει να προχωράει ακόμα κι όταν τα υπόλοιπα είναι cached.
    return { ...statsCache.value, uptime: formatUptime(now - statsCache.startTime) };
  }

  const stats = database.getStats();
  const value = {
    servers: client.guilds.cache.size,
    users: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
    songsPlayed: stats.songsPlayed,
    commands: client.commands?.size || 0,
    commandUses: stats.totalCommands,
    cleared: stats.totalCleared,
    uptime: formatUptime(now - stats.startTime)
  };
  statsCache = { at: now, value, startTime: stats.startTime };
  return value;
}

function buildSystemHealth(client) {
  const wsPing = Number(client.ws?.ping);
  const voiceNodes = client.player?.nodes?.cache?.size || 0;
  return {
    bot: client.isReady() ? 'Online' : 'Connecting',
    latency: Number.isFinite(wsPing) && wsPing >= 0 ? `${wsPing} ms` : 'N/A',
    voiceQueues: voiceNodes.toString(),
    dashboard: 'Online'
  };
}

function buildConfig(client) {
  const intents = client.options?.intents;
  const hasInviteIntent = Boolean(intents?.has?.(GatewayIntentBits.GuildInvites));
  const hasMembersIntent = Boolean(intents?.has?.(GatewayIntentBits.GuildMembers));
  const spotifyEnabled = Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
  const dashboardPort = client.dashboardInfo?.port || Number(process.env.PORT || 3000);
  return {
    prefix: process.env.COMMAND_PREFIX || '!',
    musicEngine: `discord-player v${discordPlayerVersion}`,
    spotifySupport: spotifyEnabled ? 'Active' : 'Missing Credentials',
    inviteTracking: (hasInviteIntent && hasMembersIntent) ? 'Active' : 'Disabled (Intents)',
    dashboardPort: dashboardPort.toString()
  };
}

function getGuildOptions(client) {
  return client.guilds.cache.map((guild) => ({
    id: guild.id,
    name: guild.name,
    iconUrl: guild.iconURL({ size: 64, forceStatic: false }) || null
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function resolveGuildId(rawGuildId, client) {
  if (!rawGuildId) return null;
  const guildId = String(rawGuildId).trim();
  if (!guildId) return null;
  return client.guilds.cache.has(guildId) ? guildId : null;
}

function resolvePermissionLabel(defaultPermissions) {
  if (!defaultPermissions) return null;
  try {
    const perms = new PermissionsBitField(BigInt(defaultPermissions)).toArray();
    if (!perms.length) return null;
    return perms.map((p) => p.replace(/_/g, ' ')).join(', ');
  } catch {
    return null;
  }
}

function formatDurationFromMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return '--:--';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function resolveTrackDuration(trackLike) {
  const label = trackLike?.duration;
  if (typeof label === 'string' && label.trim()) return label.trim();
  const ms =
    trackLike?.durationMS ?? trackLike?.durationMs ??
    trackLike?.source?.durationMS ?? trackLike?.source?.durationMs ??
    trackLike?.raw?.durationMS ?? trackLike?.raw?.durationMs ?? null;
  return formatDurationFromMs(ms);
}

function serializeTrack(track, index = 0) {
  return {
    index,
    title: track?.title || 'Unknown title',
    author: track?.author || 'Unknown artist',
    duration: resolveTrackDuration(track),
    url: track?.url || '',
    thumbnail: track?.thumbnail || null
  };
}

function collectionToArray(collection) {
  if (!collection) return [];
  if (typeof collection.toArray === 'function') return collection.toArray();
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  return Array.from(collection);
}

function buildMusicLists(queue) {
  if (!queue) return { queue: [], history: [] };
  const upcoming = collectionToArray(queue.tracks).slice(0, 20).map((track, index) => serializeTrack(track, index + 1));
  const history = collectionToArray(queue.history?.tracks).slice(-20).reverse().map((track, index) => serializeTrack(track, index + 1));
  return { queue: upcoming, history };
}

function buildIdlePendingList(client, guildId) {
  return getIdlePendingList(client, guildId, 20).map((item, index) => ({
    index: index + 1,
    title: item.title || item.query || 'Queued track',
    author: item.author || 'Pending',
    duration: resolveTrackDuration(item),
    thumbnail: item.thumbnail || null,
    url: item.url || ''
  }));
}

function buildCombinedUpcomingList(client, guildId, queueList) {
  const base = Array.isArray(queueList) ? queueList : [];
  if (!guildId || !hasIdlePending(client, guildId)) return base;

  const seenUrls = new Set(base.map((item) => String(item?.url || '').trim()).filter(Boolean));
  const pending = buildIdlePendingList(client, guildId).map((item, index) => ({
    ...item,
    index: base.length + index + 1,
    author: `${item.author || 'Pending'} (pending)`
  })).filter((item) => {
    const urlKey = String(item?.url || '').trim();
    if (urlKey && seenUrls.has(urlKey)) return false;
    return true;
  });

  return [...base, ...pending];
}

function buildSyncPayload(client, database, guildId = null) {
  const queue = getActiveQueue(client, guildId);
  let lists = buildMusicLists(queue);
  const recentCommands = guildId ? database.getCommandLogsByGuild(guildId, 4) : database.getCommandLogs().slice(0, 4);
  const commandUsage = guildId ? database.getCommandUsageByGuild(guildId, 4) : database.getCommandUsage(4);
  const timestamp = queue?.node?.getTimestamp ? queue.node.getTimestamp() : null;
  const progress = timestamp ? {
    currentLabel: timestamp.current?.label || '0:00',
    currentValue: Number(timestamp.current?.value || 0),
    totalLabel: timestamp.total?.label || (queue.currentTrack?.duration || '--:--'),
    totalValue: Number(timestamp.total?.value || 0),
    percent: Number(timestamp.progress || 0)
  } : null;

  let state = queue ? {
    guildId: queue.guild?.id || null,
    isPlaying: Boolean(queue.isPlaying?.()),
    isPaused: Boolean(queue.node?.isPaused?.()),
    volume: Number.isFinite(Number(queue.node?.volume)) ? Number(queue.node.volume) : 50,
    canBack: queue.history?.isEmpty ? !queue.history.isEmpty() : false,
    canSkip: Number(queue.size || 0) > 0 || (guildId ? hasIdlePending(client, guildId) : false),
    canStop: true,
    progress
  } : null;

  if (!queue && guildId && isIdleLiveActive(client, guildId)) {
    const idleSession = getIdleLiveSession(client, guildId);
    state = {
      guildId,
      isPlaying: true,
      isPaused: Boolean(idleSession?.paused),
      volume: Number.isFinite(Number(idleSession?.volume)) ? Number(idleSession.volume) : 50,
      canBack: false,
      canSkip: hasIdlePending(client, guildId),
      canStop: true,
      progress: { currentLabel: 'LIVE', currentValue: 0, totalLabel: 'LIVE', totalValue: 0, percent: 0 }
    };
    lists = { queue: buildIdlePendingList(client, guildId), history: [] };
  }

  return {
    selectedGuildId: guildId,
    stats: buildStats(client, database),
    health: buildSystemHealth(client),
    config: buildConfig(client),
    guildOptions: getGuildOptions(client),
    recentCommands,
    commandUsage,
    currentTrack: (guildId && client.currentTrack?.guildId !== guildId) ? null : (client.currentTrack || null),
    playerState: state,
    queueList: buildCombinedUpcomingList(client, guildId, lists.queue),
    historyList: lists.history
  };
}

function getActiveQueue(client, guildId = null) {
  if (!client?.player?.nodes) return null;
  if (guildId) return client.player.nodes.get(guildId) || null;
  if (client.currentTrack?.guildId) {
    const queueByTrack = client.player.nodes.get(client.currentTrack.guildId);
    if (queueByTrack) return queueByTrack;
  }
  const fromCache = client.player.nodes.cache;
  if (!fromCache || fromCache.size === 0) return null;
  return fromCache.find((queue) => queue.isPlaying()) || fromCache.first();
}

/**
 * Δέσιμο σε συγκεκριμένη πόρτα — και αποτυχία αν είναι πιασμένη.
 *
 * Η προηγούμενη υλοποίηση ανέβαινε σιωπηλά μέχρι 20 πόρτες. Σε server αυτό
 * μετατρέπει ένα καθαρό crash σε αόρατη βλάβη: το Cloudflare Tunnel δείχνει
 * στην πόρτα που περιμένει, το dashboard ακούει σε άλλη, και τίποτα δεν
 * δηλώνει το πρόβλημα. Καλύτερα να πεθάνει και να το δεις στα logs.
 */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use on ${host}. Stop the process using it, or set PORT to a free port.`));
        return;
      }
      reject(error);
    };
    server.once('error', onError);
    server.once('listening', () => { server.off('error', onError); resolve(port); });
    server.listen(port, host);
  });
}

async function startDashboard(client, database) {
  const app = express();
  const server = createServer(app);
  const preferredPort = Number(process.env.PORT || 3000);
  const idleSkipInFlightByGuild = new Set();

  // Το loopback είναι το default: το dashboard εκθέτει κάθε αρχειοθετημένο
  // μήνυμα και πλήρη έλεγχο του player. Η απομακρυσμένη πρόσβαση περνά από
  // Cloudflare Tunnel, που συνδέεται τοπικά.
  const host = process.env.DASHBOARD_HOST || '127.0.0.1';
  const auth = createAuth(host);

  // Το allowRequest τρέχει στο WebSocket upgrade, πριν από κάθε middleware του
  // Express — γι' αυτό ο έλεγχος Origin πρέπει να δοθεί εδώ.
  const io = new Server(server, { allowRequest: auth.allowRequest });
  io.use(auth.verifySocket);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Το X-Forwarded-For του Cloudflare Tunnel — χωρίς αυτό ο περιοριστής
  // ρυθμού βλέπει όλους τους επισκέπτες ως 127.0.0.1.
  app.set('trust proxy', true);

  // 32kb: κανένα endpoint δεν δέχεται μεγάλα σώματα. Ήταν χωρίς όριο.
  app.use(express.json({ limit: '32kb' }));
  // Η φόρμα του login στέλνει application/x-www-form-urlencoded.
  app.use(express.urlencoded({ extended: false, limit: '8kb' }));

  app.get('/favicon.ico', (req, res) => { res.status(204).end(); });

  // Το εικονίδιο της καρτέλας σερβίρεται ΠΡΙΝ το requireAuth, επίτηδες: το
  // express.static πιο κάτω είναι πίσω από τη συνεδρία, οπότε η σελίδα login
  // θα ζητούσε ένα εικονίδιο που της απαγορεύεται και ο browser θα έδειχνε το
  // κενό προεπιλεγμένο. Δεν αποκαλύπτει τίποτα — είναι τέσσερα ορθογώνια.
  app.get('/favicon.svg', (req, res) => {
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
  });

  // ---------------------------------------------------------------------
  // Authentication — ΠΡΙΝ από κάθε άλλη διαδρομή.
  //
  // Το /login και τα στατικά αρχεία της σελίδας login πρέπει να είναι
  // προσβάσιμα χωρίς συνεδρία· ΟΛΑ τα υπόλοιπα, συμπεριλαμβανομένων των
  // /attachments, απαιτούν σύνδεση.
  // ---------------------------------------------------------------------
  const loginLimiter = auth.createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

  app.get('/login', (req, res) => {
    if (auth.isAuthenticated(req)) return res.redirect('/');
    res.render('login', { error: null, next: req.query.next || '/' });
  });

  app.post('/login', loginLimiter, (req, res) => {
    const { password, next: nextUrl } = req.body || {};
    if (!auth.checkPassword(password)) {
      return res.status(401).render('login', { error: 'Wrong password.', next: nextUrl || '/' });
    }
    auth.issueSession(res);
    // Μόνο σχετικές διαδρομές — αλλιώς το ?next= γίνεται open redirect.
    const target = typeof nextUrl === 'string' && /^\/(?!\/)/.test(nextUrl) ? nextUrl : '/';
    res.redirect(target);
  });

  app.post('/logout', (req, res) => {
    auth.clearSession(res);
    res.redirect('/login');
  });

  app.use(auth.requireAuth);

  app.use(express.static(path.join(__dirname, 'public')));

  // Serve saved attachments (images, videos, files from /clear and /wipe-channel)
  //
  // Τα αποθηκευμένα αρχεία είναι ανεβασμένα από χρήστες και σερβίρονται από το
  // ίδιο origin με το dashboard. Ένα .svg (ή .html) περιέχει εκτελέσιμο script,
  // οπότε χωρίς αυτές τις κεφαλίδες μια απλή πλοήγηση στο αρχείο θα έτρεχε
  // κώδικα με τη συνεδρία σου. Το Content-Disposition δεν επηρεάζει τα <img>
  // και <video> μέσα στα transcripts — αυτά εξακολουθούν να εμφανίζονται.
  app.use('/attachments', express.static(path.join(DATA_DIR, 'attachments'), {
    dotfiles: 'deny',
    index: false,
    setHeaders(res) {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    }
  }));

  function selectedGuildFromRequest(req) {
    const explicit = resolveGuildId(req.query?.guildId, client);
    if (explicit) return explicit;
    const firstGuild = getGuildOptions(client)[0];
    return firstGuild?.id || null;
  }

  function viewModel(req, page, extras = {}) {
    const selectedGuildId = selectedGuildFromRequest(req);
    const currentTrack = (selectedGuildId && client.currentTrack?.guildId !== selectedGuildId) ? null : (client.currentTrack || null);
    return {
      page,
      currentPath: req.path,
      selectedGuildId,
      guildOptions: getGuildOptions(client),
      currentTrack,
      // Το κουμπί αποσύνδεσης εμφανίζεται μόνο όταν υπάρχει κάτι να αποσυνδεθεί.
      authEnabled: auth.enabled,
      ...extras
    };
  }

  app.get('/', (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    res.render('dashboard', viewModel(req, 'dashboard', {
      stats: buildStats(client, database),
      health: buildSystemHealth(client),
      config: buildConfig(client),
      recentCommands: selectedGuildId ? database.getCommandLogsByGuild(selectedGuildId, 4) : database.getCommandLogs().slice(0, 4),
      commandUsage: selectedGuildId ? database.getCommandUsageByGuild(selectedGuildId, 4) : database.getCommandUsage(4)
    }));
  });

  app.get('/commands', (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    const commands = [];
    client.commands.forEach((cmd) => {
      const category = cmd.category || cmd.meta?.category || 'General';
      const permissionLabel = resolvePermissionLabel(cmd.data.default_member_permissions);
      commands.push({
        name: cmd.data.name,
        description: cmd.data.description,
        category,
        options: cmd.data.options?.map((option) => ({ name: option.name, required: option.required })) || [],
        permissions: cmd.data.default_member_permissions || null,
        permissionLabel
      });
    });
    res.render('commands', viewModel(req, 'commands', {
      commands,
      logs: selectedGuildId ? database.getCommandLogsByGuild(selectedGuildId, 100) : database.getCommandLogs()
    }));
  });

  app.get('/clearlogs', (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    res.render('clearlogs', viewModel(req, 'clearlogs', {
      logs: selectedGuildId ? database.getClearLogsByGuild(selectedGuildId) : database.getClearLogs()
    }));
  });

  app.get('/transcript/:id', (req, res) => {
    const log = database.getClearLog(parseInt(req.params.id, 10));
    if (!log) { res.status(404).send('Not found'); return; }
    res.render('transcript', viewModel(req, 'clearlogs', { log, messages: JSON.parse(log.messages) }));
  });

  app.get('/invites', (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    const logs = selectedGuildId ? database.getInviteLogsByGuild(selectedGuildId, 50) : database.getInviteLogs();
    const leaderboard = selectedGuildId ? database.getInviteLeaderboardByGuild(selectedGuildId, 10) : database.getInviteLeaderboard(10);
    res.render('invites', viewModel(req, 'invites', { logs, leaderboard }));
  });

  app.get('/api/stats', (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    res.json(buildSyncPayload(client, database, selectedGuildId));
  });

  app.get('/api/command-logs', (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    const logs = selectedGuildId ? database.getCommandLogsByGuild(selectedGuildId, 50) : database.getCommandLogs().slice(0, 50);
    res.json(logs);
  });

  app.get('/api/clear-logs', (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    const logs = selectedGuildId ? database.getClearLogsByGuild(selectedGuildId) : database.getClearLogs();
    res.json(logs);
  });

  // Τα endpoints που αλλάζουν κατάσταση περνούν από περιοριστή ρυθμού. Ένα
  // ξεφρενιασμένο script στο dashboard (ή μια καρτέλα που κόλλησε σε βρόχο) δεν
  // πρέπει να μπορεί να σβήσει logs ή να χτυπήσει το voice API σε loop.
  const writeLimiter = auth.createRateLimiter({ windowMs: 60 * 1000, max: 120 });

  app.delete('/api/clear-logs/:id', writeLimiter, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) { res.status(400).json({ ok: false, message: 'Invalid id.' }); return; }
    const deleted = database.deleteClearLog(id);
    if (deleted) client.emit('dashboard:clearLogs');
    res.json({ ok: deleted });
  });

  app.post('/api/player/control', writeLimiter, async (req, res) => {
    const action = req.body?.action;
    const requestedGuildId = resolveGuildId(req.body?.guildId || req.query?.guildId, client);
    const selectedGuildId = requestedGuildId || resolveGuildId(client.currentTrack?.guildId, client);
    const queue = getActiveQueue(client, selectedGuildId);

    try {
      const idleActive = selectedGuildId ? isIdleLiveActive(client, selectedGuildId) : false;
      debugAudioLog('control:request', `action=${action || 'n/a'}`, `guild=${selectedGuildId || 'n/a'}`, `idleActive=${Boolean(idleActive)}`);

      if (action === 'skip' && selectedGuildId && idleActive) {
        if (idleSkipInFlightByGuild.has(selectedGuildId)) {
          res.status(409).json({ ok: false, message: 'Idle skip already in progress.' });
          return;
        }
        idleSkipInFlightByGuild.add(selectedGuildId);
        try {
          if (!hasIdlePending(client, selectedGuildId)) {
            res.status(400).json({ ok: false, message: 'No next track in pending queue.' });
            return;
          }
          const guild = client.guilds.cache.get(selectedGuildId);
          const session = getIdleLiveSession(client, selectedGuildId);
          const voiceChannelId = session?.connection?.joinConfig?.channelId || null;
          const voiceChannel = (guild && voiceChannelId) ? guild.channels.cache.get(voiceChannelId) : null;
          const textChannel = session?.textChannel || null;
          await startNextPendingTrack(client, guild, voiceChannel, textChannel, { destroyIdleConnection: false });
          client.emit('dashboard:sync');
          res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId) });
          return;
        } finally {
          idleSkipInFlightByGuild.delete(selectedGuildId);
        }
      }

      if (action === 'stop' && selectedGuildId) {
        const pendingCleared = clearIdlePending(client, selectedGuildId);
        client.autoIdleGuilds?.delete(selectedGuildId);
        if (client.emptyQueueTimers?.has(selectedGuildId)) {
          clearTimeout(client.emptyQueueTimers.get(selectedGuildId));
          client.emptyQueueTimers.delete(selectedGuildId);
        }
        teardownQueue(queue, log);
        if (idleActive) await stopIdleLive(client, selectedGuildId, { destroyConnection: true });
        if (client.currentTrack?.guildId === selectedGuildId) client.currentTrack = null;
        client.musicEmbedByGuild?.delete(selectedGuildId);
        client.emit('dashboard:sync');
        res.json({ ok: true, pendingCleared, payload: buildSyncPayload(client, database, selectedGuildId) });
        return;
      }

      if (!queue) {
        if (selectedGuildId && idleActive) {
          if (action === 'toggle-pause') {
            toggleIdleLivePause(client, selectedGuildId);
            client.emit('dashboard:sync');
            res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId) });
            return;
          }
          if (action === 'set-volume') {
            const rawValue = Number(req.body?.value);
            if (!Number.isFinite(rawValue)) throw new Error('Invalid volume value.');
            const safeVol = Math.max(0, Math.min(100, Math.round(rawValue)));
            database.setGuildVolume(selectedGuildId, safeVol);
            setIdleLiveVolume(client, selectedGuildId, safeVol);
            client.emit('dashboard:sync');
            res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId) });
            return;
          }
          if (action === 'reorder') {
            const from = Number(req.body?.from);
            const to = Number(req.body?.to);
            if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('Invalid reorder indices.');
            const pendingMap = client.idlePendingByGuild;
            const pendingList = pendingMap?.get(selectedGuildId);
            if (!pendingList || !Array.isArray(pendingList)) throw new Error('No pending queue to reorder.');
            if (from < 0 || from >= pendingList.length || to < 0 || to >= pendingList.length) throw new Error('Index out of range.');
            const [moved] = pendingList.splice(from, 1);
            pendingList.splice(to, 0, moved);
            client.emit('dashboard:sync');
            res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId) });
            return;
          }
        }
        res.status(404).json({ ok: false, message: 'No active queue.' });
        return;
      }

      switch (action) {
        case 'toggle-pause':
          if (queue.node.isPaused()) queue.node.resume(); else queue.node.pause();
          break;
        case 'skip': {
          if (queue.size <= 0) { queue.node.stop(); break; }
          const skipped = queue.node.skip();
          if (!skipped) queue.node.stop();
          break;
        }
        case 'back':
          if (queue.history.isEmpty()) throw new Error('No previous track in the queue.');
          await queue.history.back();
          break;
        case 'set-volume': {
          const rawValue = Number(req.body?.value);
          if (!Number.isFinite(rawValue)) throw new Error('Invalid volume value.');
          const safeVol = Math.max(0, Math.min(100, Math.round(rawValue)));
          database.setGuildVolume(selectedGuildId, safeVol);
          queue.node.setVolume(safeVol);
          break;
        }
        case 'reorder': {
          const from = Number(req.body?.from);
          const to = Number(req.body?.to);
          if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('Invalid reorder indices.');
          // discord-player v7: queue.tracks is a TrackCollection with .data array
          const trackStore = queue.tracks?.data || queue.tracks?.store || null;
          if (trackStore && Array.isArray(trackStore)) {
            if (from < 0 || from >= trackStore.length || to < 0 || to >= trackStore.length) throw new Error('Index out of range.');
            const [moved] = trackStore.splice(from, 1);
            trackStore.splice(to, 0, moved);
          } else if (typeof queue.moveTrack === 'function') {
            queue.moveTrack(from, to);
          } else {
            throw new Error('Queue reorder not supported.');
          }
          break;
        }
        default:
          res.status(400).json({ ok: false, message: 'Unknown action.' });
          return;
      }

      client.emit('dashboard:sync');
      res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId) });
    } catch (error) {
      log.error('player control error:', error);
      res.status(500).json({ ok: false, message: error.message || 'Player action failed.' });
    }
  });

  io.on('connection', (socket) => {
    const selectedGuildId = resolveGuildId(socket.handshake.query?.guildId, client);
    socket.data.selectedGuildId = selectedGuildId;
    socket.emit('dashboard:sync', buildSyncPayload(client, database, selectedGuildId));
    socket.emit('dashboard:commandLogs', selectedGuildId
      ? database.getCommandLogsByGuild(selectedGuildId, 50)
      : database.getCommandLogs().slice(0, 50));
  });

  client.on('dashboard:sync', () => {
    io.sockets.sockets.forEach((socket) => {
      const selectedGuildId = socket.data?.selectedGuildId || null;
      socket.emit('dashboard:sync', buildSyncPayload(client, database, selectedGuildId));
    });
  });

  client.on('dashboard:commandLogs', () => {
    io.sockets.sockets.forEach((socket) => {
      const selectedGuildId = socket.data?.selectedGuildId || null;
      const logs = selectedGuildId
        ? database.getCommandLogsByGuild(selectedGuildId, 50)
        : database.getCommandLogs().slice(0, 50);
      socket.emit('dashboard:commandLogs', logs);
    });
  });

  client.on('dashboard:clearLogs', () => {
    io.sockets.sockets.forEach((socket) => {
      const selectedGuildId = socket.data?.selectedGuildId || null;
      const logs = selectedGuildId
        ? database.getClearLogsByGuild(selectedGuildId)
        : database.getClearLogs();
      socket.emit('dashboard:clearLogs', logs);
    });
  });

  await listen(server, preferredPort, host);
  client.dashboardInfo = { port: preferredPort, host };
  log.info(
    `Dashboard running at http://${host}:${preferredPort}` +
    (auth.enabled ? '' : ' (NO PASSWORD — loopback only)')
  );

  return { app, server, io };
}

module.exports = startDashboard;
