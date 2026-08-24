#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const { start, ROOT } = require('./harness');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-access-'));
process.env.DATA_DIR = tmp;
process.env.BOT_OWNER_ID = '1000';

const database = require(path.join(ROOT, 'src/database.js'));
const {
  isCommandAuthorized,
  restrictableCommands,
  isRestrictableCommand,
  roleIdsOf,
  RESTRICTABLE_CATEGORIES,
  NEVER_RESTRICTABLE
} = require(path.join(ROOT, 'src/utils/authorization.js'));

const { section, check, finish } = start();

const GUILD = 'g1';
const OWNER = '2000';

// Ο owner του server δεν κλειδώνεται ποτέ, οπότε τα δείγματα δεν είναι αυτός.
function caller(userId, roleIds = []) {
  return {
    inGuild: () => true,
    guildId: GUILD,
    guild: { id: GUILD, ownerId: OWNER },
    user: { id: userId },
    member: { roles: { cache: new Map(roleIds.map((id) => [id, { id }])) } }
  };
}

const addedBy = { id: OWNER, tag: 'owner#0001' };

section('Ποιες εντολές κλειδώνονται');
{
  const commands = new Map(Object.entries({
    clear: { category: 'Moderation', data: { name: 'clear', description: 'σβήνει' } },
    'wipe-channel': { category: 'Moderation', data: { name: 'wipe-channel', description: 'αδειάζει' } },
    'invite-logger': { category: 'Invites', data: { name: 'invite-logger', description: 'προσκλήσεις' } },
    addauthorized: { category: 'Admin', data: { name: 'addauthorized', description: 'δικαιώματα' } },
    play: { category: 'Music', data: { name: 'play', description: 'παίζει' } },
    help: { category: 'General', data: { name: 'help', description: 'βοήθεια' } }
  }));

  const names = restrictableCommands({ commands }).map((entry) => entry.name);

  check(names.includes('clear') && names.includes('wipe-channel'), 'το Moderation κλειδώνεται');
  check(names.includes('invite-logger'), 'το ίδιο και το Invites');
  check(!names.includes('play'), 'η μουσική μένει ανοιχτή σε όλους');
  check(!names.includes('help'), 'και το General επίσης');
  check(!names.includes('addauthorized'), 'η εντολή που μοιράζει δικαιώματα δεν κλειδώνεται ποτέ');
  check(NEVER_RESTRICTABLE.includes('addauthorized'), 'και είναι ρητά δηλωμένο, όχι σύμπτωση');

  const categories = restrictableCommands({ commands }).map((entry) => entry.category);
  check(
    categories.every((category, index) => index === 0 || categories.indexOf(category) === categories.lastIndexOf(category) || categories[index - 1] === category),
    'οι ίδιες κατηγορίες βγαίνουν μαζί, ώστε η λίστα να διαβάζεται ομαδοποιημένη'
  );

  check(!isRestrictableCommand({ category: 'Moderation' }), 'εντολή χωρίς όνομα δεν περνά');
  check(!isRestrictableCommand(null), 'ούτε τίποτα');
  check(RESTRICTABLE_CATEGORIES.length === 3, 'τρεις κατηγορίες, όπως συμφωνήθηκε');
}

section('Χωρίς καμία εγγραφή την τρέχουν όλοι');
{
  check(!database.hasAuthorizedEntriesForCommand(GUILD, 'clear'), 'η εντολή ξεκινά ξεκλείδωτη');
  check(
    !database.isAuthorizedPrincipal(GUILD, 'clear', 'u1', ['r1']),
    'κανείς δεν είναι στη λίστα, γιατί λίστα δεν υπάρχει'
  );
}

section('Ένας χρήστης στη λίστα κλειδώνει τους υπόλοιπους');
{
  database.addAuthorizedUser(GUILD, 'clear', { id: 'u1' }, addedBy);

  check(database.hasAuthorizedEntriesForCommand(GUILD, 'clear'), 'τώρα υπάρχει λίστα');
  check(isCommandAuthorized(caller('u1'), database, 'clear'), 'ο χρήστης της λίστας περνά');
  check(!isCommandAuthorized(caller('u2'), database, 'clear'), 'ο επόμενος δεν περνά');
  check(isCommandAuthorized(caller(OWNER), database, 'clear'), 'ο ιδιοκτήτης του server περνά πάντα');
  check(isCommandAuthorized(caller('1000'), database, 'clear'), 'το ίδιο και ο owner του bot');
}

