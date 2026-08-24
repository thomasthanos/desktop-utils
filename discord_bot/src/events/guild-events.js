const { Collection, AuditLogEvent } = require('discord.js');
const { rememberExecutor } = require('../utils/voice-departure');
const { notifyOwner } = require('../utils/notify');
const {
  fakeWindowMs,
  isFreshAccount,
  parseStoredTime,
  inviteLogChannel,
  buildJoinEmbed,
  buildLeaveEmbed,
  rememberRemoval,
  recentRemoval,
  announce
} = require('../utils/invite-log');
const log = require('../utils/logger')('guild');

function register({ client, database, sync, slashCommands, token }) {
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
      const newInvites = await member.guild.invites.fetch().catch(() => null);
      const usedInvite = newInvites?.find((inv) => inv.uses > (cachedInvites?.get(inv.code) || 0)) || null;

      if (newInvites) {
        client.inviteCache.set(
          member.guild.id,
          new Collection(newInvites.map((inv) => [inv.code, inv.uses]))
        );
      }

      const inviter = usedInvite?.inviter || null;
      const totalInvites = (inviter && newInvites)
        ? newInvites.filter((inv) => inv.inviter?.id === inviter.id).reduce((acc, inv) => acc + inv.uses, 0)
        : 0;

      // Μετράμε ΠΡΙΝ γράψουμε τη νέα είσοδο, αλλιώς μετράει τον εαυτό της.
      const seenBefore = database.countPreviousJoins(member.guild.id, member.id) > 0;
      const brandNew = isFreshAccount(member.user);

      const fakeReason = seenBefore
        ? 'έχει ξαναμπεί σε αυτόν τον server'
        : 'ο λογαριασμός μόλις φτιάχτηκε';

      database.logInviteEvent({
        event: 'join',
        inviter,
        invited: member.user,
        code: usedInvite?.code || null,
        guild: member.guild,
        totalInvites,
        isFake: seenBefore || brandNew
      });

      const channel = await inviteLogChannel(member.guild, database);
      if (channel) {
        await announce(channel, buildJoinEmbed({
          member,
          inviter,
          inviteCode: usedInvite?.code || null,
          totalInvites,
          isFake: seenBefore || brandNew,
          fakeReason
        }));
      }
    } catch (error) {
      log.error('Error tracking invite:', error);
    } finally {
      emitDashboardSync();
    }
  });

  client.on('guildAuditLogEntryCreate', (entry, guild) => {
    if (entry.action === AuditLogEvent.MemberDisconnect || entry.action === AuditLogEvent.MemberMove) {
      if (!entry.executor || entry.executor.id === client.user?.id) return;
      rememberExecutor(client, guild.id, entry.executor);
      return;
    }

    // Σε αντίθεση με το MemberDisconnect, αυτές οι εγγραφές ΕΧΟΥΝ στόχο και
    // αιτία, οπότε η απόδοση είναι ακριβής και όχι εικασία.
    const kind = entry.action === AuditLogEvent.MemberKick ? 'kick'
      : entry.action === AuditLogEvent.MemberBanAdd ? 'ban'
        : null;
    if (!kind) return;

    const targetId = entry.target?.id || entry.targetId;
    if (!targetId) return;

    rememberRemoval(client, guild.id, targetId, {
      kind,
      executor: entry.executor || null,
      reason: entry.reason || null
    });
  });

  const AUDIT_GRACE_MS = 2000;

  client.on('guildMemberRemove', async (member) => {
    try {
      const guild = member.guild;

      // Η εγγραφή του audit log φτάνει συνήθως λίγο μετά το ίδιο το event.
      await new Promise((resolve) => { setTimeout(resolve, AUDIT_GRACE_MS).unref?.(); });
      const removal = recentRemoval(client, guild.id, member.id);
      const lastJoin = database.getLastJoin(guild.id, member.id);

      const joinedAt = parseStoredTime(lastJoin?.timestamp);
      const stayedMs = joinedAt === null ? null : Date.now() - joinedAt;

      let markedFake = false;
      if (!removal && lastJoin && !lastJoin.is_fake && stayedMs !== null && stayedMs >= 0 && stayedMs < fakeWindowMs()) {
        markedFake = database.markJoinFake(lastJoin.id);
      }

      // Χωρίς αυτό η γραμμή αποχώρησης έχανε ποιος τον είχε φέρει, παρόλο
      // που το ξέρουμε από την είσοδο.
      const knownInviter = lastJoin?.inviter_id && lastJoin.inviter_id !== 'unknown'
        ? { id: lastJoin.inviter_id, tag: lastJoin.inviter_tag }
        : null;

      database.logInviteEvent({
        event: removal?.kind === 'ban' ? 'ban' : removal?.kind === 'kick' ? 'kick' : 'leave',
        inviter: knownInviter,
        invited: member.user || { id: member.id, tag: String(member.id) },
        code: lastJoin?.invite_code || null,
        guild,
        totalInvites: Number(lastJoin?.total_invites || 0)
      });

      const channel = await inviteLogChannel(guild, database);
      if (channel) {
        await announce(channel, buildLeaveEmbed({
          user: member.user,
          stayedMs,
          inviter: knownInviter?.tag || null,
          inviterId: knownInviter?.id || null,
          inviteCode: lastJoin?.invite_code || null,
          isFake: markedFake,
          removal
        }));
      }
    } catch (error) {
      log.error('Error tracking a leave:', error);
    } finally {
      emitDashboardSync();
    }
  });
  client.on('guildCreate', (guild) => {
    emitDashboardSync();

    if (process.env.GUILD_ID) return;

    const { registerGuildCommands } = require('./client-ready');
    registerGuildCommands(guild.id, slashCommands, token).catch((error) => {
      log.warn(`Command registration for ${guild.id} failed:`, error.message || error);
    });
  });

  client.on('guildDelete', (guild) => {
    emitDashboardSync();

    if (guild?.available === false) return;

    log.warn(`Removed from guild ${guild?.name || guild?.id}`);
    notifyOwner(
      client,
      'kicked-from-guild',
      `Δεν είμαι πια στον **${guild?.name || guild?.id}**. Δεν μπορώ να γράψω εκεί για να παραπονεθώ, οπότε στο λέω από εδώ.`,
      { force: true, fields: [{ name: 'Server ID', value: String(guild?.id || 'άγνωστο') }] }
    ).catch(() => {});
  });
}

module.exports = { register };
