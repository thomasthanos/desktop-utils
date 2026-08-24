const { SlashCommandBuilder } = require('discord.js');
const { defineCommand, upgradeDmContext } = require('../utils/command-context');
const ai = require('../ai');

const command = {
  category: 'General',

  aliases: ['ρωτα', 'ai'],
  dmCapable: true,
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ρώτα με ό,τι θες, ή πες μου τι να παίξω, ντεμέκ AI.')
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Τι θες πάλι;')
        .setRequired(true)
    ),

  ...defineCommand(async (ctx, client, database) => {
    const message = String(ctx.option('message') || '').trim();

    if (ctx.defer) await ctx.defer();

    const resolved = await upgradeDmContext(ctx, client);

    const { text, embed } = await ai.ask(resolved, message, client, database);
    return ctx.reply(embed ? { content: text || undefined, embeds: [embed] } : text);
  })
};

module.exports = ai.isEnabled() ? command : { disabled: 'GEMINI_API_KEY is not set' };
