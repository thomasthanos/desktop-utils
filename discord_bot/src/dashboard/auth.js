const crypto = require('crypto');

const log = require('../utils/logger')('dashboard');
const COOKIE_NAME = 'dash_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PASSWORD = process.env.DASHBOARD_PASSWORD || '';

// Χωρίς ρητό μυστικό παράγουμε ένα τυχαίο ανά εκκίνηση: οι συνεδρίες δεν
// επιβιώνουν σε restart, αλλά ποτέ δεν υπάρχει προβλέψιμο κλειδί υπογραφής.
const SECRET = process.env.DASHBOARD_SECRET || crypto.randomBytes(32).toString('hex');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function hmac(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

/**
 * Σύγκριση σταθερού χρόνου. Το timingSafeEqual απαιτεί ίσα μήκη, οπότε
 * περνάμε και τα δύο από sha256 πρώτα — έτσι δεν διαρρέει ούτε το μήκος.
 */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function createToken() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS }));
  return `${payload}.${hmac(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = hmac(payload);
  // Ίσα μήκη ούτως ή άλλως, αλλά περνάμε από safeEqual για σταθερό χρόνο.
  if (signature.length !== expected.length || !safeEqual(signature, expected)) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
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

/**
 * Απλός περιοριστής ρυθμού σε μνήμη. Ένα πακέτο σαν το express-rate-limit θα
 * ήταν υπερβολή για dashboard ενός χρήστη πίσω από tunnel.
 */
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  // Περιοδικός καθαρισμός ώστε ο χάρτης να μη μεγαλώνει επ' αόριστον.
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

/**
 * @param {string} host η διεύθυνση στην οποία δένει το dashboard
 */
function createAuth(host) {
  const enabled = Boolean(PASSWORD);

  if (!enabled && !isLoopback(host)) {
    // Ο μόνος πραγματικά επικίνδυνος συνδυασμός: προσβάσιμο από το δίκτυο ΚΑΙ
    // χωρίς κωδικό. Το dashboard εκθέτει κάθε αρχειοθετημένο μήνυμα, κάθε
    // αποθηκευμένο αρχείο, διαγραφή log και πλήρη έλεγχο του player. Καλύτερα
    // να μη σηκωθεί καθόλου παρά να σηκωθεί ορθάνοιχτο.
    throw new Error(
      `Refusing to start: DASHBOARD_HOST is ${host} (network-reachable) but DASHBOARD_PASSWORD is not set. ` +
      'Set a password, or bind to 127.0.0.1 and reach it through a tunnel.'
    );
  }

  if (!enabled) {
    log.warn('DASHBOARD_PASSWORD is not set — authentication is DISABLED (loopback only).');
  } else if (!process.env.DASHBOARD_SECRET) {
    log.warn('DASHBOARD_SECRET is not set — using a random key; sessions end on restart.');
  }

  function isAuthenticated(req) {
    if (!enabled) return true;
    return verifyToken(parseCookies(req.headers?.cookie)[COOKIE_NAME]);
  }

  function requireAuth(req, res, next) {
    if (isAuthenticated(req)) return next();
    // Τα API επιστρέφουν 401· οι σελίδες ανακατευθύνουν στο login.
    if (req.path.startsWith('/api/') || req.xhr) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/')}`);
  }

  /**
   * Ο έλεγχος του socket.io είναι ξεχωριστός γιατί το WebSocket upgrade δεν
   * περνά από τα middleware του Express. (Αυτός είναι και ο λόγος που δεν
   * χρησιμοποιούμε Basic Auth: οι browsers δεν στέλνουν αποθηκευμένα
   * credentials Basic στο upgrade, ενώ τα cookies τα στέλνουν.)
   */
  function verifySocket(socket, next) {
    if (!enabled) return next();
    if (verifyToken(parseCookies(socket.handshake?.headers?.cookie)[COOKIE_NAME])) return next();
    return next(new Error('unauthorized'));
  }

  /**
   * Χωρίς έλεγχο Origin, οποιαδήποτε σελίδα στο internet μπορεί να ανοίξει
   * WebSocket προς το dashboard με το cookie σου να ταξιδεύει μαζί.
   */
  function allowRequest(req, callback) {
    const origin = req.headers?.origin;
    if (!origin) return callback(null, true); // μη-browser πελάτης, το cookie κρίνει
    const allowed = (process.env.DASHBOARD_ORIGINS || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length === 0) {
      // Default: ίδιο host με το αίτημα.
      return callback(null, origin.endsWith(req.headers.host || ''));
    }
    return callback(null, allowed.includes(origin));
  }

  function issueSession(res) {
    // Secure by default (το tunnel σερβίρει HTTPS). Απενεργοποιείται μόνο για
    // τοπική δοκιμή σε http, αλλιώς ο browser απορρίπτει σιωπηλά το cookie.
    const secure = String(process.env.DASHBOARD_COOKIE_SECURE || '1') !== '0';
    const attrs = [
      `${COOKIE_NAME}=${createToken()}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    ];
    if (secure) attrs.push('Secure');
    res.setHeader('Set-Cookie', attrs.join('; '));
  }

  function clearSession(res) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }

  function checkPassword(candidate) {
    return enabled && typeof candidate === 'string' && candidate.length > 0 && safeEqual(candidate, PASSWORD);
  }

  return {
    enabled,
    requireAuth,
    isAuthenticated,
    verifySocket,
    allowRequest,
    issueSession,
    clearSession,
    checkPassword,
    createRateLimiter
  };
}

module.exports = { createAuth, createRateLimiter, COOKIE_NAME };
