const { MessageFlags } = require('discord.js');

function fromInteraction(interaction) {
  return {
    isSlash: true,
    guild: interaction.guild,
    guildId: interaction.guildId,
    member: interaction.member,
    user: interaction.user,
    channel: interaction.channel,
    inGuild: () => interaction.inGuild(),

    option: (name) => interaction.options.get(name)?.value ?? null,

    defer: () => interaction.deferReply(),

    reply: (payload) => {
      const body = typeof payload === 'string' ? { content: payload } : payload;
      return interaction.deferred || interaction.replied
        ? interaction.editReply(body)
        : interaction.reply(body);
    },

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

    option: (_name) => (args === '' ? null : args),
    arg: (index) => parts[index] ?? null,
    args,

    defer: async () => { await message.channel?.sendTyping?.().catch(() => {}); },

    reply: (payload) =>
      message.reply(typeof payload === 'string' ? { content: payload } : payload),

    replyPrivate: (content) => message.reply({ content })
  };
}

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
