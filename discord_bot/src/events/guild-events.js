const { Collection } = require('discord.js');
const log = require('../utils/logger')('guild');

/**
 * Παρακολούθηση προσκλήσεων και συγχρονισμός του dashboard.
 *
 * Το Discord δεν λέει ποια πρόσκληση χρησιμοποιήθηκε όταν μπαίνει κάποιος.
 * Κρατάμε στιγμιότυπο των μετρητών χρήσης και βρίσκουμε ποιος αυξήθηκε.
 */
function register({ client, database, sync }) {
  const { emitDashboardSync } = sync;

  client.on('inviteCreate', (invite) => {
    const invites = client.inviteCache.get(invite.guild.id) || new Collection();
    invites.set(invite.code, invite.uses);
    client.inviteCache.set(invite.guild.id, invites);
  });

  client.on('inviteDelete', (invite) => {
    const invites = client.inviteCache.get(invite.guild.id);
    if (invites) invites.delete(invite.code);
  });

  client.on('guildMemberAdd', async (member) => {
    try {
      const cachedInvites = client.inviteCache.get(member.guild.id);
      const newInvites = await member.guild.invites.fetch();
      const usedInvite = newInvites.find((inv) => inv.uses > (cachedInvites?.get(inv.code) || 0));

      client.inviteCache.set(
        member.guild.id,
        new Collection(newInvites.map((inv) => [inv.code, inv.uses]))
      );

      if (usedInvite && usedInvite.inviter) {
        const totalInvites = newInvites
          .filter((inv) => inv.inviter?.id === usedInvite.inviter.id)
          .reduce((acc, inv) => acc + inv.uses, 0);
        database.logInvite(usedInvite.inviter, member.user, usedInvite.code, member.guild, totalInvites);
      }
    } catch (error) {
      log.error('Error tracking invite:', error);
    } finally {
      emitDashboardSync();
    }
  });

  client.on('guildMemberRemove', () => emitDashboardSync());
  client.on('guildCreate', () => emitDashboardSync());
  client.on('guildDelete', () => emitDashboardSync());
}

module.exports = { register };
