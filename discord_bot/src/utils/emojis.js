const log = require('./logger')('emojis');

const FALLBACK = {
  bot_music: '🎵',
  bot_play: '▶️',
  bot_pause: '⏸️',
  bot_stop: '⏹️',
  bot_skip: '⏭️',
  bot_prev: '◀️',
  bot_loop: '🔁',
  bot_shuffle: '🔀',
  bot_volume: '🔊',
  bot_radio: '📻',
  bot_queue: '📜',
  bot_mod: '🛡️',
  bot_invites: '📨',
  bot_admin: '⚙️',
  bot_general: '📋',
  bot_stats: '📊',
  bot_ok: '✅',
  bot_error: '❌',
  bot_warn: '⚠️',
  bot_clear: '🧹',
  bot_timer: '⏱️',
  bot_trophy: '🏆',
  bot_clock: '🕐',
  bot_hi: '👋',
  bot_kick: '👢',
  bot_user: '👤',
  bot_join: '📥',
  bot_leave: '📤'
};

const ID_OVERRIDES = {};

const resolved = { ...FALLBACK };
const assets = {};

function emoji(name) {
  if (name in resolved) return resolved[name];
  log.warn(`Unknown emoji '${name}' — check the name against FALLBACK.`);
  return '';
}

function plainEmoji(name) {
  if (name in FALLBACK) return FALLBACK[name];
  log.warn(`Unknown emoji '${name}' — check the name against FALLBACK.`);
  return '';
}

function emojiIconUrl(name, size = 64) {
  const asset = assets[name];
  if (!asset?.id) return null;
  const ext = asset.animated ? 'gif' : 'png';
  return `https://cdn.discordapp.com/emojis/${asset.id}.${ext}?size=${size}`;
}

async function loadEmojis(client) {
  let byId = new Map();

  try {
    const uploaded = await client.application.emojis.fetch();
    byId = new Map([...uploaded.values()].map((item) => [item.id, item]));

    let matched = 0;
    for (const item of uploaded.values()) {
      if (!(item.name in FALLBACK)) continue;
      resolved[item.name] = item.toString();
      assets[item.name] = { id: item.id, animated: Boolean(item.animated) };
      matched++;
    }
    log.info(matched
      ? `${matched} application emoji matched by name.`
      : 'No application emoji matched by name.');
  } catch (error) {
    log.warn('Could not read the application emoji:', error.message);
  }

  const unresolved = [];
  for (const [name, id] of Object.entries(ID_OVERRIDES)) {
    const found = byId.get(id) || client.emojis.cache.get(id);
    if (found) {
      resolved[name] = found.toString();
      assets[name] = { id: found.id, animated: Boolean(found.animated) };
    }
    else unresolved.push(`${name}(${id})`);
  }
  if (unresolved.length) {
    log.warn(`Emoji IDs the bot cannot see: ${unresolved.join(', ')}`);
  }

  const stillUnicode = Object.keys(FALLBACK).filter((name) => resolved[name] === FALLBACK[name]);
  if (stillUnicode.length) log.info(`Still on unicode: ${stillUnicode.join(', ')}`);
  else log.info('Every emoji resolved to a custom one.');
}

module.exports = { emoji, plainEmoji, emojiIconUrl, loadEmojis, FALLBACK, ID_OVERRIDES };