section('Ένας ρόλος περνά σε όλα τα μέλη του');
{
  database.addAuthorizedUser(GUILD, 'wipe-channel', { id: 'role-mod' }, addedBy, 'role');

  check(
    isCommandAuthorized(caller('u5', ['role-mod']), database, 'wipe-channel'),
    'μέλος με τον ρόλο περνά, χωρίς να μπει ονομαστικά'
  );
  check(
    !isCommandAuthorized(caller('u5', ['role-other']), database, 'wipe-channel'),
    'άλλος ρόλος δεν αρκεί'
  );
  check(
    !isCommandAuthorized(caller('u5'), database, 'wipe-channel'),
    'και χωρίς ρόλους καθόλου, ούτε λόγος'
  );
  check(
    !isCommandAuthorized(caller('u5', ['role-mod']), database, 'clear'),
    'ο ρόλος ισχύει μόνο για την εντολή που του δόθηκε'
  );
  check(
    !database.isAuthorizedPrincipal('g2', 'wipe-channel', 'u5', ['role-mod']),
    'και μόνο σε αυτόν τον server'
  );
}

section('Διαβάζοντας τους ρόλους του καλούντος');
{
  check(roleIdsOf(caller('u1', ['a', 'b'])).length === 2, 'οι ρόλοι διαβάζονται από το member');
  check(roleIdsOf({ user: { id: 'u1' } }).length === 0, 'χωρίς member, καμία υπόθεση');
  check(roleIdsOf(null).length === 0, 'ούτε από το τίποτα');
}

section('Ό,τι γράφτηκε πριν τη στήλη μετράει ως χρήστης');
{
  database.db.prepare(`
    INSERT INTO command_authorized_users (guild_id, command_name, user_id, added_by_id, added_by_tag)
    VALUES (?, ?, ?, ?, ?)
  `).run(GUILD, 'invite-logger', 'legacy-user', OWNER, 'owner#0001');

  const row = database.listCommandAccess(GUILD).find((entry) => entry.user_id === 'legacy-user');
  check(row?.principal_type === 'user', 'γραμμή χωρίς principal_type διαβάζεται ως χρήστης, όχι ως ρόλος');
  check(isCommandAuthorized(caller('legacy-user'), database, 'invite-logger'), 'και εξακολουθεί να ισχύει');
}

section('Ο πίνακας που βλέπει το dashboard');
{
  const rows = database.listCommandAccess(GUILD);
  const role = rows.find((entry) => entry.user_id === 'role-mod');

  check(rows.length === 3, 'όλες οι εγγραφές του server, σε ένα ερώτημα');
  check(role?.principal_type === 'role', 'ο ρόλος ξεχωρίζει από τον χρήστη');
  check(rows.every((entry) => entry.command_name && entry.user_id), 'κάθε γραμμή ξέρει εντολή και σε ποιον');
}

section('Αλλαγή τύπου χωρίς διπλή εγγραφή');
{
  database.addAuthorizedUser(GUILD, 'clear', { id: 'u1' }, addedBy, 'role');
  const forClear = database.listCommandAccess(GUILD).filter((entry) => entry.command_name === 'clear');

  check(forClear.length === 1, 'το ίδιο id δεν γράφεται δεύτερη φορά');
  check(forClear[0].principal_type === 'role', 'αλλά ο τύπος του ενημερώνεται');

  database.addAuthorizedUser(GUILD, 'clear', { id: 'u1' }, addedBy);
}

section('Ξεκλείδωμα');
{
  const removed = database.clearAuthorizedUsersForCommand(GUILD, 'clear');
  check(removed === 1, 'σβήνονται οι εγγραφές της εντολής');
  check(!database.hasAuthorizedEntriesForCommand(GUILD, 'clear'), 'και η εντολή ξαναγίνεται ανοιχτή');
  check(!isCommandAuthorized(caller('u1'), database, 'clear'), 'χωρίς λίστα, η πύλη δεν ρωτά καν');
  check(
    database.hasAuthorizedEntriesForCommand(GUILD, 'wipe-channel'),
    'και οι άλλες εντολές δεν πειράχτηκαν'
  );
}

