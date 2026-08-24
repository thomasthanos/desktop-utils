const { isIdleLiveActive, stopIdleLive, getIdleLiveSession } = require('../idle-live');
const { isVoiceEmpty, emptyGraceMs } = require('../utils/voice');
const { expectLeave, consumeExpected, clearExpected, recentExecutor } = require('../utils/voice-departure');
const { buildKickMessage, resolveComplaintChannel } = require('../utils/kick-message');
const { currentTrackFor } = require('../utils/now-playing');
const { emoji } = require('../utils/emojis');
const log = require('../utils/logger')('voice');

const CONFIRM_MS = 1500;
const COMPLAINT_COOLDOWN_MS = 30000;

function createEmptyChannelWatcher({ graceMs, stillEmpty, onEmpty }) {
  const timers = new Map();

  function cancel(guildId) {
    const timer = timers.get(guildId);
    if (!timer) return false;
    clearTimeout(timer);
    timers.delete(guildId);
    return true;
  }

  function evaluate(guildId, empty) {
    if (!empty) {
      if (cancel(guildId)) log.debug(`someone came back to ${guildId} — countdown cancelled`);
      return;
    }

    if (timers.has(guildId)) return;

    const timer = setTimeout(async () => {
      timers.delete(guildId);
      if (!stillEmpty(guildId)) return;
      try {
        await onEmpty(guildId);
      } catch (error) {
        log.error(`auto-leave failed for ${guildId}:`, error.message || error);
      }
    }, graceMs);

    timer.unref?.();
    timers.set(guildId, timer);
    log.debug(`${guildId} is empty — leaving in ${Math.round(graceMs / 1000)}s unless someone returns`);
  }

  return {
    evaluate,
    cancel,
    clearAll: () => {
      for (const guildId of [...timers.keys()]) cancel(guildId);
    },
    get pending() {
      return timers.size;
    }
  };
}

function createDepartureWatcher({ client, database, confirmMs = CONFIRM_MS }) {
  const pending = new Map();
  const lastComplaintAt = new Map();

  function currentChannelId(guildId) {
    return client.guilds?.cache?.get(guildId)?.members?.me?.voice?.channelId || null;
  }

  async function complain(guildId, kind, snapshot) {
    const executor = recentExecutor(client, guildId);
    const facts = {
      kind,
      guildId,
      channelName: snapshot.fromName || null,
      toChannelName: snapshot.toName || null,
      byName: executor?.displayName || executor?.username || null,
      wasPlaying: snapshot.wasPlaying,
      trackTitle: snapshot.trackTitle
    };

    const channel = await resolveComplaintChannel(client, guildId, database, snapshot.fallbackChannels);
    if (!channel) {
      log.info(`${kind} in ${guildId} — no channel available to complain in`);
      return false;
    }

    const content = await buildKickMessage(facts, database);
    await channel.send({ content, allowedMentions: { parse: [] } });
    log.info(`${kind} in ${guildId} — complained in #${channel.name}`);
    return true;
  }

  function schedule(guildId, snapshot) {
    const existing = pending.get(guildId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      pending.delete(guildId);

      if (client.shuttingDown) return;

      const nowChannelId = currentChannelId(guildId);
      const kind = nowChannelId ? 'move' : 'kick';

      if (nowChannelId && nowChannelId === snapshot.from) return;

      if (consumeExpected(client, guildId)) {
        log.debug(`${guildId} left voice on purpose — no complaint`);
        return;
      }

      const last = lastComplaintAt.get(guildId) || 0;
      if (Date.now() - last < COMPLAINT_COOLDOWN_MS) {
        log.debug(`${guildId} complained recently — staying quiet`);
        return;
      }
      lastComplaintAt.set(guildId, Date.now());

      try {
        await complain(guildId, kind, {
          ...snapshot,
          toName: nowChannelId === snapshot.to
            ? snapshot.toName
            : client.guilds?.cache?.get(guildId)?.channels?.cache?.get(nowChannelId)?.name || null
        });
      } catch (error) {
        log.warn(`could not complain about ${kind} in ${guildId}:`, error.message || error);
      }
    }, confirmMs);

    timer.unref?.();
    pending.set(guildId, timer);
  }

  function onVoiceStateUpdate(oldState, newState) {
    const botId = client.user?.id;
    if (!botId) return;
    if ((newState?.id || oldState?.id) !== botId) return;

    const guildId = newState?.guild?.id || oldState?.guild?.id;
    if (!guildId) return;

    const from = oldState?.channelId || null;
    const to = newState?.channelId || null;

    if (to && !from) {
      clearExpected(client, guildId);
      return;
    }

    if (!from || from === to) return;

    const queue = client.player?.nodes?.get(guildId) || null;
    const idleActive = isIdleLiveActive(client, guildId);

    const lastTrack = client.lastTrackByGuild?.get(guildId) || null;

    schedule(guildId, {
      from,
      to,
      fromName: oldState?.channel?.name || null,
      toName: newState?.channel?.name || null,
      wasPlaying: Boolean(queue?.currentTrack) || idleActive || Boolean(lastTrack),
      trackTitle: queue?.currentTrack?.title
        || lastTrack?.title
        || (idleActive ? currentTrackFor(client, guildId)?.title || null : null),
      fallbackChannels: [
        getIdleLiveSession(client, guildId)?.textChannel || null,
        queue?.metadata?.channel || null
      ]
    });
  }

  return {
    onVoiceStateUpdate,
    clearAll: () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
    get pending() {
      return pending.size;
    }
  };
}

