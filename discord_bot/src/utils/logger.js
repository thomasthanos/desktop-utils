const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function resolveLevel() {
  const explicit = String(process.env.LOG_LEVEL || '').trim().toLowerCase();
  if (explicit in LEVELS) return LEVELS[explicit];

  if (String(process.env.DEBUG_AUDIO || '0') !== '0') return LEVELS.debug;
  return LEVELS.info;
}

const activeLevel = resolveLevel();

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

function createLogger(namespace) {
  return {
    error: (...args) => emit('error', namespace, args),
    warn: (...args) => emit('warn', namespace, args),
    info: (...args) => emit('info', namespace, args),
    debug: (...args) => emit('debug', namespace, args),

    get isDebug() { return activeLevel >= LEVELS.debug; },

    child: (sub) => createLogger(namespace ? `${namespace}:${sub}` : sub)
  };
}

module.exports = createLogger;
module.exports.LEVELS = LEVELS;
module.exports.activeLevel = activeLevel;
