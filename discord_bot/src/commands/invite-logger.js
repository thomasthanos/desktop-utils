const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');
const { emoji, plainEmoji } = require('../utils/emojis');
const { canManageAuthorization } = require('../utils/authorization');
const { canSpeakIn } = require('../utils/kick-message');
const { humanDuration, parseStoredTime, fakeWindowMs } = require('../utils/invite-log');

function timeAgo(timestamp) {
  const then = parseStoredTime(timestamp);
  if (then === null) return 'κάποτε';

  const diff = Math.max(0, Date.now() - then);
  return diff < 60000 ? 'μόλις τώρα' : `πριν ${humanDuration(diff)}`;
}

function buildReport(guild, database, limit) {
  const recent = database.getInviteLogsByGuild(guild.id, limit);
  const leaderboard = database.getInviteLeaderboardByGuild(guild.id, limit);

  if (!recent.length && !leaderboard.length) return null;

  const topValue = leaderboard.length
    ? leaderboard.map((row, index) => {
        const fake = Number(row.fake_invites || 0);
        const gone = Number(row.left_invites || 0);
        const stayed = Math.max(0, Number(row.total_invites || 0) - gone);

        const notes = [];
        if (gone > 0) notes.push(`${gone} έφυγαν`);
        if (fake > 0) notes.push(`${fake} fake`);
        const suffix = notes.length ? ` _(${notes.join(', ')})_` : '';

        return `${emoji('bot_user')} **#${index + 1}** ${row.inviter_tag} — **${stayed}**${suffix}`;
      }).join('\n')
    : 'Τίποτα ακόμα.';

  const recentValue = recent.length
    ? recent.map((row) => {
        const kind = String(row.event || 'join');
        const who = `**${row.invited_tag}**`;

        if (kind === 'ban') return `${emoji('bot_mod')} ${who} έφαγε ban • ${timeAgo(row.timestamp)}`;
        if (kind === 'kick') return `${emoji('bot_kick')} ${who} έφαγε kick • ${timeAgo(row.timestamp)}`;
        if (kind === 'leave') return `${emoji('bot_leave')} ${who} έφυγε • ${timeAgo(row.timestamp)}`;

        const icon = emoji('bot_join');

        const by = row.inviter_id && row.inviter_id !== 'unknown' ? row.inviter_tag : 'άγνωστον';
        const fake = row.is_fake ? ` ${emoji('bot_warn')} fake` : '';
        return `${icon} ${who} από ${by} (\`${row.invite_code || '?'}\`) • ${timeAgo(row.timestamp)}${fake}`;
      }).join('\n')
    : 'Καμία πρόσφατη κίνηση.';

  const channelId = database.getInviteLogChannel(guild.id);

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`${plainEmoji('bot_invites')} Προσκλήσεις — ${guild.name}`)
    .addFields(
      { name: `${emoji('bot_trophy')} Κορυφαίοι (όσοι έμειναν)`, value: topValue, inline: false },
      { name: `${emoji('bot_clock')} Πρόσφατη κίνηση`, value: recentValue, inline: false }
    )
    .setFooter({
      text: channelId
        ? `Ανακοινώσεις στο #${guild.channels.cache.get(channelId)?.name || channelId}`
        : 'Χωρίς κανάλι ανακοινώσεων — /invite-logger channel'
    })
    .setTimestamp(new Date());
}

