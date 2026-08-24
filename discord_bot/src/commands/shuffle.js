const { SlashCommandBuilder } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState, musicGate } = require('../utils/music');
const { getIdlePendingList } = require('../idle-pending');

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
    .setDescription('Ανακάτεψε τα τραγούδια στην ουρά σαν τράπουλα.'),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Αυτό δουλεύει μόνο μέσα σε server.');
    }

    const denied = musicGate(client, ctx);
    if (denied) return ctx.replyPrivate(denied);

    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);

    if (idleActive) {
      const pending = getIdlePendingList(client, ctx.guildId);
      if (!pending || pending.length < 2) {
        return ctx.replyPrivate('Χρειάζονται τουλάχιστον 2 κομμάτια στην ουρά για ανακάτεμα.');
      }
      shuffleInPlace(pending);
      client.emit('dashboard:sync');
      return ctx.reply(`${emoji('bot_shuffle')} Ανακάτεψα ${pending.length} κομμάτια στην αναμονή. Καλή τύχη.`);
    }

    const size = Number(queue?.tracks?.size || 0);
    if (!queue || size < 2) {
      return ctx.replyPrivate('Χρειάζονται τουλάχιστον 2 κομμάτια στην ουρά για ανακάτεμα.');
    }

    queue.tracks.shuffle();
    client.emit('dashboard:sync');
    return ctx.reply(`${emoji('bot_shuffle')} Ανακάτεψα ${size} κομμάτια. Καλή τύχη.`);
  })
};
