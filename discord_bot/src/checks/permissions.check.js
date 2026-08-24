#!/usr/bin/env node
const path = require('path');
const { PermissionsBitField } = require('discord.js');

const { start, ROOT } = require('./harness');

process.env.BOT_OWNER_ID = '1000';

const {
  CAPABILITY_NAMES,
  capabilitiesFor,
  canManagePermissions,
  visibleGuilds,
  canSeeAnyGuild,
  everything
} = require(path.join(ROOT, 'src/utils/permissions.js'));

const { check, section, finish } = start();

const ROLES = {
  admin: PermissionsBitField.Flags.Administrator,
  manager: PermissionsBitField.Flags.ManageGuild,
  nobody: 0n
};

function member(role) {
  return { permissions: new PermissionsBitField(ROLES[role]) };
}

function makeClient(guilds) {
  return {
    guilds: {
      cache: new Map(Object.entries(guilds).map(([id, roster]) => [id, {
        id,
        name: `Guild ${id}`,
        iconURL: () => null,
        members: {
          cache: { get: (userId) => (roster[userId] ? member(roster[userId]) : undefined) },
          fetch: async () => { throw new Error('not cached'); }
        }
      }]))
    }
  };
}

function makeDatabase(overrides = {}) {
  return {
    getDashboardPermissions: (guildId, userId) => overrides[`${guildId}:${userId}`] || {}
  };
}

async function main() {
  const client = makeClient({
    g1: { u_admin: 'admin', u_manager: 'manager', u_plain: 'nobody' },
    g2: { u_manager: 'nobody' }
  });

  section('Roles decide by default');
  {
    const db = makeDatabase();

    const admin = await capabilitiesFor(client, db, 'g1', 'u_admin');
    check(CAPABILITY_NAMES.every((name) => admin[name]), 'Administrator gets every section');

    const manager = await capabilitiesFor(client, db, 'g1', 'u_manager');
    check(manager.view && manager.music && manager.commands && manager.invites, 'Manage Server opens the everyday sections');
    check(manager.transcripts === false, 'Manage Server stops at deleted messages');

    const plain = await capabilitiesFor(client, db, 'g1', 'u_plain');
    check(CAPABILITY_NAMES.every((name) => plain[name] === false), 'a member with no roles gets nothing');

    const stranger = await capabilitiesFor(client, db, 'g1', 'u_unknown');
    check(CAPABILITY_NAMES.every((name) => stranger[name] === false), 'a non-member gets nothing');

    const nowhere = await capabilitiesFor(client, db, 'g_missing', 'u_admin');
    check(CAPABILITY_NAMES.every((name) => nowhere[name] === false), 'an unknown guild grants nothing');
  }

  section('Overrides are exceptions, not rewrites');
  {
    const granted = makeDatabase({ 'g1:u_manager': { transcripts: true } });
    const withGrant = await capabilitiesFor(client, granted, 'g1', 'u_manager');
    check(withGrant.transcripts === true, 'an ON override grants past the role');
    check(withGrant.view === true, 'the other sections still follow the role');

    const revoked = makeDatabase({ 'g1:u_admin': { transcripts: false } });
    const withRevoke = await capabilitiesFor(client, revoked, 'g1', 'u_admin');
    check(withRevoke.transcripts === false, 'an OFF override revokes from an Administrator');

    const perGuild = makeDatabase({ 'g1:u_plain': { view: true } });
    const here = await capabilitiesFor(client, perGuild, 'g1', 'u_plain');
    const there = await capabilitiesFor(client, perGuild, 'g2', 'u_plain');
    check(here.view === true && there.view === false, 'an override applies to one server only');
  }

  section('The bot owner cannot be locked out');
  {
    const hostile = makeDatabase({ 'g1:1000': everything(false) });
    const owner = await capabilitiesFor(client, hostile, 'g1', '1000');
    check(CAPABILITY_NAMES.every((name) => owner[name]), 'overrides never apply to the bot owner');
    check(await canManagePermissions(client, hostile, 'g1', '1000'), 'the owner always manages permissions');
  }

  section('Managing permissions needs Administrator');
  {
    const empty = makeDatabase();
    check(await canManagePermissions(client, empty, 'g1', 'u_admin'), 'Administrator may manage');
    check(!await canManagePermissions(client, empty, 'g1', 'u_manager'), 'Manage Server may not');
    check(!await canManagePermissions(client, empty, 'g1', null), 'an anonymous session may not');
  }

  section('Turning the overview off actually locks an Administrator out');
  {
    // Αλλιώς άνοιγε τη σελίδα δικαιωμάτων και το ξανάναβε μόνος του.
    const blocked = makeDatabase({ 'g1:u_admin': { view: false } });
    check(!await canManagePermissions(client, blocked, 'g1', 'u_admin'), 'an explicit "no" takes the page away too');

    const caps = await capabilitiesFor(client, blocked, 'g1', 'u_admin');
    check(caps.view === false, 'and the overview itself is gone');

    const allowed = makeDatabase({ 'g1:u_admin': { view: true } });
    check(await canManagePermissions(client, allowed, 'g1', 'u_admin'), 'saying yes explicitly still manages');

    const owned = makeClient({ g1: { u_admin: 'admin' } });
    owned.guilds.cache.get('g1').ownerId = 'u_admin';
    check(
      await canManagePermissions(owned, blocked, 'g1', 'u_admin'),
      'but the server owner is never locked out, or nobody could undo it'
    );
  }

  section('You only see the servers you belong to');
  {
    const db = makeDatabase();

    const managerGuilds = await visibleGuilds(client, db, 'u_manager');
    check(
      managerGuilds.length === 1 && managerGuilds[0].id === 'g1',
      'a manager in one server does not see the other'
    );

    const plainGuilds = await visibleGuilds(client, db, 'u_plain');
    check(plainGuilds.length === 0, 'a member with no roles sees no server');

    const ownerGuilds = await visibleGuilds(client, db, '1000');
    check(ownerGuilds.length === 2, 'the owner sees every server');

    check(await canSeeAnyGuild(client, db, 'u_manager'), 'a manager may sign in');
    check(!await canSeeAnyGuild(client, db, 'u_plain'), 'a roleless member may not sign in');
    check(await canSeeAnyGuild(client, db, '1000'), 'the owner may always sign in');
  }

  section('A broken database never opens the door');
  {
    const exploding = {
      getDashboardPermissions: () => { throw new Error('db is down'); }
    };
    const manager = await capabilitiesFor(client, exploding, 'g1', 'u_manager');
    check(manager.view === true && manager.transcripts === false, 'it falls back to the Discord roles');
  }

  finish(`${CAPABILITY_NAMES.length} ενότητες, οι ρόλοι του server αποφασίζουν`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
