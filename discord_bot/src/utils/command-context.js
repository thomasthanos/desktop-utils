const { MessageFlags } = require('discord.js');

/**
 * Κάθε εντολή υποστηρίζει και slash και prefix. Χωρίς αυτόν τον adapter κάθε
 * εντολή θα έγραφε δύο φορές την ίδια λογική — μία στο execute() και μία στο
 * prefixExecute() — που είναι ακριβώς ο τρόπος με τον οποίο οι δύο διαδρομές
 * αποκλίνουν σιωπηλά με τον καιρό.
 *
 * Και οι δύο πηγές εκτίθενται με ένα κοινό σχήμα, ώστε η εντολή να γράφεται
 * μία φορά.
 */

function fromInteraction(interaction) {
  return {
    isSlash: true,
    guild: interaction.guild,
    guildId: interaction.guildId,
    member: interaction.member,
    user: interaction.user,
    channel: interaction.channel,
    inGuild: () => interaction.inGuild(),

    /** Παράμετρος εντολής με όνομα. */
    option: (name) => interaction.options.get(name)?.value ?? null,

    /**
     * Για εντολές που αργούν. Το Discord ακυρώνει ένα interaction που δεν
     * απάντησε σε 3 δευτερόλεπτα, και μια κλήση AI τα ξεπερνάει άνετα.
     */
    defer: () => interaction.deferReply(),

    // Μετά από defer, το `reply` δεν επιτρέπεται πια — θέλει `editReply`. Το
    // κρύβουμε εδώ ώστε η εντολή να γράφεται μία φορά και να δουλεύει και στις
    // δύο περιπτώσεις.
    reply: (payload) => {
      const body = typeof payload === 'string' ? { content: payload } : payload;
      return interaction.deferred || interaction.replied
        ? interaction.editReply(body)
        : interaction.reply(body);
    },

    /** Απάντηση ορατή μόνο σε όποιον έτρεξε την εντολή. */
    replyPrivate: (content) =>
      interaction.reply({ content, flags: MessageFlags.Ephemeral })
  };
}

function fromMessage(message, argsText) {
  const args = String(argsText || '').trim();
  const parts = args ? args.split(/\s+/) : [];

  return {
    isSlash: false,
    guild: message.guild,
    guildId: message.guild?.id || null,
    member: message.member,
    user: message.author,
    channel: message.channel,
    inGuild: () => Boolean(message.guild),

    // Με prefix οι παράμετροι είναι θεσιακές. Οι εντολές που δέχονται μία τιμή
    // παίρνουν όλο το κείμενο· `_n` δίνει το n-οστό λεκτικό.
    option: (_name) => (args === '' ? null : args),
    arg: (index) => parts[index] ?? null,
    args,

    // Δεν υπάρχει interaction να λήξει· η ένδειξη πληκτρολόγησης είναι το
    // αντίστοιχο «δούλεψε πάνω του» για τον χρήστη.
    defer: async () => { await message.channel?.sendTyping?.().catch(() => {}); },

    reply: (payload) =>
      message.reply(typeof payload === 'string' ? { content: payload } : payload),

    replyPrivate: (content) => message.reply({ content })
  };
}

/**
 * Συμπληρώνει σε ένα context από DM το guild όπου ο χρήστης είναι σε φωνή.
 *
 * Σε ιδιωτική συνομιλία το Discord δεν δίνει guild — αλλά αν ο χρήστης κάθεται
 * σε κανάλι φωνής, το bot το βλέπει. Χωρίς αυτό, ένα «βάλε κάτι» από DM
 * απαντάει «μόνο μέσα σε server» σε κάποιον που είναι ήδη μέσα σε server.
 *
 * Αν δεν βρεθεί πουθενά, επιστρέφεται το context αμετάβλητο και οι εντολές
 * απαντούν κανονικά ότι χρειάζονται κανάλι φωνής. ΔΕΝ εφευρίσκουμε guild.
 */
async function upgradeDmContext(ctx, client) {
  if (ctx.inGuild()) return ctx;

  const { findUserVoiceGuild } = require('./voice');
  const found = await findUserVoiceGuild(client, ctx.user?.id);
  if (!found) return ctx;

  return {
    ...ctx,
    guildId: found.guild.id,
    guild: found.guild,
    member: found.member,
    inGuild: () => true
  };
}

/**
 * Χτίζει τα execute/prefixExecute μιας εντολής από ΜΙΑ υλοποίηση.
 *
 *   module.exports = { ...defineCommand(async (ctx, client, database) => { ... }) }
 */
function defineCommand(handler) {
  return {
    async execute(interaction, client, database) {
      return handler(fromInteraction(interaction), client, database);
    },
    async prefixExecute(message, argsText, client, database) {
      return handler(fromMessage(message, argsText), client, database);
    }
  };
}

module.exports = { fromInteraction, fromMessage, defineCommand, upgradeDmContext };
