const { SlashCommandBuilder } = require('discord.js');
const { defineCommand } = require('../utils/command-context');
const { canManageAuthorization } = require('../utils/authorization');
const { applyStay247, emptyGraceMs } = require('../utils/voice');

/**
 * Διακόπτης «μείνε στο κανάλι ό,τι κι αν γίνει», ανά server.
 *
 * Ο έλεγχος πρόσβασης είναι το `canManageAuthorization` που ήδη υπάρχει και
 * σημαίνει ακριβώς «ιδιοκτήτης του bot ή ιδιοκτήτης του server» — δεν φτιάχνεται
 * δεύτερο predicate που θα απέκλινε από το πρώτο.
 */

const ON = new Set(['on', 'ναι', 'yes', 'true', '1', 'ενεργο', 'ενεργό']);
const OFF = new Set(['off', 'οχι', 'όχι', 'no', 'false', '0', 'ανενεργο', 'ανενεργό']);

module.exports = {
  category: 'Music',
  // Το ίδιο το «247» μπαίνει αυτόματα από το όνομα της εντολής.
  aliases: ['24-7', '24/7'],
  data: new SlashCommandBuilder()
    .setName('247')
    .setDescription('Keep the bot in the voice channel around the clock.')
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Leave empty to see the current setting')
        .setRequired(false)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
    ),

  ...defineCommand(async (ctx, client, database) => {
    if (!ctx.inGuild()) {
      return ctx.replyPrivate('Αυτή η εντολή δουλεύει μόνο μέσα σε server.');
    }

    const current = database.getStay247(ctx.guildId);
    const raw = String(ctx.option('mode') || '').trim().toLowerCase();

    // Χωρίς όρισμα: μόνο ανάγνωση. Δεν κάνει εναλλαγή — ένα «τι είναι τώρα;»
    // δεν πρέπει να αλλάζει αυτό που ρωτάει.
    if (!raw) {
      const minutes = Math.round(emptyGraceMs() / 60000);
      return ctx.reply(
        current
          ? '🔁 Το 24/7 είναι **ενεργό** — μένω στο κανάλι μέχρι να μου πεις να φύγω.'
          : `⏱️ Το 24/7 είναι **ανενεργό** — φεύγω αφού το κανάλι μείνει άδειο για ${minutes} λεπτά.`
      );
    }

    if (!canManageAuthorization(ctx)) {
      return ctx.replyPrivate('Μόνο ο ιδιοκτήτης του server μπορεί να το αλλάξει αυτό.');
    }

    let enabled;
    if (ON.has(raw)) enabled = true;
    else if (OFF.has(raw)) enabled = false;
    else return ctx.replyPrivate('Γράψε `on` ή `off`.');

    if (enabled === current) {
      return ctx.reply(`Το 24/7 είναι ήδη **${enabled ? 'ενεργό' : 'ανενεργό'}**.`);
    }

    database.setStay247(ctx.guildId, enabled);

    // Η ενεργή ουρά κρατάει τις ρυθμίσεις που είχε όταν φτιάχτηκε.
    applyStay247(client.player?.nodes?.get(ctx.guildId), enabled);

    // Και το ραδιόφωνο: στο off ξαναϋπολογίζουμε ΑΜΕΣΩΣ αντί να περιμένουμε το
    // επόμενο γεγονός φωνής — αλλιώς, αν το κανάλι είναι ήδη άδειο, το bot θα
    // έμενε εκεί μέχρι να τύχει να μπει ή να βγει κάποιος.
    client.voiceWatcher?.refresh(ctx.guildId);

    client.emit('dashboard:sync');

    const minutes = Math.round(emptyGraceMs() / 60000);
    return ctx.reply(
      enabled
        ? '🔁 Το 24/7 **ενεργοποιήθηκε**. Μένω στο κανάλι ακόμα κι αν αδειάσει ή τελειώσει η ουρά.'
        : `⏱️ Το 24/7 **απενεργοποιήθηκε**. Θα φεύγω όταν το κανάλι μένει άδειο για ${minutes} λεπτά.`
    );
  })
};
