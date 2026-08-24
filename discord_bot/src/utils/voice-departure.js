const DEFAULT_WINDOW_MS = 10000;
const EXECUTOR_WINDOW_MS = 5000;

function leaveRegistry(client) {
  if (!client.expectedVoiceLeave) client.expectedVoiceLeave = new Map();
  return client.expectedVoiceLeave;
}

function executorRegistry(client) {
  if (!client.lastVoiceExecutor) client.lastVoiceExecutor = new Map();
  return client.lastVoiceExecutor;
}

function expectLeave(client, guildId, ms = DEFAULT_WINDOW_MS) {
  if (!client || !guildId) return false;
  leaveRegistry(client).set(guildId, Date.now() + ms);
  return true;
}

function wasExpected(client, guildId, now = Date.now()) {
  if (!client || !guildId) return false;
  const until = leaveRegistry(client).get(guildId);
  if (!until) return false;
  if (until <= now) {
    leaveRegistry(client).delete(guildId);
    return false;
  }
  return true;
}

function consumeExpected(client, guildId, now = Date.now()) {
  const expected = wasExpected(client, guildId, now);
  if (expected) leaveRegistry(client).delete(guildId);
  return expected;
}

function clearExpected(client, guildId) {
  if (!client || !guildId) return;
  leaveRegistry(client).delete(guildId);
}

function rememberExecutor(client, guildId, executor, at = Date.now()) {
  if (!client || !guildId || !executor) return false;
  executorRegistry(client).set(guildId, { executor, at });
  return true;
}

function recentExecutor(client, guildId, now = Date.now(), windowMs = EXECUTOR_WINDOW_MS) {
  if (!client || !guildId) return null;
  const entry = executorRegistry(client).get(guildId);
  if (!entry) return null;
  if (now - entry.at > windowMs) return null;
  return entry.executor;
}

module.exports = {
  expectLeave,
  wasExpected,
  consumeExpected,
  clearExpected,
  rememberExecutor,
  recentExecutor,
  DEFAULT_WINDOW_MS,
  EXECUTOR_WINDOW_MS
};
