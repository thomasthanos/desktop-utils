const crypto = require('crypto');

const { getBotOwnerIds } = require('../utils/authorization');
const log = require('../utils/logger')('dashboard');
const COOKIE_NAME = 'dash_session';
const STATE_COOKIE = 'dash_oauth_state';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_SEC = 600;
const OAUTH_TIMEOUT_MS = 8000;

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_AUTHORIZE = 'https://discord.com/oauth2/authorize';

const PASSWORD = process.env.DASHBOARD_PASSWORD || '';

const SECRET = process.env.DASHBOARD_SECRET || crypto.randomBytes(32).toString('hex');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hmac(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createToken(session = {}) {
  const payload = b64url(JSON.stringify({
    exp: Date.now() + SESSION_TTL_MS,
    uid: session.uid || null,
    tag: session.tag || null
  }));
  return `${payload}.${hmac(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = hmac(payload);

  if (signature.length !== expected.length || !safeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof parsed?.exp !== 'number' || Date.now() >= parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function appendCookie(res, value) {
  const previous = res.getHeader('Set-Cookie');
  const list = previous ? (Array.isArray(previous) ? [...previous] : [previous]) : [];
  list.push(value);
  res.setHeader('Set-Cookie', list);
}

function cookieIsSecure() {
  return String(process.env.DASHBOARD_COOKIE_SECURE || '1') !== '0';
}

function buildCookie(name, value, maxAgeSec, sameSite = 'Lax') {
  const attrs = [
    `${name}=${value}`,
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`
  ];
  if (cookieIsSecure()) attrs.push('Secure');
  return attrs.join('; ');
}

function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  sweep.unref();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests', retryAfter });
    }
    return next();
  };
}

function isLoopback(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function dashboardBaseUrl() {
  let raw = String(process.env.DASHBOARD_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  while (raw.endsWith('/')) raw = raw.slice(0, -1);
  return raw;
}

function allowedUserIds() {
  const extra = String(process.env.DASHBOARD_ALLOWED_USERS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set([...getBotOwnerIds(), ...extra])];
}

function oauthConfig() {
  const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;

  const base = dashboardBaseUrl();
  if (!base) return null;

  if (allowedUserIds().length === 0) return null;

  return { clientId, clientSecret, redirectUri: `${base}/auth/discord/callback` };
}

function authorizeUrl(state) {
  const config = oauthConfig();
  if (!config) return null;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'identify',
    state
  });
  return `${DISCORD_AUTHORIZE}?${params.toString()}`;
}

