const { isIdleLiveActive, getIdleLiveSession, toggleIdleLivePause } = require('../idle-live');
const { getIdlePendingList } = require('../idle-pending');

/**
 * Κοινές βοηθητικές για τις εντολές μουσικής.
 *
 * Το bot έχει ΔΥΟ πηγές αναπαραγωγής: την ουρά του discord-player (/play) και
 * τη ζωντανή συνεδρία του ραδιοφώνου (/idlemusic). Οι εντολές πρέπει να
 * χειρίζονται και τις δύο, αλλιώς π.χ. το /pause δουλεύει μόνο τη μισή ώρα.
 */

function getQueue(client, guildId) {
  return client.player?.nodes?.get(guildId) || null;
}

/**
 * Καθαρίζει μια ουρά του discord-player.
 *
 * Τα τρία βήματα ήταν αντιγραμμένα σε τρία σημεία, καθένα με τρία κενά
 * `catch {}`. Οι αποτυχίες εδώ είναι όντως αναμενόμενες — η ουρά μπορεί να έχει
 * ήδη καταστραφεί, η σύνδεση να έχει πέσει — αλλά «αναμενόμενη» δεν σημαίνει
 * «αόρατη»: σε επίπεδο debug φαίνονται, ώστε ένα σπασμένο /stop να μπορεί να
 * διαγνωστεί.
 */
function teardownQueue(queue, log) {
  if (!queue) return;
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

/**
 * Ενοποιημένη εικόνα του τι παίζει σε αυτό το guild.
 */
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

/** Λίστα των κομματιών που ακολουθούν, από όποια πηγή είναι ενεργή. */
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

/**
 * @param {boolean|null} desired true=παύση, false=συνέχεια, null=εναλλαγή
 * @returns {{ok: boolean, paused?: boolean, alreadyInState?: boolean}}
 */
function setPaused(client, guildId, desired = null) {
  const state = getPlaybackState(client, guildId);
  if (!state.hasAnything) return { ok: false };

  const target = desired === null ? !state.isPaused : desired;
  if (target === state.isPaused) {
    return { ok: true, paused: state.isPaused, alreadyInState: true };
  }

  if (state.idleActive) {
    // Το ραδιόφωνο εκθέτει μόνο εναλλαγή, αλλά ξέρουμε ήδη ότι η τρέχουσα
    // κατάσταση διαφέρει από τη ζητούμενη, οπότε η εναλλαγή είναι σωστή.
    const result = toggleIdleLivePause(client, guildId);
    return result ? { ok: true, paused: result.paused } : { ok: false };
  }

  if (target) state.queue.node.pause();
  else state.queue.node.resume();
  return { ok: true, paused: target };
}

/** ms -> "3:07" ή "1:02:33" */
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

/** Δέχεται "90", "1:30" ή "1m30s" και επιστρέφει χιλιοστά του δευτερολέπτου. */
function parseTimestamp(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) return Number(raw) * 1000;

  if (raw.includes(':')) {
    const parts = raw.split(':').map((p) => Number(p));
    if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
    const seconds = parts.reduce((acc, part) => acc * 60 + part, 0);
    return seconds * 1000;
  }

  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (match && (match[1] || match[2] || match[3])) {
    const [, h = 0, m = 0, s = 0] = match;
    return ((Number(h) * 3600) + (Number(m) * 60) + Number(s)) * 1000;
  }
  return null;
}

/** Οπτική μπάρα προόδου, π.χ. ▬▬▬🔘▬▬▬▬ */
function buildProgressBar(currentMs, totalMs, width = 18) {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return '🔴 LIVE';
  const ratio = Math.max(0, Math.min(1, currentMs / totalMs));
  const position = Math.round(ratio * (width - 1));
  return '▬'.repeat(position) + '🔘' + '▬'.repeat(width - 1 - position);
}

/** Μήκος κομματιού σε ms — το discord-player δίνει "3:07", όχι αριθμό. */
function trackDurationMs(track) {
  if (!track) return 0;
  if (Number.isFinite(track.durationMS)) return track.durationMS;
  const parts = String(track.duration || '').split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, part) => acc * 60 + part, 0) * 1000;
}

module.exports = {
  getQueue,
  teardownQueue,
  getPlaybackState,
  getUpcoming,
  setPaused,
  formatDuration,
  parseTimestamp,
  buildProgressBar,
  trackDurationMs
};
