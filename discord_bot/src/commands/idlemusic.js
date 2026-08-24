const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { startIdleLive, isIdleLiveActive } = require('../idle-live');
const { emoji } = require('../utils/emojis');
const { PREFIX } = require('../prefix-commands');

const log = require('../utils/logger')('idlemusic');

function debugAudioLog(...parts) {
  log.debug(...parts);
}

module.exports = {
  category: 'Music',
  aliases: ['im', 'ιμ'],
  data: new SlashCommandBuilder()
    .setName('idlemusic')
    .setDescription('Βάλε το ράδιο να παίζει λούπα για να μην κοιμόμαστε.'),

  async execute(interaction, client) {
    debugAudioLog('idlemusic:command', `guild=${interaction.guildId || 'n/a'}`, `user=${interaction.user?.id || 'n/a'}`);

    if (!interaction.inGuild()) {
      await interaction.reply({ content: `${emoji('bot_warn')} Εδώ είναι DM! Έλα σε έναν server να τα πούμε.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({ content: `${emoji('bot_warn')} Πού είσαι; Μπες πρώτα σε ένα voice channel για να παίξω.`, flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await interaction.deferReply();
    } catch (error) {
      if (error?.code === 10062 || error?.code === 40060) {
        return;
      }
      throw error;
    }

    try {
      const existingQueue = client.player.nodes.get(interaction.guild.id);
      const currentTrack = existingQueue?.currentTrack;
      debugAudioLog(
        'idlemusic:queue-state-before',
        `hasQueue=${Boolean(existingQueue)}`,
        `hasConnection=${Boolean(existingQueue?.connection)}`,
        `current=${currentTrack?.title || 'none'}`
      );

      if (isIdleLiveActive(client, interaction.guild.id)) {
        await interaction.editReply(`${emoji('bot_radio')} Το ραδιόφωνο παίζει ήδη ρε φίλε! Κάτσε άκου.`);
        return;
      }

      if (existingQueue && (!existingQueue.connection || existingQueue.channel?.id !== voiceChannel.id)) {
        try {
          await existingQueue.connect(voiceChannel);
        } catch {
          await interaction.editReply(`${emoji('bot_error')} Έφαγα πόρτα. Δεν με αφήνουν να μπω στο κανάλι σου.`);
          return;
        }
      }

      const hasActivePlayback =
        Boolean(existingQueue?.currentTrack) ||
        Boolean(existingQueue?.isPlaying?.()) ||
        Number(existingQueue?.size || 0) > 0;
      if (hasActivePlayback) {
        await interaction.editReply(`${emoji('bot_warn')} Έχουμε ήδη κανονική μουσική. Πάτα \`/stop\` πρώτα αν θες το ραδιόφωνο.`);
        return;
      }

      const { track } = await startIdleLive(
        client,
        interaction.guild,
        voiceChannel,
        interaction.channel,
        interaction.user
      );
      client.autoIdleGuilds?.add(interaction.guild.id);
      debugAudioLog(
        'idlemusic:command-success',
        `title=${track?.title || 'n/a'}`,
        `author=${track?.author || 'n/a'}`,
        `duration=${track?.duration || 'n/a'}`,
        `url=${track?.url || 'n/a'}`
      );
      await interaction.editReply(`${emoji('bot_radio')} Ξεκινάω ζωντανή μετάδοση! Τώρα στον αέρα: **${track.title}**`);
    } catch (error) {
      log.error('idlemusic command error:', error);
      await interaction.editReply(`${emoji('bot_error')} Κάτι έσκασε. Δεν πήρε μπρος το ραδιόφωνο.`);
    }
  },

  async prefixExecute(message, argsText, client) {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      await message.reply(`${emoji('bot_warn')} Πού είσαι; Μπες πρώτα σε ένα voice channel για να παίξω.`);
      return;
    }

    if (isIdleLiveActive(client, message.guild.id)) {
      await message.reply(`${emoji('bot_radio')} Το ραδιόφωνο παίζει ήδη ρε φίλε! Κάτσε άκου.`);
      return;
    }

    const queue = client.player?.nodes?.get(message.guild.id) || null;
    if (queue && (!queue.connection || queue.channel?.id !== voiceChannel.id)) {
      try {
        await queue.connect(voiceChannel);
      } catch {
        await message.reply(`${emoji('bot_error')} Έφαγα πόρτα. Δεν με αφήνουν να μπω στο κανάλι σου.`);
        return;
      }
    }

    const hasActivePlayback =
      Boolean(queue?.currentTrack) ||
      Boolean(queue?.isPlaying?.()) ||
      Number(queue?.size || 0) > 0;
    if (hasActivePlayback) {
      await message.reply(`${emoji('bot_warn')} Έχουμε ήδη κανονική μουσική. Πάτα \`${PREFIX}stop\` πρώτα αν θες το ραδιόφωνο.`);
      return;
    }

    try {
      const { track } = await startIdleLive(
        client,
        message.guild,
        voiceChannel,
        message.channel,
        message.author,
      );
      client.autoIdleGuilds?.add(message.guild.id);
      await message.reply(`${emoji('bot_radio')} Ξεκινάω ζωντανή μετάδοση! Τώρα στον αέρα: **${track.title}**`);
      client.emit('dashboard:sync');
    } catch (error) {
      log.error('idlemusic prefix error:', error?.message || error);
      await message.reply(`${emoji('bot_error')} Κάτι έσκασε. Δεν πήρε μπρος το ραδιόφωνο.`);
    }
  }
};