async function exchangeCode(code, deps = {}) {
  const config = oauthConfig();
  if (!config || !code) return null;

  const doFetch = deps.fetch || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);

  try {
    const tokenResponse = await doFetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri
      }).toString(),
      signal: controller.signal
    });

    if (!tokenResponse.ok) {
      log.warn(`OAuth token exchange failed with HTTP ${tokenResponse.status}`);
      return null;
    }

    const token = await tokenResponse.json();
    if (!token?.access_token) return null;

    const userResponse = await doFetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `${token.token_type || 'Bearer'} ${token.access_token}` },
      signal: controller.signal
    });

    if (!userResponse.ok) {
      log.warn(`OAuth identity lookup failed with HTTP ${userResponse.status}`);
      return null;
    }

    const user = await userResponse.json();
    if (!user?.id) return null;

    return { uid: String(user.id), tag: user.global_name || user.username || String(user.id) };
  } catch (error) {
    log.warn('OAuth exchange aborted:', error.name === 'AbortError' ? 'timeout' : error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function createAuth(host) {
  const passwordEnabled = Boolean(PASSWORD);
  const oauth = oauthConfig();
  const oauthEnabled = Boolean(oauth);
  const enabled = passwordEnabled || oauthEnabled;

  if (!enabled && !isLoopback(host)) {
    throw new Error(
      `Refusing to start: DASHBOARD_HOST is ${host} (network-reachable) but neither DASHBOARD_PASSWORD `
      + 'nor Discord OAuth is configured. Set one, or bind to 127.0.0.1 and reach it through a tunnel.'
    );
  }

  if (!enabled) {
    log.warn('No dashboard authentication configured — access is OPEN (loopback only).');
  } else if (!process.env.DASHBOARD_SECRET) {
    log.warn('DASHBOARD_SECRET is not set — using a random key; sessions end on restart.');
  }

  if (!oauthEnabled && process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
    if (allowedUserIds().length === 0) {
      log.error(
        'Discord OAuth is configured but no account is allowed in — set BOT_OWNER_ID or DASHBOARD_ALLOWED_USERS. '
        + 'Refusing to enable it, because otherwise any Discord account could sign in.'
      );
    } else if (!dashboardBaseUrl()) {
      log.error('Discord OAuth is configured but DASHBOARD_URL is missing or invalid — refusing to enable it.');
    }
  }

  if (oauthEnabled) {
    log.info(`Discord login enabled for ${allowedUserIds().length} account(s). Redirect URI: ${oauth.redirectUri}`);
  }

  function readSession(req) {
    if (!enabled) return { uid: null, tag: null, open: true };
    return verifyToken(parseCookies(req.headers?.cookie)[COOKIE_NAME]);
  }

  function isAuthenticated(req) {
    return Boolean(readSession(req));
  }

  function sessionUser(req) {
    const session = readSession(req);
    if (!session?.uid) return null;
    return { uid: session.uid, tag: session.tag || null };
  }

  function requireAuth(req, res, next) {
    if (isAuthenticated(req)) return next();

    if (req.path.startsWith('/api/') || req.xhr) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/')}`);
  }

  function verifySocket(socket, next) {
    if (!enabled) return next();
    const session = verifyToken(parseCookies(socket.handshake?.headers?.cookie)[COOKIE_NAME]);
    if (!session) return next(new Error('unauthorized'));
    socket.data.userId = session.uid || null;
    // Ένα socket ζει πολύ περισσότερο από ένα request· χωρίς αυτό η συνεδρία
    // δεν ξαναελεγχόταν ποτέ μετά τη χειραψία.
    socket.data.expiresAt = Number(session.exp) || null;
    return next();
  }

  function allowRequest(req, callback) {
    const origin = req.headers?.origin;
    if (!origin) return callback(null, true);
    const allowed = (process.env.DASHBOARD_ORIGINS || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length === 0) {
      return callback(null, origin.endsWith(req.headers.host || ''));
    }
    return callback(null, allowed.includes(origin));
  }

  function issueSession(res, session = {}) {
    appendCookie(res, buildCookie(COOKIE_NAME, createToken(session), Math.floor(SESSION_TTL_MS / 1000)));
  }

  function clearSession(res) {
    appendCookie(res, buildCookie(COOKIE_NAME, '', 0));
  }

  function issueState(res) {
    const state = crypto.randomBytes(16).toString('base64url');
    appendCookie(res, buildCookie(STATE_COOKIE, state, STATE_TTL_SEC, 'Lax'));
    return state;
  }

  function consumeState(req, res, candidate) {
    appendCookie(res, buildCookie(STATE_COOKIE, '', 0, 'Lax'));
    const stored = parseCookies(req.headers?.cookie)[STATE_COOKIE];
    if (!stored || typeof candidate !== 'string' || candidate.length === 0) return false;
    if (stored.length !== candidate.length) return false;
    return safeEqual(stored, candidate);
  }

  function checkPassword(candidate) {
    return passwordEnabled && typeof candidate === 'string' && candidate.length > 0 && safeEqual(candidate, PASSWORD);
  }

  function isAllowed(uid) {
    if (!uid) return false;
    return allowedUserIds().includes(String(uid));
  }

  return {
    enabled,
    passwordEnabled,
    oauthEnabled,
    requireAuth,
    isAuthenticated,
    sessionUser,
    verifySocket,
    allowRequest,
    issueSession,
    clearSession,
    issueState,
    consumeState,
    checkPassword,
    isAllowed,
    authorizeUrl,
    exchangeCode,
    createRateLimiter
  };
}

module.exports = { createAuth, createRateLimiter, COOKIE_NAME, STATE_COOKIE, verifyToken };
