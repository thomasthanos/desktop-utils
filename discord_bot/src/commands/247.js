const { SlashCommandBuilder } = require('discord.js');
const { emoji } = require('../utils/emojis');
const { musicGate } = require('../utils/music');
const { defineCommand } = require('../utils/command-context');
const { isGuildAdmin, isCommandAuthorized } = require('../utils/authorization');
const { applyStay247, emptyGraceMs } = require('../utils/voice');

const ON = new Set(['on', 'ναι', 'yes', 'true', '1', 'ενεργο', 'ενεργό']);
const OFF = new Set(['off', 'οχι', 'όχι', 'no', 'false', '0', 'ανενεργο', 'ανενεργό']);

module.exports = {
  category: 'Music',
  defaultAudience: 'Administrator',

  aliases: ['24-7', '24/7'],
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('Δες ή άλλαξε το 24/7 (για να μη φεύγω ποτέ). Το αλλάζουν οι διαχειριστές.')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Άσ\'το κενό για να δεις τι παίζει τώρα')
        .setRequired(false)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
    ),

  ...defineCommand(async (ctx, client, database) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Μάστορα, αυτό το κουμπί πατιέται μόνο μέσα σε server!');
    }

    const denied = musicGate(client, ctx);
    if (denied) return ctx.replyPrivate(denied);

    const current = database.getStay247(ctx.guildId);
    const raw = String(ctx.option('mode') || '').trim().toLowerCase();

    if (!raw) {
      const minutes = Math.round(emptyGraceMs() / 60000);
      return ctx.reply(
        current
          ? `${emoji('bot_loop')} Το 24/7 είναι **ενεργό**! Δεν το κουνάω ρούπι, εδώ θα ξημεροβραδιαστώ.`
          : `${emoji('bot_timer')} Το 24/7 είναι **ανενεργό**! Αν αδειάσει το κανάλι, σε ${minutes} λεπτά την κάνω με ελαφρά.`
      );
    }

    // Administrator πάντα, και όποιος έχει οριστεί ρητά για το /247.
    if (!isGuildAdmin(ctx) && !isCommandAuthorized(ctx, database, '247')) {
      return ctx.replyPrivate(
        'Στοπ! Το 24/7 το αλλάζουν οι διαχειριστές.\n'
        + '-# Ο ιδιοκτήτης μπορεί να το δώσει και σε άλλους με `/addauthorized`.'
      );
    }

    let enabled;
    if (ON.has(raw)) enabled = true;
    else if (OFF.has(raw)) enabled = false;
    else return ctx.replyPrivate('Τι γλώσσα μιλάς; Γράψε `on` (ναι) ή `off` (όχι).');

    if (enabled === current) {
      return ctx.reply(`${emoji('bot_warn')} Το 24/7 είναι ΗΔΗ **${enabled ? 'αναμμένο' : 'σβηστό'}**! Τι το πατάς αφού δουλεύει;`);
    }

    database.setStay247(ctx.guildId, enabled);

    applyStay247(client.player?.nodes?.get(ctx.guildId), enabled);

    client.voiceWatcher?.refresh(ctx.guildId);

    client.emit('dashboard:sync');

    const minutes = Math.round(emptyGraceMs() / 60000);
    return ctx.reply(
      enabled
        ? `${emoji('bot_loop')} Έγινεεε! Το 24/7 **άναψε**. Έφερα σλιπινγκ μπαγκ, δεν φεύγω από 'δω.`
        : `${emoji('bot_timer')} Το 24/7 **έσβησε**. Άμα δεν έχει κόσμο, σε ${minutes} λεπτάκια εγώ την έκανα.`
    );
  })
};
