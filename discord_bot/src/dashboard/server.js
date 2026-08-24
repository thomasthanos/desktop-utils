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
const { DATA_DIR, removeStoredFiles } = require('../utils/attachments');
const { teardownQueue } = require('../utils/music');
const { canControlMusic } = require('../utils/voice');
const { currentTrackFor, clearCurrentTrack, anyCurrentTrack } = require('../utils/now-playing');
const {
  CAPABILITIES,
  CAPABILITY_NAMES,
  capabilitiesFor,
  canManagePermissions,
  visibleGuilds,
  canSeeAnyGuild,
  everything
} = require('../utils/permissions');
const { restrictableCommands } = require('../utils/authorization');
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

const STATS_TTL_MS = 3000;
let statsCache = { at: 0, value: null };

function buildStats(client, database) {
  const now = Date.now();
  if (statsCache.value && now - statsCache.at < STATS_TTL_MS) {
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

function buildSyncPayload(client, database, guildId = null, viewer = null) {
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

  const capabilities = viewer?.unrestricted ? everything(true) : (viewer?.capabilities || everything(false));

  const control = (viewer?.unrestricted && !viewer?.passwordSession)
    ? { ok: true, reason: 'open', message: null }
    : (capabilities.music
      ? canControlMusic(client, guildId, viewer?.id || null)
      : { ok: false, reason: 'forbidden', message: 'Δεν έχεις δικαίωμα για τη μουσική εδώ.' });

  const commandsVisible = capabilities.commands;

  return {
    selectedGuildId: guildId,
    capabilities,
    canControl: control.ok,
    controlReason: control.reason,
    controlMessage: control.message,
    stats: buildStats(client, database),
    health: buildSystemHealth(client),
    config: buildConfig(client),
    // Η πλήρης λίστα των server έφευγε σε κάθε socket, ακόμα και σε όποιον
    // επιτρέπεται να δει έναν μόνο. Το viewer κουβαλά ήδη τη δική του.
    guildOptions: viewer?.guilds || (viewer ? [] : getGuildOptions(client)),
    recentCommands: commandsVisible ? recentCommands : [],
    commandUsage: commandsVisible ? commandUsage : [],
    currentTrack: currentTrackFor(client, guildId),
    playerState: state,
    queueList: buildCombinedUpcomingList(client, guildId, lists.queue),
    historyList: lists.history
  };
}

function getActiveQueue(client, guildId = null) {
  if (!client?.player?.nodes) return null;
  if (guildId) return client.player.nodes.get(guildId) || null;
  const playingSomewhere = anyCurrentTrack(client);
  if (playingSomewhere?.guildId) {
    const queueByTrack = client.player.nodes.get(playingSomewhere.guildId);
    if (queueByTrack) return queueByTrack;
  }
  const fromCache = client.player.nodes.cache;
  if (!fromCache || fromCache.size === 0) return null;
  return fromCache.find((queue) => queue.isPlaying()) || fromCache.first();
}

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

  const host = process.env.DASHBOARD_HOST || '127.0.0.1';
  const auth = createAuth(host);

  const io = new Server(server, { allowRequest: auth.allowRequest });
  io.use(auth.verifySocket);

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.set('trust proxy', 1);

  app.use(express.json({ limit: '32kb' }));

  app.use(express.urlencoded({ extended: false, limit: '8kb' }));

  app.get('/favicon.ico', (req, res) => res.redirect(302, '/favicon-login.svg'));

  app.get('/favicon.svg', (req, res) => {
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
  });
  for (const faviconName of ['favicon-login.svg', 'favicon-app.svg']) {
    app.get(`/${faviconName}`, (req, res) => {
      res.type('image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.sendFile(path.join(__dirname, 'public', faviconName));
    });
  }

  app.get('/css/style.css', (req, res) => {
    res.type('text/css');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.sendFile(path.join(__dirname, 'public', 'css', 'style.css'));
  });

  const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  const loginLimiter = auth.createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

  function renderLogin(res, status, error, next = '/') {
    return res.status(status).render('login', {
      error,
      next,
      oauthEnabled: auth.oauthEnabled,
      passwordEnabled: auth.passwordEnabled
    });
  }

  app.get('/login', (req, res) => {
    if (auth.isAuthenticated(req)) return res.redirect('/');
    renderLogin(res, 200, null, req.query.next || '/');
  });

  app.post('/login', loginLimiter, (req, res) => {
    const { password, next: nextUrl } = req.body || {};
    if (!auth.checkPassword(password)) {
      return renderLogin(res, 401, 'Λάθος κωδικός.', nextUrl || '/');
    }
    auth.issueSession(res);

    const target = typeof nextUrl === 'string' && /^\/(?!\/)/.test(nextUrl) ? nextUrl : '/';
    res.redirect(target);
  });

  app.get('/auth/discord', (req, res) => {
    if (!auth.oauthEnabled) return res.redirect('/login');

    const url = auth.authorizeUrl(auth.issueState(res));
    if (!url) return res.redirect('/login');
    res.redirect(url);
  });

  app.get('/auth/discord/callback', loginLimiter, wrap(async (req, res) => {
    if (!auth.oauthEnabled) return res.redirect('/login');

    if (!auth.consumeState(req, res, req.query?.state)) {
      return renderLogin(res, 400, 'Η σύνδεση δεν επιβεβαιώθηκε ή έληξε. Δοκίμασε ξανά.');
    }

    const user = await auth.exchangeCode(req.query?.code);
    if (!user) {
      return renderLogin(res, 401, 'Η σύνδεση με Discord απέτυχε.');
    }

    const welcome = auth.isAllowed(user.uid)
      || await canSeeAnyGuild(client, database, user.uid).catch(() => false);

    if (!welcome) {
      log.warn(`Discord login refused for ${user.tag} (${user.uid}) — no Manage Server anywhere the bot is.`);
      return renderLogin(
        res,
        403,
        'Δεν έχεις πρόσβαση. Χρειάζεται δικαίωμα Manage Server σε έναν server που έχει το bot.'
      );
    }

    auth.issueSession(res, user);
    log.info(`Discord login: ${user.tag} (${user.uid})`);
    res.redirect('/');
  }));

  app.post('/logout', (req, res) => {
    auth.clearSession(res);
    res.redirect('/login');
  });

  app.use(auth.requireAuth);

  app.use(express.static(path.join(__dirname, 'public')));

  async function capabilitiesForViewer(req, guildId) {
    if (!auth.enabled) return everything(true);

    const uid = auth.sessionUser(req)?.uid || null;
    if (!uid) return everything(true);

    if (guildId && req.viewer?.selectedGuildId === guildId && req.viewer.capabilities) {
      return req.viewer.capabilities;
    }

    if (!req._capabilityCache) req._capabilityCache = new Map();
    if (req._capabilityCache.has(guildId)) return req._capabilityCache.get(guildId);

    const resolved = await capabilitiesFor(client, database, guildId, uid);
    req._capabilityCache.set(guildId, resolved);
    return resolved;
  }

  app.use('/attachments', async (req, res, next) => {
    const guildId = String(req.path || '').split('/').filter(Boolean)[0] || null;
    if (!guildId) return res.status(404).end();

    try {
      const capabilities = await capabilitiesForViewer(req, guildId);
      if (!capabilities.transcripts) return res.status(403).end();
      return next();
    } catch (error) {
      return next(error);
    }
  });

  app.use('/attachments', express.static(path.join(DATA_DIR, 'attachments'), {
    dotfiles: 'deny',
    index: false,
    setHeaders(res) {
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    }
  }));

  async function buildViewer(userId, requestedGuildId) {
    const openDashboard = !auth.enabled;

    const passwordSession = auth.enabled && !userId;

    const unrestricted = openDashboard || passwordSession;

    const guilds = unrestricted
      ? getGuildOptions(client)
      : await visibleGuilds(client, database, userId);

    const requested = resolveGuildId(requestedGuildId, client);
    const selectedGuildId = (requested && guilds.some((guild) => guild.id === requested))
      ? requested
      : (guilds[0]?.id || null);

    const capabilities = unrestricted
      ? everything(true)
      : await capabilitiesFor(client, database, selectedGuildId, userId);

    const canManagePerms = unrestricted
      ? true
      : await canManagePermissions(client, database, selectedGuildId, userId);

    return { id: userId, unrestricted, passwordSession, guilds, selectedGuildId, capabilities, canManagePerms };
  }

  app.use(async (req, res, next) => {
    try {
      req.viewer = await buildViewer(auth.sessionUser(req)?.uid || null, req.query?.guildId);
      next();
    } catch (error) {
      next(error);
    }
  });

  // Τα δικαιώματα του socket ήταν στιγμιότυπο της στιγμής που συνδέθηκε: αν
  // του έκοβες την πρόσβαση όσο ήταν ανοιχτή η σελίδα, συνέχιζε να τροφοδοτείται
  // κανονικά. Ξαναχτίζονται, με μικρό TTL για να μη ρωτάμε σε κάθε ριπή.
  const VIEWER_TTL_MS = 5000;

  async function refreshSocketViewer(socket) {
    const expiresAt = socket.data?.expiresAt;
    if (auth.enabled && expiresAt && Date.now() > expiresAt) {
      socket.disconnect(true);
      return null;
    }

    const fresh = Date.now() - (socket.data?.viewerAt || 0) < VIEWER_TTL_MS;
    if (fresh && socket.data?.viewer) return socket.data.viewer;

    const viewer = await buildViewer(socket.data?.userId || null, socket.data?.requestedGuildId);
    socket.data.viewer = viewer;
    socket.data.viewerAt = Date.now();
    socket.data.selectedGuildId = viewer.selectedGuildId;
    return viewer;
  }

  async function eachViewer(handler) {
    for (const socket of io.sockets.sockets.values()) {
      const viewer = await refreshSocketViewer(socket);
      if (viewer) await handler(socket, viewer);
    }
  }

  function selectedGuildFromRequest(req) {
    return req.viewer?.selectedGuildId || null;
  }

  const requireCapability = (name) => (req, res, next) => {
    if (req.viewer?.capabilities?.[name]) return next();

    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ ok: false, reason: 'forbidden', capability: name });
    }
    return res.status(403).render('forbidden', viewModel(req, 'forbidden', {
      capability: CAPABILITIES[name] || null
    }));
  };

  function viewModel(req, page, extras = {}) {
    const selectedGuildId = selectedGuildFromRequest(req);
    const currentTrack = currentTrackFor(client, selectedGuildId);
    return {
      page,
      currentPath: req.path,
      selectedGuildId,
      guildOptions: req.viewer?.guilds || [],
      capabilities: req.viewer?.capabilities || everything(false),
      canManagePerms: Boolean(req.viewer?.canManagePerms),
      currentTrack,

      authEnabled: auth.enabled,
      ...extras
    };
  }

  app.get('/', (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);

    if (!selectedGuildId) {
      return res.status(403).render('forbidden', viewModel(req, 'forbidden', { capability: null }));
    }

    if (!req.viewer.capabilities.view) {
      return res.status(403).render('forbidden', viewModel(req, 'forbidden', { capability: CAPABILITIES.view }));
    }

    res.render('dashboard', viewModel(req, 'dashboard', {
      stats: buildStats(client, database),
      health: buildSystemHealth(client),
      config: buildConfig(client),
      recentCommands: selectedGuildId ? database.getCommandLogsByGuild(selectedGuildId, 4) : database.getCommandLogs().slice(0, 4),
      commandUsage: selectedGuildId ? database.getCommandUsageByGuild(selectedGuildId, 4) : database.getCommandUsage(4)
    }));
  });

  app.get('/commands', requireCapability('commands'), (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    const restricted = new Set(
      selectedGuildId
        ? database.listCommandAccess(selectedGuildId).map((row) => row.command_name)
        : []
    );

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
        permissionLabel,
        restricted: restricted.has(cmd.data.name)
      });
    });
    res.render('commands', viewModel(req, 'commands', {
      commands,
      logs: selectedGuildId ? database.getCommandLogsByGuild(selectedGuildId, 100) : database.getCommandLogs()
    }));
  });

  app.get('/clearlogs', requireCapability('transcripts'), (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    res.render('clearlogs', viewModel(req, 'clearlogs', {
      logs: selectedGuildId ? database.getClearLogsByGuild(selectedGuildId) : database.getClearLogs()
    }));
  });

  app.get('/transcript/:id', requireCapability('transcripts'), wrap(async (req, res) => {
    const log = database.getClearLog(parseInt(req.params.id, 10));
    if (!log) { res.status(404).send('Not found'); return; }

    const capabilities = req.viewer.unrestricted
      ? everything(true)
      : await capabilitiesFor(client, database, log.guild_id, req.viewer.id);

    if (!capabilities.transcripts) {
      res.status(403).render('forbidden', viewModel(req, 'forbidden', { capability: CAPABILITIES.transcripts }));
      return;
    }
    res.render('transcript', viewModel(req, 'clearlogs', { log, messages: JSON.parse(log.messages) }));
  }));

  function inviteChannelFor(guildId) {
    if (!guildId) return null;

    const channelId = database.getInviteLogChannel(guildId);
    if (!channelId) return null;

    const channel = client.guilds.cache.get(guildId)?.channels?.cache?.get(channelId) || null;
    return { id: channelId, name: channel?.name || null };
  }

  app.get('/invites', requireCapability('invites'), (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    const logs = selectedGuildId ? database.getInviteLogsByGuild(selectedGuildId, 50) : database.getInviteLogs();
    const leaderboard = selectedGuildId ? database.getInviteLeaderboardByGuild(selectedGuildId, 10) : database.getInviteLeaderboard(10);
    res.render('invites', viewModel(req, 'invites', {
      logs,
      leaderboard,
      inviteChannel: inviteChannelFor(selectedGuildId)
    }));
  });

  app.get('/api/stats', requireCapability('view'), (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    const viewer = req.viewer;
    res.json(buildSyncPayload(client, database, selectedGuildId, viewer));
  });

  app.get('/api/command-logs', requireCapability('commands'), (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    const logs = selectedGuildId ? database.getCommandLogsByGuild(selectedGuildId, 50) : database.getCommandLogs().slice(0, 50);
    res.json(logs);
  });

  app.get('/api/clear-logs', requireCapability('transcripts'), (req, res) => {
    const selectedGuildId = selectedGuildFromRequest(req);
    const logs = selectedGuildId ? database.getClearLogsByGuild(selectedGuildId) : database.getClearLogs();
    res.json(logs);
  });

  const writeLimiter = auth.createRateLimiter({ windowMs: 60 * 1000, max: 120 });

  const requirePermissionManager = (req, res, next) => {
    if (req.viewer?.canManagePerms) return next();

    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ ok: false, reason: 'forbidden' });
    }
    return res.status(403).render('forbidden', viewModel(req, 'forbidden', {
      capability: { label: 'Διαχείριση δικαιωμάτων', flagLabel: 'Administrator' }
    }));
  };

  async function describeUser(guild, userId) {
    const member = guild?.members?.cache?.get(userId)
      || await guild?.members?.fetch?.(userId).catch(() => null);

    if (member) {
      return {
        id: userId,
        name: member.displayName || member.user?.username || userId,
        avatarUrl: member.displayAvatarURL?.({ size: 64 }) || null,
        isAdmin: Boolean(member.permissions?.has?.(PermissionsBitField.Flags.Administrator)),
        inGuild: true
      };
    }

    // Δεν είναι μέλος εδώ — αλλά ο λογαριασμός υπάρχει, οπότε δείχνουμε όνομα
    // και εικόνα αντί για ένα γυμνό νούμερο.
    const user = client.users?.cache?.get(userId)
      || await client.users?.fetch?.(userId).catch(() => null);

    return {
      id: userId,
      name: user?.globalName || user?.username || userId,
      avatarUrl: user?.displayAvatarURL?.({ size: 64 }) || null,
      isAdmin: false,
      inGuild: false
    };
  }

  // Οι ρόλοι που έχει νόημα να δώσεις: όχι ο @everyone (θα ξεκλείδωνε την
  // εντολή για όλους) και όχι οι managed, που ανήκουν σε bots και integrations.
  function assignableRoles(guild) {
    if (!guild?.roles?.cache) return [];

    return [...guild.roles.cache.values()]
      .filter((role) => role.id !== guild.id && !role.managed)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : null
      }));
  }

  async function buildCommandAccess(guild, guildId) {
    const rows = guildId ? database.listCommandAccess(guildId) : [];
    const byCommand = new Map();

    for (const row of rows) {
      if (!byCommand.has(row.command_name)) byCommand.set(row.command_name, []);
      byCommand.get(row.command_name).push(row);
    }

    const commands = [];
    for (const command of restrictableCommands(client)) {
      const principals = [];

      for (const row of byCommand.get(command.name) || []) {
        if (row.principal_type === 'role') {
          const role = guild?.roles?.cache?.get(row.user_id);
          principals.push({
            id: row.user_id,
            type: 'role',
            name: role ? role.name : row.user_id,
            missing: !role
          });
          continue;
        }

        const person = await describeUser(guild, row.user_id);
        principals.push({
          id: row.user_id,
          type: 'user',
          name: person.name,
          avatarUrl: person.avatarUrl,
          missing: !person.inGuild
        });
      }

      commands.push({
        ...command,
        principals,
        restricted: principals.length > 0,
        defaultLabel: command.defaultAudience
          || resolvePermissionLabel(command.defaultPermissions)
          || null
      });
    }

    return commands;
  }

  app.get('/permissions', requirePermissionManager, wrap(async (req, res) => {
    const guildId = selectedGuildFromRequest(req);
    const guild = client.guilds.cache.get(guildId) || null;

    const overrides = guildId ? database.listDashboardPermissions(guildId) : [];
    const byUser = new Map();
    for (const row of overrides) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, {});
      byUser.get(row.user_id)[row.capability] = Boolean(row.enabled);
    }

    const people = [];
    for (const [userId, values] of byUser) {
      const person = await describeUser(guild, userId);
      person.overrides = values;
      person.effective = await capabilitiesFor(client, database, guildId, userId);
      // Τα δικαιώματα εδώ δεν χρησιμεύουν σε κάποιον που δεν περνά καν το
      // login — αυτό ελέγχεται από το DASHBOARD_ALLOWED_USERS, όχι από εδώ.
      person.canSignIn = !auth.oauthEnabled || auth.isAllowed(userId);
      people.push(person);
    }
    people.sort((a, b) => a.name.localeCompare(b.name));

    res.render('permissions', viewModel(req, 'permissions', {
      people,
      catalogue: CAPABILITY_NAMES.map((name) => ({ name, ...CAPABILITIES[name] })),
      commandAccess: await buildCommandAccess(guild, guildId),
      roles: assignableRoles(guild),
      guildName: guild?.name || null
    }));
  }));

  app.delete('/api/permissions/:userId', writeLimiter, requirePermissionManager, (req, res) => {
    const guildId = selectedGuildFromRequest(req);
    if (!guildId) return res.status(400).json({ ok: false, message: 'Δεν έχει επιλεγεί server.' });

    const userId = String(req.params.userId || '').trim();
    if (!/^[0-9]{5,25}$/.test(userId)) {
      return res.status(400).json({ ok: false, message: 'Μη έγκυρο Discord ID.' });
    }

    const removed = database.clearDashboardPermissions(guildId, userId);
    log.info(`${req.viewer.id} cleared every override for ${userId} in ${guildId}`);
    res.json({ ok: true, removed });
  });

  app.post('/api/permissions', writeLimiter, requirePermissionManager, wrap(async (req, res) => {
    const guildId = selectedGuildFromRequest(req);
    if (!guildId) return res.status(400).json({ ok: false, message: 'Δεν έχει επιλεγεί server.' });

    const userId = String(req.body?.userId || '').trim();
    const capability = String(req.body?.capability || '').trim();
    const value = String(req.body?.value || '').trim();

    if (!/^[0-9]{5,25}$/.test(userId)) {
      return res.status(400).json({ ok: false, message: 'Μη έγκυρο Discord ID.' });
    }
    if (!CAPABILITY_NAMES.includes(capability)) {
      return res.status(400).json({ ok: false, message: 'Άγνωστο δικαίωμα.' });
    }
    if (!['inherit', 'on', 'off', 'track'].includes(value)) {
      return res.status(400).json({ ok: false, message: 'Άγνωστη τιμή.' });
    }

    let stored;
    if (value === 'track') {
      const current = await capabilitiesFor(client, database, guildId, userId);
      stored = Boolean(current[capability]);
    } else {
      stored = value === 'inherit' ? null : value === 'on';
    }

    database.setDashboardPermission(guildId, userId, capability, stored);
    log.info(`${req.viewer.id} set ${capability}=${value} for ${userId} in ${guildId}`);

    const effective = await capabilitiesFor(client, database, guildId, userId);
    res.json({ ok: true, effective, overrides: database.getDashboardPermissions(guildId, userId) });
  }));

  // Σε session με κωδικό δεν υπάρχει Discord ταυτότητα, και το added_by_id
  // είναι NOT NULL — γι' αυτό γράφεται ρητά ποιος ήταν.
  function actorOf(req) {
    const id = req.viewer?.id;
    return id ? { id, tag: id } : { id: 'dashboard', tag: 'dashboard' };
  }

  // Ό,τι δέχεται εντολή περνά από εδώ: η εντολή πρέπει να είναι πραγματικά
  // περιοριστέα, αλλιώς το route θα έγραφε γραμμές που δεν ελέγχει κανείς.
  function commandAccessTarget(req, res) {
    const guildId = selectedGuildFromRequest(req);
    if (!guildId) {
      res.status(400).json({ ok: false, message: 'Δεν έχει επιλεγεί server.' });
      return null;
    }

    const command = String(req.params.command || req.body?.command || '').trim().toLowerCase();
    if (!restrictableCommands(client).some((entry) => entry.name === command)) {
      res.status(400).json({ ok: false, message: 'Αυτή η εντολή δεν κλειδώνεται.' });
      return null;
    }

    return { guildId, command, guild: client.guilds.cache.get(guildId) || null };
  }

  app.post('/api/command-access', writeLimiter, requirePermissionManager, wrap(async (req, res) => {
    const target = commandAccessTarget(req, res);
    if (!target) return;

    const principalId = String(req.body?.principalId || '').trim();
    const principalType = req.body?.principalType === 'role' ? 'role' : 'user';

    if (!/^[0-9]{5,25}$/.test(principalId)) {
      res.status(400).json({ ok: false, message: 'Μη έγκυρο Discord ID.' });
      return;
    }

    if (principalType === 'role') {
      if (principalId === target.guildId) {
        res.status(400).json({ ok: false, message: 'Ο @everyone δεν περιορίζει τίποτα.' });
        return;
      }
      // Ρόλος άλλου server δεν θα ίσχυε ποτέ εδώ, οπότε δεν τον δεχόμαστε καν.
      if (!target.guild?.roles?.cache?.has(principalId)) {
        res.status(400).json({ ok: false, message: 'Αυτός ο ρόλος δεν είναι σε αυτόν τον server.' });
        return;
      }
    }

    const actor = actorOf(req);
    database.addAuthorizedUser(target.guildId, target.command, { id: principalId }, actor, principalType);

    log.info(`${actor.id} allowed ${principalType} ${principalId} on /${target.command} in ${target.guildId}`);
    client.emit('dashboard:sync');

    res.json({ ok: true, access: await buildCommandAccess(target.guild, target.guildId) });
  }));

  app.delete('/api/command-access/:command/:principalId', writeLimiter, requirePermissionManager, wrap(async (req, res) => {
    const target = commandAccessTarget(req, res);
    if (!target) return;

    const principalId = String(req.params.principalId || '').trim();
    if (!/^[0-9]{5,25}$/.test(principalId)) {
      res.status(400).json({ ok: false, message: 'Μη έγκυρο Discord ID.' });
      return;
    }

    const removed = database.removeAuthorizedUser(target.guildId, target.command, principalId);
    if (removed) {
      log.info(`${actorOf(req).id} revoked ${principalId} on /${target.command} in ${target.guildId}`);
      client.emit('dashboard:sync');
    }

    res.json({ ok: true, removed, access: await buildCommandAccess(target.guild, target.guildId) });
  }));

  app.delete('/api/command-access/:command', writeLimiter, requirePermissionManager, wrap(async (req, res) => {
    const target = commandAccessTarget(req, res);
    if (!target) return;

    const removed = database.clearAuthorizedUsersForCommand(target.guildId, target.command);
    if (removed) {
      log.info(`${actorOf(req).id} unlocked /${target.command} in ${target.guildId}`);
      client.emit('dashboard:sync');
    }

    res.json({ ok: true, removed, access: await buildCommandAccess(target.guild, target.guildId) });
  }));

  app.delete('/api/invite-channel', writeLimiter, requirePermissionManager, (req, res) => {
    const guildId = selectedGuildFromRequest(req);
    if (!guildId) return res.status(400).json({ ok: false, message: 'Δεν έχει επιλεγεί server.' });

    const had = Boolean(database.getInviteLogChannel(guildId));
    database.setInviteLogChannel(guildId, null);

    if (had) {
      log.info(`${actorOf(req).id} turned invite announcements off in ${guildId}`);
      client.emit('dashboard:sync');
    }

    return res.json({ ok: true, had });
  });

  function storedFilesOf(row) {
    let messages = [];
    try {
      messages = JSON.parse(row.messages || '[]');
    } catch {
      return [];
    }

    const paths = [];
    for (const message of messages) {
      for (const attachment of message.attachments || []) paths.push(attachment.filePath);
      for (const sticker of message.stickers || []) paths.push(sticker.filePath);
      for (const embed of message.embeds || []) {
        paths.push(embed.imageFilePath, embed.thumbnailFilePath, embed.videoFilePath);
      }
      paths.push(message.authorAvatarFilePath);
    }
    return paths.filter(Boolean);
  }

  app.delete('/api/invite-logs', writeLimiter, requireCapability('invites'), wrap(async (req, res) => {
    const guildId = selectedGuildFromRequest(req);
    if (!guildId) { res.status(400).json({ ok: false, message: 'Δεν έχει επιλεγεί server.' }); return; }

    const capabilities = await capabilitiesForViewer(req, guildId);
    if (!capabilities.invites) { res.status(403).json({ ok: false, reason: 'forbidden' }); return; }

    const deleted = database.deleteInviteLogsByGuild(guildId);
    log.info(`${req.viewer.id || 'password session'} cleared ${deleted} invite record(s) in ${guildId}`);

    client.emit('dashboard:sync');
    res.json({ ok: true, deleted });
  }));

  app.delete('/api/clear-logs', writeLimiter, requireCapability('transcripts'), wrap(async (req, res) => {
    const guildId = selectedGuildFromRequest(req);
    if (!guildId) { res.status(400).json({ ok: false, message: 'Δεν έχει επιλεγεί server.' }); return; }

    const capabilities = await capabilitiesForViewer(req, guildId);
    if (!capabilities.transcripts) { res.status(403).json({ ok: false, reason: 'forbidden' }); return; }

    const { deleted, rows } = database.deleteClearLogsByGuild(guildId);

    const files = rows.flatMap(storedFilesOf);
    const removedFiles = await removeStoredFiles(files);

    if (deleted) client.emit('dashboard:clearLogs');
    log.info(`${req.viewer.id || 'password session'} cleared ${deleted} transcript(s) and ${removedFiles} file(s) in ${guildId}`);

    res.json({ ok: true, deleted, removedFiles });
  }));

  app.delete('/api/clear-logs/:id', writeLimiter, requireCapability('transcripts'), wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) { res.status(400).json({ ok: false, message: 'Invalid id.' }); return; }

    const log = database.getClearLog(id);
    if (!log) { res.status(404).json({ ok: false, message: 'Not found.' }); return; }

    const capabilities = await capabilitiesForViewer(req, log.guild_id);
    if (!capabilities.transcripts) {
      res.status(403).json({ ok: false, reason: 'forbidden' });
      return;
    }

    const deleted = database.deleteClearLog(id);
    if (deleted) client.emit('dashboard:clearLogs');
    res.json({ ok: deleted });
  }));

  app.post('/api/player/control', writeLimiter, wrap(async (req, res) => {
    const action = req.body?.action;
    const requestedGuildId = resolveGuildId(req.body?.guildId || req.query?.guildId, client);
    const selectedGuildId = requestedGuildId || resolveGuildId(anyCurrentTrack(client)?.guildId, client);
    const queue = getActiveQueue(client, selectedGuildId);
    const viewer = req.viewer;

    if (!viewer.unrestricted || viewer.passwordSession) {
      const capabilities = await capabilitiesForViewer(req, selectedGuildId);
      if (!capabilities.music) {
        res.status(403).json({
          ok: false,
          reason: 'forbidden',
          message: 'Δεν έχεις δικαίωμα να χειρίζεσαι τη μουσική σε αυτόν τον server.'
        });
        return;
      }

      const gate = canControlMusic(client, selectedGuildId, viewer.id);
      if (!gate.ok) {
        debugAudioLog('control:refused', `action=${action || 'n/a'}`, `reason=${gate.reason}`);
        res.status(403).json({ ok: false, reason: gate.reason, message: gate.message });
        return;
      }
    }

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
          res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId, viewer) });
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
        clearCurrentTrack(client, selectedGuildId);
        client.musicEmbedByGuild?.delete(selectedGuildId);
        client.emit('dashboard:sync');
        res.json({ ok: true, pendingCleared, payload: buildSyncPayload(client, database, selectedGuildId, viewer) });
        return;
      }

      if (!queue) {
        if (selectedGuildId && idleActive) {
          if (action === 'toggle-pause') {
            toggleIdleLivePause(client, selectedGuildId);
            client.emit('dashboard:sync');
            res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId, viewer) });
            return;
          }
          if (action === 'set-volume') {
            const rawValue = Number(req.body?.value);
            if (!Number.isFinite(rawValue)) throw new Error('Invalid volume value.');
            const safeVol = Math.max(0, Math.min(100, Math.round(rawValue)));
            database.setGuildVolume(selectedGuildId, safeVol);
            setIdleLiveVolume(client, selectedGuildId, safeVol);
            client.emit('dashboard:sync');
            res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId, viewer) });
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
            res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId, viewer) });
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
          const wasPaused = queue.node.isPaused();
          if (queue.size <= 0) { queue.node.stop(); break; }

          const skipped = queue.node.skip();
          if (!skipped) queue.node.stop();
          else if (wasPaused) queue.node.resume();
          break;
        }
        case 'back': {
          if (queue.history.isEmpty()) throw new Error('No previous track in the queue.');

          const wasPaused = queue.node.isPaused();
          await queue.history.back();
          if (wasPaused) queue.node.resume();
          break;
        }
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

          const size = Number(queue.tracks?.size || 0);
          if (from < 0 || from >= size || to < 0 || to >= size) throw new Error('Index out of range.');

          queue.moveTrack(from, to);
          break;
        }
        default:
          res.status(400).json({ ok: false, message: 'Unknown action.' });
          return;
      }

      client.emit('dashboard:sync');
      res.json({ ok: true, payload: buildSyncPayload(client, database, selectedGuildId, viewer) });
    } catch (error) {
      log.error('player control error:', error);
      res.status(500).json({ ok: false, message: error.message || 'Player action failed.' });
    }
  }));

  function mayView(viewer) {
    return Boolean(viewer?.unrestricted || viewer?.capabilities?.view);
  }

  io.on('connection', async (socket) => {
    socket.data.requestedGuildId = socket.handshake.query?.guildId;

    const viewer = await refreshSocketViewer(socket);
    if (!viewer) return;

    if (!mayView(viewer)) return;

    const selectedGuildId = viewer.selectedGuildId;
    socket.emit('dashboard:sync', buildSyncPayload(client, database, selectedGuildId, viewer));

    if (viewer.capabilities.commands) {
      socket.emit('dashboard:commandLogs', selectedGuildId
        ? database.getCommandLogsByGuild(selectedGuildId, 50)
        : database.getCommandLogs().slice(0, 50));
    }
  });

  client.on('dashboard:sync', () => {
    eachViewer((socket, viewer) => {
      if (!mayView(viewer)) return;
      socket.emit('dashboard:sync', buildSyncPayload(client, database, viewer.selectedGuildId, viewer));
    }).catch((error) => log.warn('sync broadcast failed:', error.message || error));
  });

  client.on('dashboard:commandLogs', () => {
    eachViewer((socket, viewer) => {
      if (!viewer.capabilities?.commands) return;

      const selectedGuildId = viewer.selectedGuildId;
      socket.emit('dashboard:commandLogs', selectedGuildId
        ? database.getCommandLogsByGuild(selectedGuildId, 50)
        : database.getCommandLogs().slice(0, 50));
    }).catch((error) => log.warn('command log broadcast failed:', error.message || error));
  });

  client.on('dashboard:clearLogs', () => {
    eachViewer((socket, viewer) => {
      if (!viewer.capabilities?.transcripts) return;

      const selectedGuildId = viewer.selectedGuildId;
      socket.emit('dashboard:clearLogs', selectedGuildId
        ? database.getClearLogsByGuild(selectedGuildId)
        : database.getClearLogs());
    }).catch((error) => log.warn('clear log broadcast failed:', error.message || error));
  });

  app.use((error, req, res, _next) => {
    const status = Number(error?.status || error?.statusCode) || 500;

    if (status >= 500) {
      log.error(`Dashboard request failed (${req.method} ${req.path}):`, error?.message || error);
    }
    if (res.headersSent) return;

    if (req.path.startsWith('/api/')) {
      res.status(status).json({ ok: false, message: 'Κάτι έσπασε στο dashboard.' });
      return;
    }
    res.status(status).send('Κάτι έσπασε στο dashboard.');
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
