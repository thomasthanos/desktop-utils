const { callProvider, isEnabled } = require('./provider');
const { runAction } = require('./actions');
const { ALLOWED_ACTIONS } = require('./schema');
const log = require('../utils/logger')('ai');

/**
 * Ο ενορχηστρωτής: μνήμη, όρια, εφεδρεία.
 *
 * ΙΔΙΩΤΙΚΟΤΗΤΑ — ο κανόνας που δεν παραβιάζεται:
 * Ποτέ δεν στέλνεται περιεχόμενο από το `clear_logs.messages`. Είναι
 * αρχειοθετημένα ιδιωτικά μηνύματα άλλων ανθρώπων, που δεν έδωσαν τη
 * συγκατάθεσή τους σε τίποτα, και το δωρεάν tier της Google επιτρέπεται να
 * χρησιμοποιεί ό,τι λαμβάνει για εκπαίδευση. Οι συνόψεις χτίζονται μόνο από
 * συγκεντρωτικά: μετρητές εντολών, στατιστικά προσκλήσεων, κορυφαία τραγούδια.
 */

// --- Μνήμη συνομιλίας -------------------------------------------------------
//
// Καμία αποθήκευση σε βάση, επίτηδες: δεν χρειάζεται να επιβιώσει σε restart,
// και δεν θέλεις περιεχόμενο DM στα νυχτερινά backups.
//
// Χειρότερη περίπτωση: 200 × 8 × 500 = ~800 KB.

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

  // Έξωση της παλαιότερης συνεδρίας. Χωρίς αυτό, ένας server με πολλή κίνηση
  // μεγαλώνει το Map επ' άπειρον — αργή διαρροή μνήμης που φαίνεται μόνο μετά
  // από εβδομάδες uptime, δηλαδή ακριβώς όταν δεν την ψάχνεις.
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

// --- Όρια -------------------------------------------------------------------

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
  // Τοπική ημερομηνία, όχι UTC: το «σήμερα» πρέπει να αλλάζει τα μεσάνυχτά σου.
  const pad = (n) => String(n).padStart(2, '0');
  return `ai_calls_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function dailyBudget() {
  const raw = Number(process.env.AI_DAILY_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : 800;
}

/**
 * Ο ημερήσιος μετρητής ζει στη ΒΑΣΗ, όχι στη μνήμη.
 *
 * Ένας μετρητής στη μνήμη θα μηδενιζόταν σε κάθε deploy ή restart, ενώ η
 * πραγματική ποσόστωση της Google δεν μηδενίζεται μαζί του — δηλαδή θα έκαιγες
 * την πραγματική ποσόστωση νομίζοντας ότι είσαι εντός ορίου.
 */
function consumeDailyBudget(database) {
  const key = dailyBudgetKey();
  const used = Number(database.getStat(key) || 0);
  if (used >= dailyBudget()) return false;
  database.setStat(key, String(used + 1));
  return true;
}

// --- Εφεδρικός router λέξεων-κλειδιών ---------------------------------------
//
// Όταν τελειώσει η ποσόστωση, το bot μένει χρήσιμο στα ελληνικά με μηδέν quota.
// Καλεί τους ΙΔΙΟΥΣ εκτελεστές — ούτε αυτός έχει πρόσβαση στο επίπεδο 3.

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

// --- Δημόσια είσοδος --------------------------------------------------------

/**
 * @param {object} ctx σχήμα command-context (guildId, user, member, channel)
 * @param {string} text τι είπε ο χρήστης
 * @param {object} deps `fetch` και `now` ενίενται για τα τεστ
 * @returns {Promise<{text: string, action: string, usedAi: boolean}>}
 */
async function ask(ctx, text, client, database, deps = {}) {
  const userId = ctx.user?.id || 'unknown';
  const message = String(text || '').trim();

  if (!message) {
    return { text: 'Πες μου κάτι.', action: 'none', usedAi: false };
  }

  if (!withinUserLimit(userId)) {
    return { text: 'Πάμε λίγο πιο αργά — ξαναδοκίμασε σε λίγο.', action: 'none', usedAi: false };
  }

  // Διακόπτης πανικού: η κουβέντα συνεχίζει, καμία εντολή δεν εκτελείται.
  const actionsAllowed = String(process.env.AI_ALLOW_ACTIONS ?? '1') !== '0';

  let result = null;
  let usedAi = false;

  if (isEnabled() && consumeDailyBudget(database)) {
    remember(userId, 'user', message);
    result = await callProvider([...getHistory(userId)], deps);
    usedAi = result !== null;
  }

  // Χωρίς κλειδί, εξαντλημένη ποσόστωση, ή αποτυχία κλήσης.
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

  // Δεύτερος έλεγχος, ανεξάρτητος από το enum του σχήματος. Ένας πάροχος που
  // αγνοεί το responseSchema, ή μια απάντηση που δεν ήταν καν JSON, δεν πρέπει
  // να μπορεί να ονομάσει ενέργεια εκτός λίστας.
  let action = ALLOWED_ACTIONS.includes(result.action) ? result.action : 'none';
  if (!actionsAllowed && action !== 'none') {
    log.info(`AI_ALLOW_ACTIONS=0 — refused action "${action}"`);
    action = 'none';
  }

  const outcome = await runAction(action, ctx, client, database, {
    query: result.query,
    value: result.value
  });

  // Οι εκτελεστές επιστρέφουν είτε κείμενο είτε `{text, embed}` — το δεύτερο
  // όταν έχουν κάτι πιο πλούσιο να δείξουν από μια γραμμή.
  const actionText = typeof outcome === 'string' ? outcome : (outcome?.text || '');
  const actionEmbed = (outcome && typeof outcome === 'object') ? outcome.embed || null : null;

  // Το αποτέλεσμα της ενέργειας είναι ΑΥΘΕΝΤΙΚΟ και αντικαθιστά το κείμενο του
  // μοντέλου. Το μοντέλο γράφει την απάντησή του ΠΡΙΝ εκτελεστεί οτιδήποτε,
  // οπότε ενώνοντας τα δύο έβγαινε «Βάζω αμέσως το Mad Clip!» ακολουθούμενο
  // από «Αυτό δουλεύει μόνο μέσα σε server» — υπόσχεση και διάψευση μαζί.
  // Όταν κάτι όντως έτρεξε, αυτό που έγινε είναι η μόνη απάντηση που μετράει.
  //
  // Με embed δεν μπαίνει καθόλου κείμενο: το embed τα λέει όλα, και μια γραμμή
  // από πάνω που λέει το ίδιο είναι ακριβώς η επανάληψη που θέλουμε να φύγει.
  const finalText = actionEmbed ? '' : (actionText || result.reply || 'Εντάξει.');

  if (usedAi) remember(userId, 'assistant', finalText || result.reply || 'ok');
  return { text: finalText.slice(0, 1900), embed: actionEmbed, action, usedAi };
}

module.exports = {
  ask,
  isEnabled,
  keywordRoute,
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
