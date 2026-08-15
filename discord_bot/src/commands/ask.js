const { SlashCommandBuilder } = require('discord.js');
const { defineCommand, upgradeDmContext } = require('../utils/command-context');
const ai = require('../ai');

/**
 * Κουβέντα και εντολές με φυσική γλώσσα.
 *
 * Η εντολή δηλώνεται πάντα, αλλά **δεν φορτώνεται** χωρίς κλειδί: το
 * `module.exports` παρακάτω βγαίνει άδειο, ο loader την προσπερνά ως άκυρη, και
 * λείπει και από το `/help` και από τις καταχωρήσεις. Κριτήριο αποδοχής της
 * φάσης: μηδενική αλλαγή συμπεριφοράς σε εγκατάσταση χωρίς κλειδί.
 */

const command = {
  category: 'General',
  // Χωρίς τονισμένη παραλλαγή: το normalizeAlias αφαιρεί τους τόνους, οπότε το
  // «ρώτα» δουλεύει ήδη μέσω του «ρωτα» και ως ξεχωριστό alias συγκρούεται.
  aliases: ['ρωτα', 'ai'],
  dmCapable: true,
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ρώτησέ με κάτι ή πες μου τι να παίξω, με κανονικά λόγια.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Τι θέλεις;')
        .setRequired(true)
    ),

  ...defineCommand(async (ctx, client, database) => {
    const message = String(ctx.option('message') || '').trim();

    // Οι κλήσεις AI παίρνουν δευτερόλεπτα· χωρίς defer το interaction λήγει.
    if (ctx.defer) await ctx.defer();

    // Σε DM: αν κάθεσαι σε κανάλι φωνής, οι εντολές μουσικής δουλεύουν εκεί.
    const resolved = await upgradeDmContext(ctx, client);

    const { text, embed } = await ai.ask(resolved, message, client, database);
    return ctx.reply(embed ? { content: text || undefined, embeds: [embed] } : text);
  })
};

// Ρητή δήλωση αντί για άδειο `{}`: ο loader και το smoke test ξεχωρίζουν έτσι
// το «σκόπιμα ανενεργό» από το «σπασμένο αρχείο». Ένα άδειο export μοιάζει με
// το δεύτερο.
module.exports = ai.isEnabled() ? command : { disabled: 'GEMINI_API_KEY is not set' };
