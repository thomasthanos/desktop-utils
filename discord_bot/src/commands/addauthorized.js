const { SlashCommandBuilder, MessageFlags, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { canManageAuthorization, restrictableCommands } = require('../utils/authorization');
const { PREFIX } = require('../prefix-commands');
const { emoji, plainEmoji } = require('../utils/emojis');

function parseUserId(raw) {
  if (!raw) return null;
  const mentionMatch = raw.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];
  return /^\d+$/.test(raw) ? raw : null;
}

function parseRoleId(raw) {
  const mentionMatch = String(raw || '').match(/^<@&(\d+)>$/);
  return mentionMatch ? mentionMatch[1] : null;
}

function allowedNames(client) {
  return restrictableCommands(client).map((cmd) => cmd.name);
}

function allowedList(client) {
  const names = allowedNames(client);
  return names.length ? names.map((name) => `\`/${name}\``).join(', ') : '—';
}

// Το Discord δεν έχει διαχωριστικά στο autocomplete· το πρόθεμα κατηγορίας
// κάνει τη λίστα να διαβάζεται ομαδοποιημένη.
function label(cmd) {
  return `${cmd.category} › /${cmd.name}`;
}

function describe(principal) {
  return principal.type === 'role' ? `<@&${principal.id}>` : `<@${principal.id}>`;
}

function commandOption(option) {
  return option
    .setName('command')
    .setDescription('Ποια εντολή αφορά')
    .setRequired(true)
    .setAutocomplete(true);
}

function modeOption(option) {
  return option
    .setName('mode')
    .setDescription('Προσθήκη ή αφαίρεση — κενό σημαίνει προσθήκη')
    .setRequired(false)
    .addChoices(
      { name: 'Προσθήκη', value: 'add' },
      { name: 'Αφαίρεση', value: 'remove' }
    );
}

function buildListEmbed(interaction, client, database, only) {
  const rows = database.listCommandAccess(interaction.guildId);
  const wanted = restrictableCommands(client).filter((cmd) => !only || cmd.name === only);

  const lines = wanted.map((cmd) => {
    const principals = rows.filter((row) => row.command_name === cmd.name);

    if (!principals.length) {
      return `${emoji('bot_ok')} \`/${cmd.name}\` — ανοιχτή σε όλους`;
    }

    const who = principals
      .map((row) => (row.principal_type === 'role' ? `<@&${row.user_id}>` : `<@${row.user_id}>`))
      .join(', ');

    return `${emoji('bot_warn')} \`/${cmd.name}\` — μόνο ${who}`;
  });

  return new EmbedBuilder()
    .setColor(0x8b7cff)
    .setTitle(`${plainEmoji('bot_admin')} Ποιος τρέχει ποια εντολή`)
    .setDescription(lines.join('\n') || 'Καμία εντολή δεν κλειδώνεται εδώ.')
    .setFooter({ text: 'Οι διαχειριστές του server τις τρέχουν πάντα.' });
}

