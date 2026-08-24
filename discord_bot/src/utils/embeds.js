const { EmbedBuilder } = require('discord.js');
const log = require('./logger')('embeds');
const { plainEmoji, emojiIconUrl } = require('./emojis');

function header(name, label) {
  const iconURL = emojiIconUrl(name);
  return iconURL ? { name: label, iconURL } : { name: `${plainEmoji(name)} ${label}` };
}

function buildNowPlayingEmbed({ title, url, author, duration, thumbnail, requestedBy }) {
  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setAuthor(header('bot_music', 'Παίζει τώρα'))
    .setDescription(`**[${title}](${url || '#'})**`)
    .addFields(
      { name: 'Καλλιτέχνης', value: author || 'Άγνωστος', inline: true },
      { name: 'Διάρκεια', value: duration || '--:--', inline: true },
      { name: 'Ζητήθηκε από', value: String(requestedBy || 'Άγνωστος'), inline: true }
    )
    .setTimestamp();
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

function linkedTitle(track) {
  return track?.url ? `**[${track.title}](${track.url})**` : `**${track?.title || 'Unknown'}**`;
}

function requesterName(requestedBy) {
  if (!requestedBy) return 'Άγνωστος';
  return requestedBy.username || requestedBy.tag || String(requestedBy);
}

function buildPlayReplyEmbed({ track, requestedBy }) {
  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setAuthor(header('bot_play', 'Ξεκίνησε'))
    .setDescription(linkedTitle(track))
    .addFields(
      { name: 'Καλλιτέχνης', value: track?.author || 'Άγνωστος', inline: true },
      { name: 'Διάρκεια', value: track?.duration || 'LIVE', inline: true }
    )
    .setFooter({ text: `Ζητήθηκε από ${requesterName(requestedBy)}` });

  if (track?.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

function createEmbedManager(client) {
  const inFlight = new Map();

  function serialize(guildId, task) {
    const previous = inFlight.get(guildId) || Promise.resolve();
    const next = previous.then(task, task);
    inFlight.set(guildId, next.then(() => {}, () => {}));
    return next;
  }

  async function updateMusicEmbed(guildId, channel, embed) {
    return serialize(guildId, () => updateMusicEmbedNow(guildId, channel, embed));
  }

  async function deleteMusicEmbed(guildId) {
    return serialize(guildId, () => deleteMusicEmbedNow(guildId));
  }

  async function updateMusicEmbedNow(guildId, channel, embed) {
    if (!channel || !guildId) return;
    const existing = client.musicEmbedByGuild.get(guildId);

    if (existing) {
      try {
        let msg = existing.msgObj;
        if (!msg) {
          const ch = existing.channelId === channel.id
            ? channel
            : (client.channels.cache.get(existing.channelId)
              || await client.channels.fetch(existing.channelId).catch(() => null));
          msg = ch ? await ch.messages.fetch(existing.messageId).catch(() => null) : null;
        }
        if (msg) {
          await msg.edit({ embeds: [embed] });
          existing.msgObj = msg;
          return;
        }
      } catch (error) {
        log.debug('Could not edit the now-playing embed:', error.message);
      }
      client.musicEmbedByGuild.delete(guildId);
    }

    try {
      const msg = await channel.send({ embeds: [embed] });
      client.musicEmbedByGuild.set(guildId, { channelId: channel.id, messageId: msg.id, msgObj: msg });
    } catch (error) {
      log.warn(`Could not post the now-playing embed in #${channel.name}:`, error.message);
    }
  }

  async function deleteMusicEmbedNow(guildId) {
    const embedInfo = client.musicEmbedByGuild.get(guildId);
    if (!embedInfo) return;
    try {
      let msg = embedInfo.msgObj;
      if (!msg) {
        const ch = client.channels.cache.get(embedInfo.channelId)
          || await client.channels.fetch(embedInfo.channelId).catch(() => null);
        msg = ch ? await ch.messages.fetch(embedInfo.messageId).catch(() => null) : null;
      }
      if (msg) await msg.delete().catch(() => {});
    } catch (error) {
      log.debug('Could not delete the now-playing embed:', error.message);
    }
    client.musicEmbedByGuild.delete(guildId);
  }

  return { updateMusicEmbed, deleteMusicEmbed };
}

module.exports = {
  buildNowPlayingEmbed,
  buildPlayReplyEmbed,
  createEmbedManager
};
