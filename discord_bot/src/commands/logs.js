const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');

const { emoji, plainEmoji } = require('../utils/emojis');

function getPages() {
  return [
    [`${emoji('bot_stats')} Επισκόπηση`, '/', 'Στατιστικά, τι παίζει τώρα, ζωντανή κατάσταση'],
    [`${emoji('bot_clear')} Ιστορικό Διαγραφών`, '/clearlogs', 'Ιστορικό διαγραφών με πλήρη transcripts'],
    [`${emoji('bot_general')} Ιστορικό Εντολών`, '/commands', 'Ποιος έτρεξε τι και πότε'],
    [`${emoji('bot_invites')} Προσκλήσεις`, '/invites', 'Ποιος έφερε ποιον']
  ];
}

function dashboardUrl() {
  const raw = String(process.env.DASHBOARD_URL || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);

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
        .setTitle(`${plainEmoji('bot_warn')} Το dashboard δεν έχει ρυθμιστεί`)
        .setDescription(
          'Λείπει η μεταβλητή `DASHBOARD_URL`.\n'
          + 'Πρόσθεσέ την στο αρχείο ρυθμίσεων και κάνε restart το bot:\n'
          + '```\nDASHBOARD_URL=https://dash.example.com\n```'
        )]
    };
  }

  const embed = new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle(`${plainEmoji('bot_stats')} Bot Dashboard`)
    .setURL(base)
    .setDescription(getPages().map(([label, p, note]) => `**${label}** — ${note}`).join('\n'))
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
    .setDescription('Δες τα άπλυτα του bot (το link για το dashboard).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.reply({ ...buildResponse(), flags: MessageFlags.Ephemeral });
  },

  async prefixExecute(message) {
    await message.reply(buildResponse());
  }
};
