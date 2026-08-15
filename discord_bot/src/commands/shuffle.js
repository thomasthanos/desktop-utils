const { SlashCommandBuilder } = require('discord.js');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState } = require('../utils/music');
const { getIdlePendingList } = require('../idle-pending');

/** Fisher-Yates, επί τόπου. */
function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

module.exports = {
  category: 'Music',
  aliases: ['sh', 'mix', 'ση'],
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the upcoming tracks.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('This command works only inside servers.');
    }

    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);

    if (idleActive) {
      const pending = getIdlePendingList(client, ctx.guildId);
      if (!pending || pending.length < 2) {
        return ctx.replyPrivate('Need at least 2 pending tracks to shuffle.');
      }
      shuffleInPlace(pending);
      client.emit('dashboard:sync');
      return ctx.reply(`Shuffled ${pending.length} pending tracks.`);
    }

    const tracks = queue?.tracks?.data;
    if (!Array.isArray(tracks) || tracks.length < 2) {
      return ctx.replyPrivate('Need at least 2 tracks in the queue to shuffle.');
    }

    // Το discord-player εκθέτει queue.tracks.shuffle(), αλλά το ονομα άλλαξε
    // μεταξύ εκδόσεων· το in-place shuffle πάνω στον ίδιο πίνακα δουλεύει
    // ανεξάρτητα από έκδοση, όπως κάνει ήδη και το reorder του dashboard.
    shuffleInPlace(tracks);
    client.emit('dashboard:sync');
    return ctx.reply(`Shuffled ${tracks.length} tracks.`);
  })
};
