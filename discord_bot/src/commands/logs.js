const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');

/**
 * Στέλνει τον σύνδεσμο του dashboard.
 *
 *   /logs   ή   !logs
 *
 * Η διεύθυνση ΔΕΝ είναι κωδικοποιημένη εδώ: το dashboard ζει πίσω από
 * Cloudflare Tunnel και το hostname είναι ρύθμιση της εγκατάστασης, όχι του
 * κώδικα. Ορίζεται στο DASHBOARD_URL (βλ. .env.example).
 *
 * Ο σύνδεσμος δεν είναι μυστικό — η σελίδα ζητά κωδικό ούτως ή άλλως. Παρ'
 * όλα αυτά η απάντηση στο /logs είναι ephemeral: δεν υπάρχει λόγος να
 * γεμίζει το κανάλι με links προς μια σελίδα που θα ανοίξει ένας.
 */
const PAGES = [
  ['📊 Επισκόπηση', '/', 'στατιστικά, τι παίζει τώρα, ζωντανή κατάσταση'],
  ['🧾 Clear Logs', '/clearlogs', 'ιστορικό διαγραφών με πλήρη transcripts'],
  ['⌨️ Commands', '/commands', 'ποιος έτρεξε τι και πότε'],
  ['📨 Invites', '/invites', 'ποιος έφερε ποιον']
];

/** Η ρυθμισμένη διεύθυνση, χωρίς `/` στο τέλος — ή null αν λείπει/είναι άκυρη. */
function dashboardUrl() {
  const raw = String(process.env.DASHBOARD_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Το ButtonStyle.Link δέχεται μόνο http/https. Οτιδήποτε άλλο απορρίπτεται
    // από το Discord API με σφάλμα που δεν λέει τι φταίει — καλύτερα εδώ.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return raw.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function buildResponse() {
  const base = dashboardUrl();

  if (!base) {
    return {
      embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('⚠️ Το dashboard δεν έχει ρυθμιστεί')
        .setDescription(
          'Λείπει η μεταβλητή `DASHBOARD_URL`.\n'
          + 'Πρόσθεσέ την στο αρχείο ρυθμίσεων και κάνε restart το bot:\n'
          + '```\nDASHBOARD_URL=https://dash.example.com\n```'
        )]
    };
  }

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle('📊 Bot Dashboard')
    .setURL(base)
    .setDescription(PAGES.map(([label, p, note]) => `**[${label}](${base}${p})** — ${note}`).join('\n'))
    .setFooter({ text: 'Χρειάζεται τον κωδικό του dashboard' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Άνοιγμα').setStyle(ButtonStyle.Link).setURL(base)
  );

  return { embeds: [embed], components: [row] };
}

module.exports = {
  category: 'General',
  aliases: ['dashboard', 'dash'],
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Στέλνει τον σύνδεσμο για το dashboard του bot.'),

  async execute(interaction) {
    await interaction.reply({ ...buildResponse(), flags: MessageFlags.Ephemeral });
  },

  async prefixExecute(message) {
    await message.reply(buildResponse());
  }
};
