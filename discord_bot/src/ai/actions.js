const { QueryType } = require('discord-player');
const { getQueue, getPlaybackState, getUpcoming, setPaused, formatDuration, musicGate } = require('../utils/music');
const { buildNodeOptions, applyStay247 } = require('../utils/voice');
const { canManageAuthorization, roleIdsOf } = require('../utils/authorization');
const { buildNowPlayingEmbed } = require('../utils/embeds');
const { READ_ACTIONS, PLAYBACK_ACTIONS } = require('./schema');
const { emoji } = require('../utils/emojis');
const log = require('../utils/logger')('ai');

const NEEDS_GUILD = 'Δεν σε βρίσκω σε κανάλι φωνής. Μπες σε ένα και ξαναπές μου.';
const NOTHING_PLAYING = 'Δεν παίζει τίποτα αυτή τη στιγμή.';

function mayRunPlayback(ctx, database, commandName) {
  if (!ctx.guildId) return false;
  if (canManageAuthorization(ctx)) return true;
  if (!database.hasAuthorizedEntriesForCommand(ctx.guildId, commandName)) return true;
  return database.isAuthorizedPrincipal(ctx.guildId, commandName, ctx.user.id, roleIdsOf(ctx));
}

const EXECUTORS = {
  async nowplaying(ctx, client) {
    if (!ctx.guildId) return NEEDS_GUILD;
    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);
    if (idleActive) return `${emoji('bot_radio')} Παίζει το ραδιόφωνο ρε φίλε.`;
    const track = queue?.currentTrack;
    if (!track) return NOTHING_PLAYING;
    return `${emoji('bot_music')} Βαράει: **${track.title}** — ${track.author || 'άγνωστος'}`;
  },

  async queue(ctx, client) {
    if (!ctx.guildId) return NEEDS_GUILD;
    const upcoming = getUpcoming(client, ctx.guildId, 5);
    if (!upcoming.length) return 'Η ουρά είναι άδεια.';
    return `${emoji('bot_queue')} Τι ακολουθεί:\n${upcoming.map((t, i) => `${i + 1}. ${t.title}`).join('\n')}`;
  },

  async stats(ctx, client, database) {
    const total = database.getStat('total_commands') || '0';
    const guilds = client.guilds.cache.size;
    const uptime = formatDuration(Date.now() - Number(database.getStat('start_time') || Date.now()));
    return `${emoji('bot_stats')} Έχω βαρέσει ${total} εντολές σε ${guilds} server(s). Πιάνω βάρδια εδώ και ${uptime}.`;
  },

  async help() {
    return 'Γράψε `/help` για όλη τη λίστα εντολών.';
  },

  async play(ctx, client, database, args) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'play')) return 'Δεν έχεις δικαίωμα για το `/play` εδώ.';

    const voiceChannel = ctx.member?.voice?.channel;
    if (!voiceChannel) return 'Μπες πρώτα σε ένα κανάλι φωνής.';

    const query = String(args.query || '').trim();
    if (!query) return 'Πες μου τι να παίξω.';

    const fromDm = Boolean(ctx.channel?.isDMBased?.());

    const { track } = await client.player.play(voiceChannel, query, {
      requestedBy: ctx.user,
      searchEngine: QueryType.YOUTUBE_SEARCH,
      fallbackSearchEngine: QueryType.YOUTUBE_SEARCH,
      nodeOptions: buildNodeOptions(database, ctx.guildId, { channel: ctx.channel, quiet: fromDm })
    });

    return {
      text: '',
      embed: buildNowPlayingEmbed({
        title: track.title,
        url: track.url,
        author: track.author,
        duration: track.duration,
        thumbnail: track.thumbnail,
        requestedBy: ctx.user?.username || ctx.user?.tag || 'Unknown'
      })
    };
  },

  async pause(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'pause')) return 'Δεν έχεις δικαίωμα για το `/pause` εδώ.';
    const paused = setPaused(client, ctx.guildId, true);
    if (!paused.ok) return NOTHING_PLAYING;
    return paused.alreadyInState
      ? `${emoji('bot_pause')} Ήδη σε παύση.`
      : `${emoji('bot_pause')} Φρένο.`;
  },

  async resume(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'resume')) return 'Δεν έχεις δικαίωμα για το `/resume` εδώ.';
    const resumed = setPaused(client, ctx.guildId, false);
    if (!resumed.ok) return NOTHING_PLAYING;
    return resumed.alreadyInState
      ? `${emoji('bot_play')} Ήδη παίζει.`
      : `${emoji('bot_play')} Πάμε ξανά!`;
  },

  async skip(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'skip')) return 'Δεν έχεις δικαίωμα για το `/skip` εδώ.';
    const queue = getQueue(client, ctx.guildId);
    if (!queue?.currentTrack) return NOTHING_PLAYING;
    queue.node.skip();
    return `${emoji('bot_skip')} Επόμενο! Αυτό ήταν μάπα.`;
  },

  async stop(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'stop')) return 'Δεν έχεις δικαίωμα για το `/stop` εδώ.';
    const queue = getQueue(client, ctx.guildId);
    if (!queue) return NOTHING_PLAYING;
    queue.node.stop();
    return `${emoji('bot_stop')} Κομμένη η μουσική. Όλοι σπίτια τους.`;
  },

  async volume(ctx, client, database, args) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'volume')) return 'Δεν έχεις δικαίωμα για το `/volume` εδώ.';

    const level = Math.round(Number(args.value));
    if (!Number.isFinite(level) || level < 0 || level > 100) return 'Η ένταση είναι από 0 μέχρι 100.';

    database.setGuildVolume(ctx.guildId, level);
    getQueue(client, ctx.guildId)?.node?.setVolume(level);
    return `${emoji('bot_volume')} Ένταση στο ${level}%.`;
  },

  async loop(ctx, client, database) {
    if (!ctx.guildId) return NEEDS_GUILD;
    if (!mayRunPlayback(ctx, database, 'loop')) return 'Δεν έχεις δικαίωμα για το `/loop` εδώ.';
    return 'Για την επανάληψη τρέξε `/loop mode:track` ή `/loop mode:queue`.';
  },

  async stay247(ctx, client, database, args) {
    if (!ctx.guildId) return NEEDS_GUILD;

    if (!canManageAuthorization(ctx)) return 'Μόνο ο ιδιοκτήτης του server το αλλάζει αυτό.';

    const enabled = args.value !== 0;
    database.setStay247(ctx.guildId, enabled);
    applyStay247(client.player?.nodes?.get(ctx.guildId), enabled);
    client.voiceWatcher?.refresh(ctx.guildId);
    return enabled ? `${emoji('bot_loop')} Το 24/7 άναψε.` : `${emoji('bot_timer')} Το 24/7 έσβησε.`;
  }
};

async function runAction(name, ctx, client, database, args = {}) {
  if (!name || name === 'none') return null;

  const executor = Object.prototype.hasOwnProperty.call(EXECUTORS, name) ? EXECUTORS[name] : null;
  if (!executor) {
    log.warn(`AI asked for an action with no executor: ${String(name).slice(0, 40)}`);
    return null;
  }

  if (ctx.guildId && PLAYBACK_ACTIONS.includes(name)) {
    const denied = musicGate(client, ctx);
    if (denied) return denied;
  }

  try {
    return await executor(ctx, client, database, args);
  } catch (error) {
    log.error(`AI action ${name} failed:`, error.message || error);
    return 'Κάτι πήγε στραβά με αυτό.';
  }
}

module.exports = {
  runAction,
  mayRunPlayback,
  EXECUTOR_NAMES: Object.keys(EXECUTORS),
  READ_ACTIONS,
  PLAYBACK_ACTIONS
};
