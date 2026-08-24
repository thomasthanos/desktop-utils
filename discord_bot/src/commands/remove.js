const { SlashCommandBuilder } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { defineCommand } = require('../utils/command-context');
const { getPlaybackState, musicGate } = require('../utils/music');
const { getIdlePendingList } = require('../idle-pending');

module.exports = {
  category: 'Music',
  aliases: ['rm', 'ρμ'],
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Σούταρε ένα τραγούδι από την ουρά που δεν σου αρέσει.')
    .addIntegerOption((option) =>
      option
        .setName('position')
        .setDescription('Αριθμός τραγουδιού για διαγραφή')
        .setRequired(true)
        .setMinValue(1)
    ),

  ...defineCommand(async (ctx, client) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Αυτό δουλεύει μόνο μέσα σε server.');
    }

    const denied = musicGate(client, ctx);
    if (denied) return ctx.replyPrivate(denied);

    const raw = ctx.option('position');
    const position = Number.parseInt(raw, 10);
    if (!Number.isFinite(position) || position < 1) {
      return ctx.replyPrivate('Δώσε έναν αριθμό θέσης, π.χ. `3` — δες `/queue` για τη λίστα.');
    }

    const { queue, idleActive } = getPlaybackState(client, ctx.guildId);

    const index = position - 1;

    if (idleActive) {
      const pending = getIdlePendingList(client, ctx.guildId);
      if (!Array.isArray(pending) || pending.length === 0) {
        return ctx.replyPrivate('Η ουρά είναι άδεια.');
      }
      if (index >= pending.length) {
        return ctx.replyPrivate(`Η θέση ${position} δεν υπάρχει — η ουρά έχει ${pending.length} κομμάτι(α).`);
      }

      const [dropped] = pending.splice(index, 1);
      client.emit('dashboard:sync');
      return ctx.reply(
        `${emoji('bot_ok')} Έβγαλα το **${dropped?.title || dropped?.query || 'κομμάτι'}** από τη θέση ${position}.`
      );
    }

    const tracks = queue ? queue.tracks.toArray() : [];
    if (tracks.length === 0) {
      return ctx.replyPrivate('Η ουρά είναι άδεια.');
    }
    if (index >= tracks.length) {
      return ctx.replyPrivate(`Η θέση ${position} δεν υπάρχει — η ουρά έχει ${tracks.length} κομμάτι(α).`);
    }

    const target = tracks[index];
    const removed = queue.removeTrack(target);
    if (!removed) {
      return ctx.replyPrivate('Δεν μπόρεσα να το βγάλω από την ουρά. Δοκίμασε ξανά.');
    }

    client.emit('dashboard:sync');
    return ctx.reply(
      `${emoji('bot_ok')} Έβγαλα το **${removed.title || target?.title || 'κομμάτι'}** από τη θέση ${position}.`
    );
  })
};
