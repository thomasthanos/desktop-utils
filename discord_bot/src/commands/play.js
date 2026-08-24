const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { QueryType } = require('discord-player');
const { isIdleLiveActive } = require('../idle-live');
const { enqueueIdlePending, getIdlePendingCount } = require('../idle-pending');
const database = require('../database');
const { PREFIX } = require('../prefix-commands');
const { buildNodeOptions } = require('../utils/voice');
const { buildPlayReplyEmbed } = require('../utils/embeds');
const log = require('../utils/logger')('play');

function debugAudioLog(...parts) {
  log.debug(...parts);
}

async function resolveSpotifyToSearchQuery(url) {
  try {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint);
    if (!response.ok) return null;

    const data = await response.json();
    if (!data?.title || typeof data.title !== 'string') return null;

    const bySeparator = ' by ';
    const idx = data.title.toLowerCase().lastIndexOf(bySeparator);
    if (idx > 0) {
      const title = data.title.slice(0, idx).trim();
      const artist = data.title.slice(idx + bySeparator.length).trim();
      return `${title} ${artist}`.trim();
    }

    return data.title.trim();
  } catch {
    return null;
  }
}

function ensureVoiceQueue(message, client) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return null;

  let queue = client.player.nodes.get(message.guild.id);
  if (!queue) {
    queue = client.player.nodes.create(
      message.guild,
      buildNodeOptions(database, message.guild.id, { channel: message.channel })
    );
  } else {
    queue.metadata = { channel: message.channel };
  }

  if (!queue.connection || queue.channel?.id !== voiceChannel.id) {
    return queue.connect(voiceChannel).then(() => ({ queue, voiceChannel }));
  }

  return Promise.resolve({ queue, voiceChannel });
}