module.exports = {
  category: 'Invites',
  // Το list το βλέπουν όλοι· channel/clear/disable μόνο ο ιδιοκτήτης.
  defaultAudience: 'Ιδιοκτήτης του server (οι ρυθμίσεις της)',
  aliases: ['il', 'ιλ'],
  data: new SlashCommandBuilder()
    .setName('invite-logger')
    .setDescription('Ποιος φέρνει κόσμο και ποιος είναι τζαμπατζής; Δες τα stats.')
    // Οι τρεις από τις τέσσερις υποεντολές θέλουν ιδιοκτήτη· χωρίς αυτό η
    // εντολή φαινόταν σε όλους και τους απαντούσε «δεν έχεις δικαίωμα».
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('Δες κορυφαίους και πρόσφατη κίνηση.')
        .addIntegerOption((option) =>
          option
            .setName('limit')
            .setDescription('Πόσες γραμμές να δείξω (3-10)')
            .setRequired(false)
            .setMinValue(3)
            .setMaxValue(10)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear')
        .setDescription('Σβήσε όλο το ιστορικό προσκλήσεων αυτού του server.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('Σταμάτα τις ανακοινώσεις εισόδων και αποχωρήσεων.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Πού να ανακοινώνω εισόδους και αποχωρήσεις.')
        .addChannelOption((option) =>
          option
            .setName('target')
            .setDescription('Κενό για να σταματήσουν οι ανακοινώσεις')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)
        )
    ),

  async execute(interaction, client, database) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: `${emoji('bot_warn')} Αυτό δουλεύει μόνο μέσα σε server.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const subcommand = interaction.options?.getSubcommand?.(false) || 'list';

    if (subcommand === 'clear') {
      if (!canManageAuthorization(interaction)) {
        await interaction.reply({
          content: `${emoji('bot_error')} Μόνο ο ιδιοκτήτης του server το κάνει αυτό.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const deleted = database.deleteInviteLogsByGuild(interaction.guildId);
      client.emit('dashboard:sync');

      await interaction.reply(
        `${emoji('bot_ok')} Καθάρισα **${deleted}** εγγραφές προσκλήσεων. Ο πίνακας ξεκινά από την αρχή.`
      );
      return;
    }

    if (subcommand === 'disable') {
      if (!canManageAuthorization(interaction)) {
        await interaction.reply({
          content: `${emoji('bot_error')} Μόνο ο ιδιοκτήτης του server το αλλάζει αυτό.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const current = database.getInviteLogChannel(interaction.guildId);
      if (!current) {
        await interaction.reply({
          content: `${emoji('bot_warn')} Δεν ανακοίνωνα κάπου ούτως ή άλλως.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      database.setInviteLogChannel(interaction.guildId, null);
      client.emit('dashboard:sync');

      await interaction.reply(
        `${emoji('bot_ok')} Σταμάτησα τις ανακοινώσεις προσκλήσεων. Το ιστορικό μένει —`
        + ` για να σβήσει θέλει \`/invite-logger clear\`.`
      );
      return;
    }

    if (subcommand === 'channel') {
      if (!canManageAuthorization(interaction)) {
        await interaction.reply({
          content: `${emoji('bot_error')} Μόνο ο ιδιοκτήτης του server το αλλάζει αυτό.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const target = interaction.options.getChannel('target');

      if (!target) {
        database.setInviteLogChannel(interaction.guildId, null);
        await interaction.reply(`${emoji('bot_ok')} Σταμάτησα τις ανακοινώσεις προσκλήσεων.`);
        return;
      }

      if (!canSpeakIn(target, interaction.guild.members.me)) {
        await interaction.reply({
          content: `${emoji('bot_error')} Δεν μπορώ να γράψω στο ${target}. Δώσε μου δικαίωμα και ξαναπροσπάθησε.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      database.setInviteLogChannel(interaction.guildId, target.id);
      const minutes = Math.round(fakeWindowMs() / 60000);
      await interaction.reply(
        `${emoji('bot_ok')} Θα ανακοινώνω εισόδους και αποχωρήσεις στο ${target}.\n`
        + `-# Fake μετράει όποιος ξαναμπαίνει ή φεύγει μέσα σε ${minutes} λεπτά.`
      );
      return;
    }

    const limit = interaction.options?.getInteger?.('limit') || 5;
    const embed = buildReport(interaction.guild, database, limit);

    if (!embed) {
      await interaction.reply({
        content: `${emoji('bot_invites')} Κανένα invite ακόμα. Μοναχικά εδώ μέσα.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply({ embeds: [embed] });
    client.emit('dashboard:sync');
  },

  async prefixExecute(message, argsText, client, database) {
    if (!message.guild) {
      await message.reply(`${emoji('bot_warn')} Αυτό δουλεύει μόνο μέσα σε server.`);
      return;
    }

    if (String(argsText || '').trim().toLowerCase().startsWith('channel')) {
      await message.reply(`${emoji('bot_warn')} Το κανάλι ορίζεται με \`/invite-logger channel\`.`);
      return;
    }

    const embed = buildReport(message.guild, database, 5);
    if (!embed) {
      await message.reply(`${emoji('bot_invites')} Κανένα invite ακόμα. Μοναχικά εδώ μέσα.`);
      return;
    }

    await message.reply({ embeds: [embed] });
    client.emit('dashboard:sync');
  }
};
