/**
 * Ελάχιστος logger με επίπεδα.
 *
 * Γιατί όχι pino: το συνηθισμένο επιχείρημα — «οι ασύγχρονες εγγραφές δεν
 * μπλοκάρουν το event loop κατά τη ροή ήχου» — δεν ισχύει κάτω από systemd.
 * Το stdout της Node είναι ασύγχρονο όταν καταλήγει σε pipe, και το journald
 * δίνει pipe. Το journald προσθέτει επίσης ήδη χρονοσήμανση, όνομα unit και
 * προτεραιότητα. Αυτό που έλειπε πραγματικά ήταν επίπεδα και ΕΝΑ σημείο
 * ελέγχου — 50 σκόρπια console.log δεν φιλτράρονται.
 *
 * Η αξία είναι η έμμεση αναφορά: αν κάποτε χρειαστείς JSON logs, αλλάζεις
 * μόνο αυτό το αρχείο.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function resolveLevel() {
  const explicit = String(process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (explicit in LEVELS) return LEVELS[explicit];
  // Παλιό συνώνυμο, διατηρημένο ώστε να μη σπάσει η συνήθειά σου.
  if (String(process.env.DEBUG_AUDIO || '0') !== '0') return LEVELS.debug;
  return LEVELS.info;
}

const activeLevel = resolveLevel();

// Το systemd ορίζει JOURNAL_STREAM όταν η έξοδος πάει στο journald, το οποίο
// βάζει δική του χρονοσήμανση. Διπλή χρονοσήμανση σε κάθε γραμμή είναι σκέτος
// θόρυβος, οπότε την παραλείπουμε εκεί.
const wantTimestamp = !process.env.JOURNAL_STREAM;

function emit(level, namespace, args) {
  if (LEVELS[level] > activeLevel) return;
  const prefix = [];
  if (wantTimestamp) prefix.push(new Date().toISOString());
  prefix.push(level.toUpperCase().padEnd(5));
  if (namespace) prefix.push(`[${namespace}]`);

  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  sink(prefix.join(' '), ...args);
}

/**
 * @param {string} [namespace] π.χ. 'idle-live' — εμφανίζεται σε κάθε γραμμή
 */
function createLogger(namespace) {
  return {
    error: (...args) => emit('error', namespace, args),
    warn: (...args) => emit('warn', namespace, args),
    info: (...args) => emit('info', namespace, args),
    debug: (...args) => emit('debug', namespace, args),
    /** true όταν το επίπεδο debug είναι ενεργό — για να αποφεύγεις ακριβά μηνύματα. */
    get isDebug() { return activeLevel >= LEVELS.debug; },
    /** Υπο-logger, π.χ. log.child('ffmpeg') -> [idle-live:ffmpeg] */
    child: (sub) => createLogger(namespace ? `${namespace}:${sub}` : sub)
  };
}

module.exports = createLogger;
module.exports.LEVELS = LEVELS;
module.exports.activeLevel = activeLevel;
