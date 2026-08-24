const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const { PREFIX } = require('../prefix-commands');
const { emoji, plainEmoji } = require('../utils/emojis');

const CATEGORY_META = {
  Music:      { icon: 'bot_music',   color: 0x1db954 },
  Moderation: { icon: 'bot_mod',     color: 0xe74c3c },
  Invites:    { icon: 'bot_invites', color: 0x3498db },
  Admin:      { icon: 'bot_admin',   color: 0xe67e22 },
  General:    { icon: 'bot_general', color: 0x9b59b6 },
};

const DEFAULT_META = { icon: 'bot_queue', color: 0x95a5a6 };

function getPrefixAliasLabel(cmd) {
  if (!Array.isArray(cmd.aliases) || !cmd.aliases.length) return '';
  return cmd.aliases.map((a) => `\`${PREFIX}${a}\``).join(' ');
}

function buildCategories(client) {
  const map = new Map();
  client.commands.forEach((cmd) => {
    const cat = cmd.category || 'General';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(cmd);
  });
  return map;
}

function buildCategoryEmbed(client, categoryKey) {
  const meta = CATEGORY_META[categoryKey] || DEFAULT_META;
  const cats = buildCategories(client);
  const commands = cats.get(categoryKey) || [];

  const fields = commands.map((cmd) => ({
    name: `\`/${cmd.data.name}\``,
    value: `${cmd.data.description}\n${getPrefixAliasLabel(cmd)}`.trim(),
    inline: true
  }));

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${plainEmoji(meta.icon)} Κατηγορία: ${categoryKey}`)
    .setDescription(`Εντολές **${categoryKey}** — (με \`/\` ή \`${PREFIX}\`)`)
    .addFields(fields)
    .setFooter({ text: `${PREFIX}help or /help • ${categoryKey} category` })
    .setTimestamp(new Date());
}

function buildOverviewEmbed(client) {
  const cats = buildCategories(client);
  const fields = [];

  for (const [key, commands] of cats.entries()) {
    const meta = CATEGORY_META[key] || DEFAULT_META;
    fields.push({
      name: `${emoji(meta.icon)} ${key}`,
      value: commands.map((c) => `\`/${c.data.name}\``).join(' '),
      inline: false
    });
  }

  return new EmbedBuilder()
    .setColor(0x1db954)
    .setTitle(`${plainEmoji('bot_general')} Μενού Βοήθειας`)
    .setDescription(`Διάλεξε κατηγορία από κάτω.\nΌλες οι εντολές παίζουν και με \`/\` και με \`${PREFIX}\`.`)
    .addFields(fields)
    .setFooter({ text: `Σύνολο: ${client.commands.size} εντολές` })
    .setTimestamp(new Date());
}

function buildButtons(client, activeCategory = null) {
  const cats = buildCategories(client);
  const row = new ActionRowBuilder();
  for (const [key] of cats.entries()) {
    const meta = CATEGORY_META[key] || DEFAULT_META;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`help_cat_${key}`)

        .setEmoji(emoji(meta.icon))
        .setLabel(key)
        .setStyle(activeCategory === key ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  return row;
}

module.exports = {
  category: 'General',
  aliases: ['h', 'η'],

  dmCapable: true,
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Δες τι μπορώ να κάνω (επειδή σίγουρα θα τα ξεχάσεις).'),

  async execute(interaction, client) {
    const overviewEmbed = buildOverviewEmbed(client);
    const row = buildButtons(client);

    const userId = interaction.user?.id || interaction.author?.id;
    const reply = await interaction.reply({
      embeds: [overviewEmbed],
      components: [row],
      fetchReply: true
    });

    if (typeof reply.createMessageComponentCollector !== 'function') return;

    const collector = reply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
      filter: (i) => i.user.id === userId && i.customId.startsWith('help_cat_')
    });

    collector.on('collect', async (i) => {
      const categoryKey = i.customId.replace('help_cat_', '');
      const catEmbed = buildCategoryEmbed(client, categoryKey);
      const updatedRow = buildButtons(client, categoryKey);
      await i.update({ embeds: [catEmbed], components: [updatedRow] });
    });

    collector.on('end', async () => {
      await reply.delete().catch(() => {});
    });
  },

  async prefixExecute(message, argsText, client) {
    const pseudoInteraction = {
      inGuild: () => Boolean(message.guild),
      user: message.author,
      guild: message.guild,
      guildId: message.guild?.id || null,
      channel: message.channel,
      replied: false,
      deferred: false,
      reply: (payload) => message.reply(payload)
    };
    await module.exports.execute(pseudoInteraction, client);
  }
};
