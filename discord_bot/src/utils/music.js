const { isIdleLiveActive, getIdleLiveSession, toggleIdleLivePause } = require('../idle-live');
const { getIdlePendingList } = require('../idle-pending');
const { expectLeave } = require('./voice-departure');
const { canControlMusic } = require('./voice');
const { emoji } = require('./emojis');

function musicGate(client, ctx) {
  const gate = canControlMusic(client, ctx?.guildId || null, ctx?.user?.id || null);
  if (gate.ok) return null;
  return `${emoji('bot_warn')} ${gate.message}`;
}

function getQueue(client, guildId) {
  return client.player?.nodes?.get(guildId) || null;
}

function teardownQueue(queue, log) {
  if (!queue) return;

  const guild = queue.guild || null;
  if (guild?.client && guild?.id) expectLeave(guild.client, guild.id);

  for (const [step, action] of [
    ['clear', () => queue.clear()],
    ['stop', () => queue.node.stop()],
    ['delete', () => queue.delete()]
  ]) {
    try {
      action();
    } catch (error) {
      log?.debug?.(`queue teardown: ${step} failed —`, error.message);
    }
  }
}

function getPlaybackState(client, guildId) {
  const queue = getQueue(client, guildId);
  const idleActive = isIdleLiveActive(client, guildId);
  return {
    queue,
    idleActive,
    hasAnything: Boolean(queue?.currentTrack) || idleActive,
    isPaused: idleActive
      ? Boolean(getIdleLiveSession(client, guildId)?.paused)
      : Boolean(queue?.node?.isPaused?.())
  };
}

function getUpcoming(client, guildId) {
  const { queue, idleActive } = getPlaybackState(client, guildId);
  if (idleActive) {
    return (getIdlePendingList(client, guildId) || []).map((item) => ({
      title: item.title || item.query || 'Unknown',
      author: item.author || null,
      duration: item.duration || null,
      url: item.url || null
    }));
  }
  const tracks = queue?.tracks?.data || [];
  return tracks.map((t) => ({
    title: t.title,
    author: t.author,
    duration: t.duration,
    url: t.url
  }));
}

function setPaused(client, guildId, desired = null) {
  const state = getPlaybackState(client, guildId);
  if (!state.hasAnything) return { ok: false };

  const target = desired === null ? !state.isPaused : desired;
  if (target === state.isPaused) {
    return { ok: true, paused: state.isPaused, alreadyInState: true };
  }

  if (state.idleActive) {
    const result = toggleIdleLivePause(client, guildId);
    return result ? { ok: true, paused: result.paused } : { ok: false };
  }

  if (target) state.queue.node.pause();
  else state.queue.node.resume();
  return { ok: true, paused: target };
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '--:--';
  const total = Math.floor(value / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}


function buildProgressBar(currentMs, totalMs, width = 18) {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 'LIVE';
  const ratio = Math.max(0, Math.min(1, currentMs / totalMs));
  const position = Math.round(ratio * (width - 1));
  return '▬'.repeat(position) + '🔘' + '▬'.repeat(width - 1 - position);
}

function trackDurationMs(track) {
  if (!track) return 0;
  if (Number.isFinite(track.durationMS)) return track.durationMS;
  const parts = String(track.duration || '').split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, part) => acc * 60 + part, 0) * 1000;
}

module.exports = {
  musicGate,
  getQueue,
  teardownQueue,
  getPlaybackState,
  getUpcoming,
  setPaused,
  formatDuration,
  buildProgressBar,
  trackDurationMs
};