section('Οι πραγματικές εντολές του bot');
{
  const dir = path.join(ROOT, 'src/commands');
  const commands = new Map();

  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const command = require(path.join(dir, file));
    if (command?.data?.name) commands.set(command.data.name, command);
  }

  const names = restrictableCommands({ commands }).map((entry) => entry.name);

  check(names.includes('clear'), 'το /clear κλειδώνεται');
  check(names.includes('wipe-channel'), 'το /wipe-channel κλειδώνεται');
  check(names.includes('invite-logger'), 'το /invite-logger κλειδώνεται');
  check(!names.includes('play') && !names.includes('skip'), 'η μουσική όχι');
  check(!names.includes('addauthorized'), 'ούτε η ίδια η εντολή των δικαιωμάτων');

  const logger = commands.get('invite-logger');
  const subcommands = (logger?.data?.toJSON?.().options || []).map((option) => option.name);
  check(subcommands.includes('disable'), 'το /invite-logger έχει disable για να σβήνει το κανάλι');

  const { PermissionFlagsBits } = require('discord.js');
  const adminBit = String(PermissionFlagsBits.Administrator);

  const wipe = commands.get('wipe-channel');
  String(wipe?.data?.toJSON?.().default_member_permissions) === adminBit
    ? check(true, 'το /wipe-channel το βλέπουν μόνο οι Administrators')
    : check(false, 'το /wipe-channel το βλέπουν μόνο οι Administrators');

  const clear = commands.get('clear');
  const clearSource = fs.readFileSync(path.join(dir, 'clear.js'), 'utf8');
  check(
    String(clear?.data?.toJSON?.().default_member_permissions) === String(PermissionFlagsBits.ManageMessages),
    'το /clear μένει σε Manage Messages, δηλαδή σε απλούστερα δικαιώματα'
  );
  check(
    /beforeDateStr && !isGuildAdmin\(interaction\)/.test(clearSource),
    'αλλά το before_date, που σβήνει χωρίς όριο, θέλει Administrator'
  );

  const auth = commands.get('addauthorized');
  const authJson = auth?.data?.toJSON?.() || {};
  const subs = new Map((authJson.options || []).map((option) => [option.name, option]));

  check(subs.has('user') && subs.has('role'), 'το /addauthorized χωρίζεται σε user και role');
  check(subs.has('list'), 'και δείχνει τι ισχύει με list');

  // Το ζητούμενο: διαλέγεις υποεντολή και μετά σου ζητά ΕΝΑΝ στόχο, όχι δύο
  // πεδία από τα οποία πρέπει να μαντέψεις ποιο να συμπληρώσεις.
  for (const name of ['user', 'role']) {
    const targets = (subs.get(name)?.options || []).filter((option) => option.name === 'target');
    check(targets.length === 1 && targets[0].required, `η /${name} ζητά έναν και μόνο στόχο, υποχρεωτικό`);
  }

  check(
    !(subs.get('user')?.options || []).some((option) => option.name === 'role'),
    'στην user δεν εμφανίζεται καν πεδίο ρόλου'
  );
  check(
    !(subs.get('role')?.options || []).some((option) => option.name === 'user'),
    'ούτε το αντίστροφο'
  );

  check(
    String(authJson.default_member_permissions) === adminBit,
    'και η ίδια η εντολή κρύβεται από όποιον δεν είναι Administrator'
  );

  check(
    String(commands.get('logs')?.data?.toJSON?.().default_member_permissions) === String(PermissionFlagsBits.ManageGuild),
    'το /logs κρύβεται από τα απλά μέλη'
  );

  // Το έβλεπαν όλοι και τους απαντούσε «δεν έχεις δικαίωμα» — χειρότερο από
  // το να μην το βλέπουν καθόλου.
  check(
    String(logger?.data?.toJSON?.().default_member_permissions) === String(PermissionFlagsBits.ManageGuild),
    'και το /invite-logger επίσης, αντί να τους λέει όχι αφού το πατήσουν'
  );
}

section('Το 24/7 ρυθμίζεται, δεν είναι κλειδωμένο στον owner');
{
  const dir = path.join(ROOT, 'src/commands');
  const commands = new Map();

  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const command = require(path.join(dir, file));
    if (command?.data?.name) commands.set(command.data.name, command);
  }

  check(
    restrictableCommands({ commands }).some((entry) => entry.name === '247'),
    'το /247 μπορεί να δοθεί σε χρήστες και ρόλους'
  );

  const source = fs.readFileSync(path.join(dir, '247.js'), 'utf8');
  check(
    /isGuildAdmin\(ctx\) && !isCommandAuthorized\(ctx, database, '247'\)/.test(source),
    'το τρέχουν οι Administrators, και όποιος έχει οριστεί ρητά'
  );
  check(
    !/canManageAuthorization/.test(source),
    'και όχι πια μόνο ο ιδιοκτήτης, όπως ήταν καρφωμένο'
  );

  // Δεν παίρνει default_member_permissions: θα το έκρυβε από τον ρόλο στον
  // οποίο μόλις το έδωσες.
  check(
    !commands.get('247')?.data?.toJSON?.().default_member_permissions,
    'μένει ορατό, αλλιώς μια παραχώρηση σε ρόλο δεν θα φαινόταν πουθενά'
  );
}

try { database.close(); } catch { /* already closed */ }
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir */ }

finish('οι εντολές κλειδώνουν σε χρήστες και ρόλους');
