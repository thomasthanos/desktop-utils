#!/usr/bin/env node
/**
 * Έλεγχοι για τους βοηθούς μουσικής και την αποθηκευμένη κατάσταση του
 * ραδιοφώνου.
 *
 *   node src/tests/run.js music
 *
 * Καθαρή λογική, χωρίς σύνδεση στο Discord — τρέχει παντού.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { start, ROOT } = require('./harness');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musictest-'));
const realDb = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'bot.db');
if (fs.existsSync(realDb)) fs.copyFileSync(realDb, path.join(tmp, 'bot.db'));
process.env.DATA_DIR = tmp;

const { pass, fail, section, finish } = start();

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  a === e ? pass(`${label} -> ${a}`) : fail(`${label}: got ${a}, expected ${e}`);
}

const { parseTimestamp, formatDuration, buildProgressBar, trackDurationMs } = require(
  path.join(ROOT, 'src/utils/music.js')
);

section('parseTimestamp');
eq('bare seconds "90"', parseTimestamp('90'), 90000);
eq('mm:ss "1:30"', parseTimestamp('1:30'), 90000);
eq('h:mm:ss "1:02:03"', parseTimestamp('1:02:03'), 3723000);
eq('compact "1m30s"', parseTimestamp('1m30s'), 90000);
eq('compact "2h"', parseTimestamp('2h'), 7200000);
eq('compact "45s"', parseTimestamp('45s'), 45000);
eq('zero "0"', parseTimestamp('0'), 0);
eq('whitespace tolerated', parseTimestamp('  1:30  '), 90000);
eq('garbage rejected', parseTimestamp('banana'), null);
eq('empty rejected', parseTimestamp(''), null);
eq('negative rejected', parseTimestamp('-5:00'), null);
eq('null rejected', parseTimestamp(null), null);

section('formatDuration');
eq('90s', formatDuration(90000), '1:30');
eq('under a minute pads', formatDuration(5000), '0:05');
eq('over an hour', formatDuration(3723000), '1:02:03');
eq('zero', formatDuration(0), '0:00');
eq('negative is unknown', formatDuration(-1), '--:--');
eq('NaN is unknown', formatDuration(NaN), '--:--');

section('round trip parse -> format');
for (const value of ['0:30', '1:30', '10:00', '1:02:03']) {
  const back = formatDuration(parseTimestamp(value));
  back === value.replace(/^0:(\d)/, '0:$1')
    ? pass(`${value} survives the round trip`)
    : fail(`${value} became ${back}`);
}

section('buildProgressBar');
const bar = buildProgressBar(0, 100000);
bar.startsWith('🔘') ? pass('at position 0 the marker is first') : fail(`start: ${bar}`);
const endBar = buildProgressBar(100000, 100000);
endBar.endsWith('🔘') ? pass('at the end the marker is last') : fail(`end: ${endBar}`);
buildProgressBar(50000, 0) === '🔴 LIVE'
  ? pass('unknown duration renders as LIVE')
  : fail('zero duration should render as LIVE');
[...buildProgressBar(30000, 100000)].length === [...bar].length
  ? pass('bar width is constant')
  : fail('bar width varies with position');

section('trackDurationMs');
eq('from durationMS', trackDurationMs({ durationMS: 5000 }), 5000);
eq('from "3:07" string', trackDurationMs({ duration: '3:07' }), 187000);
eq('from "1:02:03" string', trackDurationMs({ duration: '1:02:03' }), 3723000);
eq('missing track', trackDurationMs(null), 0);
eq('LIVE has no duration', trackDurationMs({ duration: 'LIVE' }), 0);

section('persisted idle state (auto-resume after restart)');
const database = require(path.join(ROOT, 'src/database.js'));
try {
  database.setIdleState('guild-a', { voiceChannelId: 'vc-1', textChannelId: 'tc-1', active: true });
  database.setIdleState('guild-b', { voiceChannelId: 'vc-2', textChannelId: null, active: true });
  database.setIdleState('guild-c', { voiceChannelId: 'vc-3', textChannelId: 'tc-3', active: false });

  const rows = database.getIdleStatesToRestore();
  const ids = rows.map((r) => r.guild_id).sort();
  eq('only active guilds are restored', ids, ['guild-a', 'guild-b']);

  const a = rows.find((r) => r.guild_id === 'guild-a');
  eq('voice channel persisted', a.active_voice_channel, 'vc-1');
  eq('text channel persisted', a.active_text_channel, 'tc-1');

  database.setIdleState('guild-a', { voiceChannelId: null, textChannelId: null, active: false });
  database.getIdleStatesToRestore().some((r) => r.guild_id === 'guild-a')
    ? fail('stopping the radio should clear it from the restore list')
    : pass('stopping the radio clears it from the restore list');

  // Το setIdleState δεν πρέπει να πατάει την ένταση ενός guild που ήδη υπάρχει.
  database.setGuildVolume('guild-vol', 33);
  database.setIdleState('guild-vol', { voiceChannelId: 'vc-9', textChannelId: null, active: true });
  database.getGuildVolume('guild-vol') === 33
    ? pass('setIdleState preserves the saved volume')
    : fail(`volume was clobbered: ${database.getGuildVolume('guild-vol')}`);

  // Οι στήλες πρέπει να προστίθενται σε ΥΠΑΡΧΟΥΣΑ βάση, όχι μόνο σε νέα.
  const cols = database.db.prepare('PRAGMA table_info(guild_settings)').all().map((c) => c.name);
  ['active_voice_channel', 'active_text_channel', 'idle_active'].every((c) => cols.includes(c))
    ? pass('schema migration added all three columns')
    : fail(`guild_settings columns: ${cols.join(', ')}`);
} catch (err) {
  fail(`idle state: ${err.message}`);
}

// --- utils/voice.js ---------------------------------------------------------
const { countHumans, isVoiceEmpty, buildNodeOptions } = require(path.join(ROOT, 'src/utils/voice.js'));

// Ό,τι μοιάζει αρκετά με Collection ώστε να δουλέψει το .filter().size
const channelWith = (members) => ({
  members: { filter: (fn) => ({ size: members.filter(fn).length }) }
});
const human = (id) => ({ user: { bot: false, id } });
const bot = (id) => ({ user: { bot: true, id } });

section('countHumans / isVoiceEmpty');
eq('two humans + one bot', countHumans(channelWith([human('a'), bot('b'), human('c')])), 2);
eq('only bots counts zero', countHumans(channelWith([bot('a'), bot('b'), bot('c')])), 0);
// Τρία bots και κανένας άνθρωπος ΕΙΝΑΙ άδειο — αλλιώς το bot θα κρατούσε
// συντροφιά σε άλλο bot επ' άπειρον.
isVoiceEmpty(channelWith([bot('a'), bot('b'), bot('c')]))
  ? pass('three bots and no humans is empty')
  : fail('three bots should count as empty');
isVoiceEmpty(channelWith([human('a'), bot('b')]))
  ? fail('one human should not be empty')
  : pass('one human is not empty');
// Ανύπαρκτο κανάλι δεν είναι «άδειο», είναι «άγνωστο» — ίδια σημασιολογία με
// το Util.isVoiceEmpty του discord-player. Αν επέστρεφε true, κάθε έλεγχος
// πάνω σε bot εκτός φωνής θα πυροδοτούσε αποσύνδεση χωρίς νόημα.
isVoiceEmpty(null) || isVoiceEmpty(undefined) || isVoiceEmpty({})
  ? fail('a missing channel must not report as empty')
  : pass('a missing channel is not empty');

section('buildNodeOptions');
try {
  const fakeDb = { getGuildVolume: () => 42 };
  const opts = buildNodeOptions(fakeDb, 'guild-1', { channel: 'text-1' });

  eq('metadata passed through', opts.metadata, { channel: 'text-1' });
  eq('volume read from the database', opts.volume, 42);
  eq('leaveOnEnd', opts.leaveOnEnd, true);
  eq('leaveOnEndCooldown', opts.leaveOnEndCooldown, 300000);
  eq('leaveOnStop', opts.leaveOnStop, true);
  eq('leaveOnStopCooldown', opts.leaveOnStopCooldown, 120000);
  // Ρητό, όχι σιωπηλή προεπιλογή: το discord-player έβαζε cooldown 0, δηλαδή
  // αποσύνδεση τη στιγμή που έφευγε ο τελευταίος.
  eq('leaveOnEmpty', opts.leaveOnEmpty, true);
  eq('leaveOnEmptyCooldown is five minutes', opts.leaveOnEmptyCooldown, 300000);

  const overridden = buildNodeOptions(fakeDb, 'guild-1', null, { volume: 7, leaveOnEnd: false });
  overridden.volume === 7 && overridden.leaveOnEnd === false
    ? pass('overrides win over the defaults')
    : fail(`overrides ignored: ${JSON.stringify(overridden)}`);

  // Ο λόγος ύπαρξης του helper: ΕΝΑ σημείο αλήθειας. Αν ξαναγραφτεί κάπου
  // αλλού ένα leaveOn*, οι Φάσεις 2-3 θα αλλάξουν τη μία εκδοχή και όχι την
  // άλλη, και η διαφορά δεν θα φαίνεται πουθενά.
  const srcFiles = ['src/commands/play.js', 'src/idle-pending.js', 'src/events/player-events.js'];
  const strays = srcFiles.filter((f) => /leaveOn(End|Stop|Empty)\s*:/.test(
    fs.readFileSync(path.join(ROOT, f), 'utf8')
  ));
  strays.length === 0
    ? pass('no call site declares leaveOn* inline')
    : fail(`inline leaveOn* still present in: ${strays.join(', ')}`);
} catch (err) {
  fail(`buildNodeOptions: ${err.message}`);
}

// --- διακόπτης 24/7 ---------------------------------------------------------
section('24/7 switch');
try {
  const { applyStay247 } = require(path.join(ROOT, 'src/utils/voice.js'));

  eq('defaults to off', database.getStay247('g247'), false);
  eq('setStay247 returns the new value', database.setStay247('g247', true), true);
  eq('and it reads back', database.getStay247('g247'), true);
  eq('turning it off again', database.setStay247('g247', false), false);
  eq('reads back as off', database.getStay247('g247'), false);

  // Οι δύο ρυθμίσεις μοιράζονται γραμμή στον ίδιο πίνακα. Ένα κοινό
  // «γράψε τα πάντα» θα πάταγε τη μία με ό,τι είχε ο caller για την άλλη.
  database.setGuildVolume('g247', 77);
  database.setStay247('g247', true);
  eq('setStay247 does not touch the volume', database.getGuildVolume('g247'), 77);
  database.setGuildVolume('g247', 88);
  eq('setGuildVolume does not touch the 24/7 flag', database.getStay247('g247'), true);
  eq('and the volume really did change', database.getGuildVolume('g247'), 88);

  const cols247 = database.db.prepare('PRAGMA table_info(guild_settings)').all().map((c) => c.name);
  cols247.includes('stay_24_7')
    ? pass('the column is added to an existing database')
    : fail(`stay_24_7 missing; columns: ${cols247.join(', ')}`);

  // ΤΟ κρίσιμο τεστ. Ακυρώνοντας μόνο το leaveOnEmpty, το 24/7 θα «δούλευε»
  // και το bot θα έφευγε ούτως ή άλλως 5 λεπτά μετά το τελευταίο τραγούδι —
  // σε γεμάτο κανάλι, χωρίς κανένα ορατό αίτιο.
  const staying = buildNodeOptions(database, 'g247', null);
  staying.leaveOnEnd === false && staying.leaveOnStop === false && staying.leaveOnEmpty === false
    ? pass('with 24/7 on, all three leaveOn* are false')
    : fail(`24/7 left one enabled: ${JSON.stringify({
      end: staying.leaveOnEnd, stop: staying.leaveOnStop, empty: staying.leaveOnEmpty
    })}`);

  database.setStay247('g247', false);
  const leaving = buildNodeOptions(database, 'g247', null);
  leaving.leaveOnEnd && leaving.leaveOnStop && leaving.leaveOnEmpty
    ? pass('with 24/7 off, all three are back on')
    : fail(`24/7 off did not restore: ${JSON.stringify(leaving)}`);

  // Οι ρυθμίσεις της ουράς παγώνουν στη δημιουργία, οπότε το /247 πρέπει να
  // πειράξει και την ΕΝΕΡΓΗ ουρά — αλλιώς «δουλεύει» και το bot φεύγει μπροστά
  // στα μάτια σου.
  const fakeTimers = new Map([['empty_g247', setTimeout(() => {}, 60000)], ['other', setTimeout(() => {}, 60000)]]);
  const fakeQueue = { options: { leaveOnEnd: true, leaveOnStop: true, leaveOnEmpty: true }, timeouts: fakeTimers };
  applyStay247(fakeQueue, true);
  fakeQueue.options.leaveOnEnd === false
    && fakeQueue.options.leaveOnStop === false
    && fakeQueue.options.leaveOnEmpty === false
    ? pass('applyStay247 mutates a live queue')
    : fail(`live queue not updated: ${JSON.stringify(fakeQueue.options)}`);
  !fakeTimers.has('empty_g247') && fakeTimers.has('other')
    ? pass('a countdown already running is cancelled, unrelated timers are left alone')
    : fail(`timeouts after applyStay247: ${[...fakeTimers.keys()].join(', ')}`);
  for (const t of fakeTimers.values()) clearTimeout(t);

  applyStay247(null, true) === false
    ? pass('no queue is not an error')
    : fail('applyStay247 should report that there was no queue');
} catch (err) {
  fail(`24/7: ${err.message}`);
}

// --- ενοποιημένος ιδιοκτήτης ------------------------------------------------
section('owner id resolution');
try {
  const authPath = require.resolve(path.join(ROOT, 'src/utils/authorization.js'));
  const notifyPath = require.resolve(path.join(ROOT, 'src/utils/notify.js'));
  const savedId = process.env.BOT_OWNER_ID;
  const savedIds = process.env.BOT_OWNER_IDS;

  process.env.BOT_OWNER_ID = '111';
  process.env.BOT_OWNER_IDS = '222, 333';
  delete require.cache[authPath];
  delete require.cache[notifyPath];
  const { getBotOwnerIds, isBotOwner } = require(authPath);

  eq('both variables are unioned', getBotOwnerIds(), ['111', '222', '333']);
  // Η παλιά notify.js έκανε `IDS || ID`, οπότε το 111 έχανε τις ειδοποιήσεις
  // ενώ περνούσε κάθε έλεγχο εξουσιοδότησης. Αυτό είναι το τεστ γι' αυτό.
  isBotOwner('111') && getBotOwnerIds().includes('111')
    ? pass('an id listed only in BOT_OWNER_ID is both authorized and notifiable')
    : fail('BOT_OWNER_ID is dropped by one of the two paths');

  process.env.BOT_OWNER_ID = '111';
  process.env.BOT_OWNER_IDS = '111';
  eq('duplicates collapse', getBotOwnerIds(), ['111']);

  delete process.env.BOT_OWNER_ID;
  delete process.env.BOT_OWNER_IDS;
  eq('unset means nobody', getBotOwnerIds(), []);
  isBotOwner('111') ? fail('nobody should be owner when unset') : pass('nobody is owner when unset');

  if (savedId === undefined) delete process.env.BOT_OWNER_ID; else process.env.BOT_OWNER_ID = savedId;
  if (savedIds === undefined) delete process.env.BOT_OWNER_IDS; else process.env.BOT_OWNER_IDS = savedIds;
} catch (err) {
  fail(`owner ids: ${err.message}`);
}

try { database.close(); } catch { /* ήδη κλειστή */ }
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows lock */ }

finish('all music checks passed');