module.exports = {
  category: 'Music',
  aliases: ['p', 'π'],
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Βάλε μουσική να γουστάρουμε (YouTube, Spotify, κλπ).')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('URL τραγουδιού ή όρος αναζήτησης')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: `${emoji('bot_warn')} Μάστορα, αυτό δουλεύει μόνο μέσα σε server.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: `${emoji('bot_warn')} Μπες σε κανάλι φωνής πρώτα, να ξέρω πού να παίξω!`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const query = interaction.options.getString('query', true);
    const looksLikeUrl = /^https?:\/\//i.test(query);
    const isSpotifyUrl = /open\.spotify\.com\/(track|album|playlist)\//i.test(query);

    let effectiveQuery = query;
    if (isSpotifyUrl) {
      const mapped = await resolveSpotifyToSearchQuery(query);
      if (mapped) effectiveQuery = mapped;
    }

    client.autoIdleGuilds?.delete(interaction.guildId);

    if (isIdleLiveActive(client, interaction.guildId)) {
      const searchEngine = isSpotifyUrl
        ? QueryType.YOUTUBE_SEARCH
        : (looksLikeUrl ? QueryType.AUTO : QueryType.YOUTUBE_SEARCH);
      await enqueueIdlePending(client, interaction.guildId, {
        query: effectiveQuery,
        searchEngine,
        requestedBy: interaction.user,
        textChannel: interaction.channel
      });
      const pending = getIdlePendingCount(client, interaction.guildId);
      debugAudioLog(
        'play:queued-during-idle',
        `guild=${interaction.guildId}`,
        `pending=${pending}`,
        `query=${effectiveQuery.slice(0, 80)}`
      );
      await interaction.reply({
        content: `${emoji('bot_radio')} Το ράδιο είναι στον αέρα! Το κομμάτι μπήκε στην αναμονή: **${pending}**. Θα παίξει μόλις του κάνεις ένα skip.`,
        flags: MessageFlags.Ephemeral
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
      return;
    }

    await interaction.deferReply();

    const playOptions = {
      requestedBy: interaction.user,
      searchEngine: isSpotifyUrl
        ? QueryType.YOUTUBE_SEARCH
        : (looksLikeUrl ? QueryType.AUTO : QueryType.YOUTUBE_SEARCH),
      fallbackSearchEngine: QueryType.YOUTUBE_SEARCH,
      nodeOptions: buildNodeOptions(database, interaction.guildId, { channel: interaction.channel })
    };

    try {
      const { track } = await client.player.play(voiceChannel, effectiveQuery, playOptions);
      await interaction.editReply({
        embeds: [buildPlayReplyEmbed({ track, requestedBy: interaction.user })]
      });
    } catch (error) {
      log.error('play primary attempt failed:', error.message || error);
      try {
        const { track } = await client.player.play(voiceChannel, effectiveQuery, {
          ...playOptions,
          searchEngine: QueryType.YOUTUBE_SEARCH
        });
        await interaction.editReply({
          embeds: [buildPlayReplyEmbed({ track, requestedBy: interaction.user })]
        });
      } catch (fallbackError) {
        log.error('play fallback failed:', fallbackError.message || fallbackError);
        await interaction.editReply(`${emoji('bot_error')} Τζίφος! Δε βρήκα τίποτα. Μήπως έγραψες κάτι λάθος;`);
      }
    }
  },

  async prefixExecute(message, argsText, client) {
    if (!argsText) {
      await message.reply(`Πώς το τρέχεις ρε φιλαράκι; Έτσι: \`${PREFIX}play <τραγούδι>\` (ή \`${PREFIX}p\`)`);
      return;
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      await message.reply(`${emoji('bot_warn')} Μπες πρώτα σε κανάλι φωνής — στο κενό δεν παίζω.`);
      return;
    }

    const query = argsText;
    const looksLikeUrl = /^https?:\/\//i.test(query);
    const isSpotifyUrl = /open\.spotify\.com\/(track|album|playlist)\//i.test(query);
    let effectiveQuery = query;
    if (isSpotifyUrl) {
      const mapped = await resolveSpotifyToSearchQuery(query);
      if (mapped) effectiveQuery = mapped;
    }

    client.autoIdleGuilds?.delete(message.guild.id);

    if (isIdleLiveActive(client, message.guild.id)) {
      const searchEngine = isSpotifyUrl
        ? QueryType.YOUTUBE_SEARCH
        : (looksLikeUrl ? QueryType.AUTO : QueryType.YOUTUBE_SEARCH);
      await enqueueIdlePending(client, message.guild.id, {
        query: effectiveQuery,
        searchEngine,
        requestedBy: message.author,
        textChannel: message.channel
      });
      const pending = getIdlePendingCount(client, message.guild.id);
      const replyMsg = await message.reply(`${emoji('bot_radio')} Το ράδιο είναι στον αέρα! Το κομμάτι μπήκε στην αναμονή: **${pending}**. Θα παίξει μόλις του κάνεις ένα skip.`);
      setTimeout(() => replyMsg.delete().catch(() => {}), 8000);
      return;
    }

    const result = await ensureVoiceQueue(message, client);
    if (!result) {
      await message.reply(`${emoji('bot_warn')} Μπες πρώτα σε κανάλι φωνής — στο κενό δεν παίζω.`);
      return;
    }

    const playOptions = {
      requestedBy: message.author,
      searchEngine: isSpotifyUrl
        ? QueryType.YOUTUBE_SEARCH
        : (looksLikeUrl ? QueryType.AUTO : QueryType.YOUTUBE_SEARCH),
      fallbackSearchEngine: QueryType.YOUTUBE_SEARCH,
      nodeOptions: buildNodeOptions(database, message.guild.id, { channel: message.channel })
    };

    try {
      const { track } = await client.player.play(result.voiceChannel, effectiveQuery, playOptions);
      await message.reply({ embeds: [buildPlayReplyEmbed({ track, requestedBy: message.author })] });
    } catch (error) {
      log.error('prefix play primary failed:', error.message || error);
      try {
        const { track } = await client.player.play(result.voiceChannel, effectiveQuery, {
          ...playOptions,
          searchEngine: QueryType.YOUTUBE_SEARCH
        });
        await message.reply({ embeds: [buildPlayReplyEmbed({ track, requestedBy: message.author })] });
      } catch {
        await message.reply(`${emoji('bot_error')} Τζίφος! Δε βρήκα τίποτα φίλε μου.`);
      }
    }

    client.emit('dashboard:sync');
  }
};