module.exports = {
  category: 'Admin',
  aliases: ['aa', 'αα'],
  data: new SlashCommandBuilder()
    .setName('addauthorized')
    .setDescription('Ρύθμισε ποιος μπορεί να τρέχει τις εντολές διαχειριστή.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Δώσε ή πάρε πρόσβαση από έναν χρήστη.')
        .addStringOption(commandOption)
        .addUserOption((option) =>
          option
            .setName('target')
            .setDescription('Ο χρήστης')
            .setRequired(true)
        )
        .addStringOption(modeOption)
    )
    .addSubcommand((sub) =>
      sub
        .setName('role')
        .setDescription('Δώσε ή πάρε πρόσβαση από έναν ρόλο — την παίρνουν όλα τα μέλη του.')
        .addStringOption(commandOption)
        .addRoleOption((option) =>
          option
            .setName('target')
            .setDescription('Ο ρόλος')
            .setRequired(true)
        )
        .addStringOption(modeOption)
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Δες ποιος τρέχει τι αυτή τη στιγμή.')
        .addStringOption((option) =>
          option
            .setName('command')
            .setDescription('Κενό για όλες')
            .setRequired(false)
            .setAutocomplete(true)
        )
    ),

  async autocomplete(interaction, client) {
    const focused = interaction.options.getFocused().toLowerCase();

    const choices = restrictableCommands(client)
      .filter((cmd) => cmd.name.includes(focused) || cmd.category.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((cmd) => ({ name: label(cmd), value: cmd.name }));

    await interaction.respond(choices);
  },

  async execute(interaction, client, database) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: `${emoji('bot_warn')} Αυτό δουλεύει μόνο μέσα σε server.`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (!canManageAuthorization(interaction)) {
      await interaction.reply({
        content: `${emoji('bot_error')} Μόνο ο ιδιοκτήτης του server ρυθμίζει δικαιώματα εντολών.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const only = interaction.options.getString('command');
      if (only && !allowedNames(client).includes(only)) {
        await interaction.reply({
          content: `Η εντολή \`/${only}\` δεν κλειδώνεται. Επίλεξε από: ${allowedList(client)}`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        embeds: [buildListEmbed(interaction, client, database, only)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const commandName = interaction.options.getString('command', true).trim().toLowerCase();
    const mode = interaction.options.getString('mode') || 'add';

    if (!allowedNames(client).includes(commandName)) {
      await interaction.reply({
        content: `Η εντολή \`/${commandName}\` δεν υποστηρίζει περιορισμούς. Επίλεξε από: ${allowedList(client)}`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const principal = subcommand === 'role'
      ? { id: interaction.options.getRole('target', true).id, type: 'role' }
      : { id: interaction.options.getUser('target', true).id, type: 'user' };

    const noun = principal.type === 'role' ? 'Ο ρόλος' : 'Ο χρήστης';

    // Ο @everyone θα έδινε πρόσβαση σε όλους, δηλαδή ακριβώς το αντίθετο.
    if (principal.type === 'role' && principal.id === interaction.guildId) {
      await interaction.reply({
        content: `${emoji('bot_warn')} Ο \`@everyone\` δεν περιορίζει τίποτα. Άφησε την εντολή ξεκλείδωτη.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const isCurrentlyAuth = database.isAuthorizedUser(interaction.guildId, commandName, principal.id);

    if (mode === 'remove') {
      if (!isCurrentlyAuth) {
        const embed = new EmbedBuilder()
          .setColor(0x95a5a6)
          .setDescription(`${emoji('bot_warn')} ${noun} ${describe(principal)} δεν είχε δικαίωμα για την εντολή \`/${commandName}\` ούτως ή άλλως.`);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      database.removeAuthorizedUser(interaction.guildId, commandName, principal.id);
      client.emit('dashboard:sync');

      const stillLocked = database.hasAuthorizedEntriesForCommand(interaction.guildId, commandName);
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setDescription(
          `${emoji('bot_ok')} Το δικαίωμα αφαιρέθηκε. ${noun} ${describe(principal)} δεν τρέχει πλέον την \`/${commandName}\`.`
          + (stillLocked ? '' : `\n-# Δεν έμεινε κανείς στη λίστα, οπότε η εντολή είναι ξανά ανοιχτή σε όλους.`)
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (isCurrentlyAuth) {
      const embed = new EmbedBuilder()
        .setColor(0x95a5a6)
        .setDescription(`${emoji('bot_warn')} ${noun} ${describe(principal)} έχει ήδη δικαίωμα για την εντολή \`/${commandName}\`.`);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const wasOpen = !database.hasAuthorizedEntriesForCommand(interaction.guildId, commandName);
    database.addAuthorizedUser(interaction.guildId, commandName, principal, interaction.user, principal.type);
    client.emit('dashboard:sync');

    const embed = new EmbedBuilder()
      .setColor(0x1db954)
      .setDescription(
        `${emoji('bot_ok')} ${noun} ${describe(principal)} μπορεί πλέον να τρέχει την \`/${commandName}\`.`
        + (wasOpen ? `\n-# Από εδώ και πέρα η εντολή είναι κλειδωμένη για όλους τους υπόλοιπους.` : '')
      )
      .setFooter({ text: 'Για αφαίρεση, ίδια εντολή με mode: Αφαίρεση.' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  async prefixExecute(message, argsText, client, database) {
    const pseudoInteraction = { user: message.author, guild: message.guild };
    if (!canManageAuthorization(pseudoInteraction)) {
      await message.reply(`${emoji('bot_error')} Μόνο ο ιδιοκτήτης του server ρυθμίζει δικαιώματα.`);
      return;
    }

    const args = argsText.split(/\s+/);
    const targetCommand = (args[0] || '').toLowerCase();
    const rawTarget = args[1] || '';
    const mode = (args[2] || 'add').toLowerCase();

    const roleId = parseRoleId(rawTarget);
    const userId = roleId ? null : parseUserId(rawTarget);

    if (!targetCommand || (!roleId && !userId) || !['add', 'remove'].includes(mode)) {
      await message.reply(`Χρήση: \`${PREFIX}aa <εντολή> <@χρήστης|@ρόλος|ID> [add|remove]\``);
      return;
    }

    if (!client.commands.has(targetCommand)) {
      await message.reply(`${emoji('bot_error')} Η εντολή \`${targetCommand}\` δεν υπάρχει.`);
      return;
    }

    if (!allowedNames(client).includes(targetCommand)) {
      await message.reply(`Η εντολή \`${targetCommand}\` δεν υποστηρίζει περιορισμούς. Επιτρέπονται: ${allowedList(client)}`);
      return;
    }

    let principal;
    let noun;

    if (roleId) {
      const role = message.guild.roles.cache.get(roleId);
      if (!role) {
        await message.reply(`${emoji('bot_error')} Δεν βρήκα αυτόν τον ρόλο σε αυτόν τον server.`);
        return;
      }
      if (role.id === message.guild.id) {
        await message.reply(`${emoji('bot_warn')} Ο \`@everyone\` δεν περιορίζει τίποτα.`);
        return;
      }
      principal = { id: role.id, type: 'role' };
      noun = 'Ο ρόλος';
    } else {
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) {
        await message.reply(`${emoji('bot_error')} Δεν βρήκα αυτόν τον χρήστη.`);
        return;
      }
      principal = { id: user.id, type: 'user' };
      noun = 'Ο χρήστης';
    }

    const isCurrentlyAuth = database.isAuthorizedUser(message.guild.id, targetCommand, principal.id);

    if (mode === 'remove') {
      if (!isCurrentlyAuth) {
        await message.reply(`${emoji('bot_warn')} ${noun} ${describe(principal)} δεν είχε δικαίωμα για \`/${targetCommand}\` ούτως ή άλλως.`);
        return;
      }
      database.removeAuthorizedUser(message.guild.id, targetCommand, principal.id);
      client.emit('dashboard:sync');
      await message.reply(`${emoji('bot_ok')} Το δικαίωμα αφαιρέθηκε. ${noun} ${describe(principal)} δεν τρέχει πλέον την \`/${targetCommand}\`.`);
      return;
    }

    if (isCurrentlyAuth) {
      await message.reply(`${emoji('bot_warn')} ${noun} ${describe(principal)} έχει ήδη δικαίωμα για \`/${targetCommand}\`.`);
      return;
    }

    database.addAuthorizedUser(message.guild.id, targetCommand, principal, message.author, principal.type);
    client.emit('dashboard:sync');
    await message.reply(`${emoji('bot_ok')} ${noun} ${describe(principal)} μπορεί πλέον να τρέχει την \`/${targetCommand}\`.`);
  }
};
