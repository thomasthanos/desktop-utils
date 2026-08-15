#!/usr/bin/env node
/**
 * Έλεγχοι για τις εντολές και τις απαντήσεις σε DM.
 *
 *   npm run test:dm
 *
 * Χωρίς σύνδεση στο Discord.
 */
const path = require('path');
const crypto = require('crypto');
const { Client, Collection } = require('discord.js');

const { start, ROOT } = require('./harness');
const { loadCommands, toDmCommand } = require(path.join(ROOT, 'src/command-loader.js'));
const { buildReply } = require(path.join(ROOT, 'src/dm-replies.js'));

const { pass, fail, section, finish } = start();

const client = new Client({ intents: [] });
client.commands = new Collection();
const { slashCommands, dmCommands } = loadCommands(client);

section('ποιες εντολές φτάνουν στα DM');
{
  // ΣΚΛΗΡΗ ΔΗΛΩΣΗ. Οι εντολές που σβήνουν μηνύματα ή δίνουν δικαιώματα δεν
  // πρέπει να είναι προσβάσιμες από ιδιωτική συνομιλία, όπου δεν υπάρχει
  // guild για να ελεγχθούν τα δικαιώματα. Αν κάποιος βάλει `dmCapable: true`
  // σε μία από αυτές, το τεστ σκάει.
  const FORBIDDEN = ['clear', 'wipe-channel', 'addauthorized', 'removeauthorized', 'listauthorized'];
  const leaked = dmCommands.map((c) => c.name).filter((n) => FORBIDDEN.includes(n));
  leaked.length === 0
    ? pass('no destructive or permission command is DM-capable')
    : fail(`these must never be DM-capable: ${leaked.join(', ')}`);

  dmCommands.length > 0
    ? pass(`${dmCommands.length} command(s) registered for DMs: ${dmCommands.map((c) => c.name).join(', ')}`)
    : fail('no DM commands at all — the global registration would be pointless');

  // Κάθε εντολή DM πρέπει να έχει και τα δύο. Λείποντας το `contexts`, η
  // καθολική εκδοχή εμφανίζεται ΚΑΙ μέσα στους servers, δίπλα στην guild
  // εκδοχή — η ίδια εντολή δύο φορές στη λίστα.
  const badContexts = dmCommands.filter(
    (c) => JSON.stringify(c.contexts) !== '[1]' || JSON.stringify(c.integration_types) !== '[0]'
  );
  badContexts.length === 0
    ? pass('every DM command is contexts:[BotDM] + integration_types:[GuildInstall]')
    : fail(`wrong contexts on: ${badContexts.map((c) => c.name).join(', ')}`);

  // Το PrivateChannel (2) θέλει user-install, που είναι άλλη ροή εγκατάστασης.
  dmCommands.some((c) => c.contexts?.includes(2))
    ? fail('PrivateChannel context requires a user-install flow we do not have')
    : pass('no command claims the PrivateChannel context');

  // Ό,τι δηλώνεται dmCapable πρέπει να το χειρίζεται και ο router.
  const declared = [...client.commands.values()].filter((c) => c.dmCapable).map((c) => c.data.name);
  declared.length === dmCommands.length
    ? pass('the loader picked up every dmCapable module')
    : fail(`declared ${declared.join(', ')} but registered ${dmCommands.map((c) => c.name).join(', ')}`);
}

section('η παγίδα του commands_hash');
{
  // Η καταχώρηση παραλείπεται όταν ταιριάζει το hash. Αν το καθολικό σύνολο
  // δεν μπει μέσα του, μια αλλαγή ΜΟΝΟ στις εντολές DM αφήνει το hash ίδιο, η
  // καταχώρηση παραλείπεται ολόκληρη, και η εντολή δεν εμφανίζεται ποτέ —
  // χωρίς κανένα σφάλμα πουθενά. Αόρατο μέχρι το production.
  const hash = (commands, dm, guilds) => crypto
    .createHash('sha256')
    .update(JSON.stringify({ commands, dm, guilds: [...guilds].sort() }))
    .digest('hex');

  const guilds = ['g1', 'g2'];
  const base = hash(slashCommands, dmCommands, guilds);
  const changedDm = hash(slashCommands, [...dmCommands, toDmCommand({ name: 'ask', description: 'x' })], guilds);
  const sameInput = hash(slashCommands, dmCommands, ['g2', 'g1']);

  base !== changedDm
    ? pass('changing only the DM commands changes the hash')
    : fail('the hash ignores the DM commands — registration would be silently skipped');
  base === sameInput
    ? pass('guild order does not change the hash')
    : fail('guild order leaks into the hash, forcing pointless re-registration');
}

section('toDmCommand');
{
  const out = toDmCommand({ name: 'x', description: 'd', options: [{ name: 'o' }] });
  JSON.stringify(out.options) === '[{"name":"o"}]' && out.name === 'x' && out.description === 'd'
    ? pass('the original fields survive')
    : fail(`fields lost: ${JSON.stringify(out)}`);

  const original = { name: 'x', description: 'd' };
  toDmCommand(original);
  original.contexts === undefined
    ? pass('the guild version is not mutated')
    : fail('toDmCommand mutated its input — the guild registration would inherit the DM contexts');
}

section('απαντήσεις σε DM');
{
  // Κάθε κλάδος ελέγχεται με ΔΙΚΟ του διακριτικό δείγμα. Η πρώτη εκδοχή
  // έψαχνε /help/i παντού, που υπάρχει και στην εφεδρική απάντηση — οπότε
  // κάθε αποτυχία αναγνώρισης περνούσε για επιτυχία.
  const cases = [
    ['γεια', /^Γεια! 👋/, 'a Greek greeting'],
    ['καλημέρα σου', /^Γεια! 👋/, 'a Greek good morning'],
    ['Hello there', /^Γεια! 👋/, 'an English greeting'],
    ['ευχαριστώ πολύ', /^Τίποτα!/, 'thanks in Greek'],
    ['thanks a lot', /^Τίποτα!/, 'thanks in English'],
    ['τι εντολές έχεις;', /^Γράψε `\/help` εδώ/, 'asking for commands in Greek'],
    ['what commands do you have', /^Γράψε `\/help` εδώ/, 'asking for commands in English'],
    ['asdfghjkl', /^Δεν κατάλαβα/, 'nonsense'],
    ['this is a sentence', /^Δεν κατάλαβα/, 'a plain sentence does not look like a greeting'],
    ['', /^Δεν κατάλαβα/, 'an empty message'],
    [null, /^Δεν κατάλαβα/, 'a missing message']
  ];
  for (const [input, expected, label] of cases) {
    expected.test(buildReply(input))
      ? pass(`${label} gets a useful reply`)
      : fail(`${label}: got ${JSON.stringify(buildReply(input))}`);
  }

  // Κάθε απάντηση πρέπει να δείχνει κάπου. Μια απάντηση που λέει «δεν
  // κατάλαβα» και τίποτα άλλο αφήνει τον χρήστη στο ίδιο σημείο.
  const all = cases.map(([i]) => buildReply(i));
  all.every((r) => r.length > 0 && r.length < 400)
    ? pass('replies are non-empty and short')
    : fail('a reply is empty or too long');
}

finish('όλοι οι έλεγχοι DM πέρασαν');