function register({ client, database, embeds, sync }) {
  function botChannelOf(guildId) {
    const guild = client.guilds.cache.get(guildId);
    return guild?.members?.me?.voice?.channel || null;
  }

  function radioOwnsThisGuild(guildId) {
    if (database.getStay247(guildId)) return false;
    if (client.player?.nodes?.get(guildId)) return false;
    return isIdleLiveActive(client, guildId);
  }

  const watcher = createEmptyChannelWatcher({
    graceMs: emptyGraceMs(),
    stillEmpty: (guildId) => radioOwnsThisGuild(guildId) && isVoiceEmpty(botChannelOf(guildId)),
    onEmpty: async (guildId) => {
      const channel = botChannelOf(guildId);
      log.info(`Leaving empty voice channel in ${guildId} (radio)`);

      const textChannel = getIdleLiveSession(client, guildId)?.textChannel || null;
      expectLeave(client, guildId);
      await stopIdleLive(client, guildId);

      await embeds.deleteMusicEmbed(guildId).catch(() => {});

      const minutes = Math.round(emptyGraceMs() / 60000);
      await textChannel?.send(
        `${emoji('bot_leave')} Μείναμε μπακούρια στο **${channel?.name || 'κανάλι'}** για ${minutes} λεπτά, οπότε την έκανα.`
      ).catch(() => {});
    }
  });

  const departures = createDepartureWatcher({ client, database });

  function refresh(guildId) {
    if (!guildId) return;

    if (!radioOwnsThisGuild(guildId)) {
      watcher.cancel(guildId);
      return;
    }

    const channel = botChannelOf(guildId);
    if (!channel) {
      watcher.cancel(guildId);
      return;
    }

    watcher.evaluate(guildId, isVoiceEmpty(channel));
  }

  client.on('voiceStateUpdate', (oldState, newState) => {
    refresh(newState?.guild?.id || oldState?.guild?.id);
    departures.onVoiceStateUpdate(oldState, newState);

    if (oldState?.channelId !== newState?.channelId) sync?.emitDashboardSync?.();
  });

  client.voiceWatcher = {
    refresh,
    cancel: watcher.cancel,
    clearAll: () => {
      watcher.clearAll();
      departures.clearAll();
    }
  };
}

module.exports = { register, createEmptyChannelWatcher, createDepartureWatcher };
