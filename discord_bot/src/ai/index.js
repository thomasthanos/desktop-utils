const { callProvider, isEnabled } = require('./provider');
const { runAction } = require('./actions');
const { ALLOWED_ACTIONS } = require('./schema');
const { getPlaybackState, getUpcoming } = require('../utils/music');
const log = require('../utils/logger')('ai');

const MAX_TURNS = 8;
const MAX_CHARS = 500;
const MAX_SESSIONS = 200;
const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map();

function getHistory(userId) {
  const session = sessions.get(userId);
  if (!session) return [];
  if (Date.now() - session.touched > SESSION_TTL_MS) {
    sessions.delete(userId);
    return [];
  }
  return session.turns;
}

function remember(userId, role, content) {
  const turns = getHistory(userId);
  turns.push({ role, content: String(content).slice(0, MAX_CHARS) });
  while (turns.length > MAX_TURNS) turns.shift();
  sessions.set(userId, { turns, touched: Date.now() });

  if (sessions.size > MAX_SESSIONS) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [key, value] of sessions) {
      if (value.touched < oldest) { oldest = value.touched; oldestKey = key; }
    }
    if (oldestKey) sessions.delete(oldestKey);
  }
}

function forget(userId) {
  return sessions.delete(userId);
}

const USER_WINDOW_MS = 60 * 1000;
const USER_MAX_PER_WINDOW = 5;
const userHits = new Map();

function withinUserLimit(userId) {
  const now = Date.now();
  const hits = (userHits.get(userId) || []).filter((t) => now - t < USER_WINDOW_MS);
  if (hits.length >= USER_MAX_PER_WINDOW) return false;
  hits.push(now);
  userHits.set(userId, hits);
  return true;
}

function dailyBudgetKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `ai_calls_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function dailyBudget() {
  const raw = Number(process.env.AI_DAILY_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : 800;
}

function consumeDailyBudget(database) {
  const key = dailyBudgetKey();
  const used = Number(database.getStat(key) || 0);
  if (used >= dailyBudget()) return false;
  database.setStat(key, String(used + 1));
  return true;
}

const KEYWORD_ROUTES = [
  { test: /(παιξ|παίξ|βαλ|βάλ|play)\s+(.+)/i, action: 'play', capture: 2 },
  { test: /(σταματ|σταμάτ|stop)/i, action: 'stop' },
  { test: /(παυσ|παύσ|pause)/i, action: 'pause' },
  { test: /(συνεχ|resume)/i, action: 'resume' },
  { test: /(επομεν|επόμεν|skip|προσπερ)/i, action: 'skip' },
  { test: /(ενταση|ένταση|volume)\D*(\d{1,3})/i, action: 'volume', value: 2 },
  { test: /(τι παιζ|τι παίζ|nowplaying|now playing)/i, action: 'nowplaying' },
  { test: /(ουρα|ουρά|queue|λιστα|λίστα)/i, action: 'queue' },
  { test: /(στατιστ|stats)/i, action: 'stats' },
  { test: /(βοηθ|help|εντολ)/i, action: 'help' }
];

function keywordRoute(text) {
  const input = String(text || '');
  for (const route of KEYWORD_ROUTES) {
    const match = input.match(route.test);
    if (!match) continue;
    return {
      action: route.action,
      query: route.capture ? String(match[route.capture] || '').trim() : '',
      value: route.value ? Number(match[route.value]) : 0,
      reply: ''
    };
  }
  return null;
}

function playbackContext(ctx, client) {
  const header = 'ΠΡΑΓΜΑΤΙΚΗ ΚΑΤΑΣΤΑΣΗ (γεγονότα, όχι υπόθεση):';

  if (!ctx?.guildId) {
    return `${header}\n- Ο χρήστης δεν είναι σε server, οπότε δεν παίζει τίποτα.`;
  }

  try {
    const { queue, idleActive, isPaused } = getPlaybackState(client, ctx.guildId);
    const upcoming = getUpcoming(client, ctx.guildId) || [];

    let now;
    if (idleActive) now = 'το ραδιόφωνο (συνεχής ζωντανή ροή)';
    else if (queue?.currentTrack) {
      const track = queue.currentTrack;
      now = `«${track.title}»${track.author ? ` του ${track.author}` : ''}`;
    } else now = 'ΤΙΠΟΤΑ — το κανάλι είναι σιωπηλό';

    return [
      header,
      `- Τώρα παίζει: ${now}`,
      `- Σε παύση: ${isPaused ? 'ναι' : 'όχι'}`,
      `- Κομμάτια στην ουρά: ${upcoming.length}`
    ].join('\n');
  } catch (error) {
    log.warn('Could not read playback state for the AI context:', error.message || error);
    return '';
  }
}

async function ask(ctx, text, client, database, deps = {}) {
  const userId = ctx.user?.id || 'unknown';
  const message = String(text || '').trim();

  if (!message) {
    return { text: 'Πες μου κάτι.', action: 'none', usedAi: false };
  }

  if (!withinUserLimit(userId)) {
    return { text: 'Πάμε λίγο πιο αργά — ξαναδοκίμασε σε λίγο.', action: 'none', usedAi: false };
  }

  const actionsAllowed = String(process.env.AI_ALLOW_ACTIONS ?? '1') !== '0';

  let result = null;
  let usedAi = false;

  if (isEnabled() && consumeDailyBudget(database)) {
    remember(userId, 'user', message);
    result = await callProvider([...getHistory(userId)], deps, playbackContext(ctx, client));
    usedAi = result !== null;
  }

  if (!result) {
    const routed = keywordRoute(message);
    if (!routed) {
      return {
        text: isEnabled()
          ? 'Δεν μπορώ να απαντήσω τώρα. Δοκίμασε `/help` για τις εντολές.'
          : 'Δεν κατάλαβα. Γράψε `/help` για τη λίστα εντολών.',
        action: 'none',
        usedAi: false
      };
    }
    result = routed;
  }

  let action = ALLOWED_ACTIONS.includes(result.action) ? result.action : 'none';
  if (!actionsAllowed && action !== 'none') {
    log.info(`AI_ALLOW_ACTIONS=0 — refused action "${action}"`);
    action = 'none';
  }

  const outcome = await runAction(action, ctx, client, database, {
    query: result.query,
    value: result.value
  });

  const actionText = typeof outcome === 'string' ? outcome : (outcome?.text || '');
  const actionEmbed = (outcome && typeof outcome === 'object') ? outcome.embed || null : null;

  const finalText = actionEmbed ? '' : (actionText || result.reply || 'Εντάξει.');

  if (usedAi) remember(userId, 'assistant', finalText || result.reply || 'ok');
  return { text: finalText.slice(0, 1900), embed: actionEmbed, action, usedAi };
}

module.exports = {
  ask,
  isEnabled,
  keywordRoute,
  playbackContext,
  getHistory,
  remember,
  forget,
  dailyBudgetKey,
  dailyBudget,
  consumeDailyBudget,
  MAX_TURNS,
  MAX_SESSIONS,
  SESSION_TTL_MS
};
