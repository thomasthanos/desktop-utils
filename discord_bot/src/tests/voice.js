#!/usr/bin/env node
/**
 * Έλεγχοι για την αποσύνδεση από άδειο κανάλι.
 *
 *   npm run test:voice
 *
 * Η μηχανή χρονομέτρησης τρέχει με 20ms αντί για 5 λεπτά — γι' αυτό ακριβώς
 * είναι ξεχωρισμένη από το wiring του Discord.
 */
const path = require('path');

const { start, ROOT } = require('./harness');
const { createEmptyChannelWatcher } = require(path.join(ROOT, 'src/events/voice-state.js'));
const { emptyGraceMs } = require(path.join(ROOT, 'src/utils/voice.js'));

const { pass, fail, section, finish } = start();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Αρκετά μικρό ώστε το τεστ να τελειώνει σε δευτερόλεπτα, αρκετά μεγάλο ώστε
// να μην το χαλάει η ανάλυση των timers των Windows (~15ms).
const GRACE = 150;

/** Στήνει έναν watcher που μετράει πόσες φορές πυροδότησε. */
function harness(stillEmpty = () => true) {
  const fired = [];
  const watcher = createEmptyChannelWatcher({
    graceMs: GRACE,
    stillEmpty,
    onEmpty: (guildId) => { fired.push(guildId); }
  });
  return { watcher, fired };
}

async function main() {
  section('emptyGraceMs');
  {
    const saved = process.env.VOICE_EMPTY_GRACE_MS;

    delete process.env.VOICE_EMPTY_GRACE_MS;
    emptyGraceMs() === 300000
      ? pass('defaults to five minutes')
      : fail(`default was ${emptyGraceMs()}`);

    process.env.VOICE_EMPTY_GRACE_MS = '1000';
    emptyGraceMs() === 1000 ? pass('env var honoured') : fail(`env var ignored: ${emptyGraceMs()}`);

    process.env.VOICE_EMPTY_GRACE_MS = '0';
    // Το μηδέν είναι έγκυρο (η παλιά συμπεριφορά), όχι «άδειο».
    emptyGraceMs() === 0 ? pass('zero is a valid value, not a missing one') : fail('zero fell back');

    process.env.VOICE_EMPTY_GRACE_MS = 'banana';
    emptyGraceMs() === 300000 ? pass('garbage falls back to the default') : fail('garbage accepted');

    process.env.VOICE_EMPTY_GRACE_MS = '-5';
    emptyGraceMs() === 300000 ? pass('negative falls back to the default') : fail('negative accepted');

    if (saved === undefined) delete process.env.VOICE_EMPTY_GRACE_MS;
    else process.env.VOICE_EMPTY_GRACE_MS = saved;
  }

  section('άδειο -> πυροδοτεί μία φορά');
  {
    const { watcher, fired } = harness();
    watcher.evaluate('g1', true);
    await sleep(GRACE * 4);
    fired.length === 1 ? pass('fired exactly once') : fail(`fired ${fired.length} time(s)`);
    watcher.pending === 0 ? pass('no timer left behind') : fail(`${watcher.pending} timer(s) still pending`);
  }

  section('άδειο -> επιστροφή -> ΠΟΤΕ');
  {
    const { watcher, fired } = harness();
    watcher.evaluate('g1', true);
    await sleep(GRACE / 2);
    watcher.evaluate('g1', false);
    await sleep(GRACE * 4);
    fired.length === 0 ? pass('coming back cancels the countdown') : fail(`fired ${fired.length} time(s)`);
    watcher.pending === 0 ? pass('the cancelled timer is gone') : fail('a timer survived the cancel');
  }

  section('άδειο -> επιστροφή -> άδειο -> μία φορά');
  {
    const { watcher, fired } = harness();
    watcher.evaluate('g1', true);
    await sleep(GRACE / 2);
    watcher.evaluate('g1', false);
    watcher.evaluate('g1', true);
    await sleep(GRACE * 4);
    fired.length === 1 ? pass('the second emptying starts a fresh countdown') : fail(`fired ${fired.length} time(s)`);
  }

  section('μπαινοβγαίνει χωρίς να αδειάσει ποτέ');
  {
    // Ένας που ξαναπατάει «άδειο» δεν πρέπει να ΞΑΝΑΡΧΙΖΕΙ τη χάρη, αλλιώς
    // αρκεί κάποιος να μπαινοβγαίνει για να μη φύγει ποτέ το bot.
    const { watcher, fired } = harness();
    watcher.evaluate('g1', true);
    // Είκοσι ακόμα «άδειο» μέσα στη μισή χάρη. Αν το evaluate ξανάρχιζε τον
    // χρονομετρητή, η προθεσμία θα έσπρωχνε συνεχώς μπροστά.
    for (let i = 0; i < 10; i++) watcher.evaluate('g1', true);
    await sleep(GRACE / 2);
    for (let i = 0; i < 10; i++) watcher.evaluate('g1', true);

    watcher.pending === 1 ? pass('still exactly one timer') : fail(`${watcher.pending} timers`);
    fired.length === 0 ? pass('has not fired early') : fail('fired before the grace elapsed');

    await sleep(GRACE * 3);
    fired.length === 1
      ? pass('the deadline was never pushed back')
      : fail(`fired ${fired.length} time(s) — the timer is being restarted`);
  }

  section('ξαναέλεγχος τη στιγμή που χτυπάει');
  {
    // Άμυνα σε βάθος: ακόμα κι αν χαθεί ένα γεγονός επιστροφής, ο έλεγχος τη
    // στιγμή της πυροδότησης εμποδίζει αποσύνδεση με κόσμο μέσα.
    const { watcher, fired } = harness(() => false);
    watcher.evaluate('g1', true);
    await sleep(GRACE * 4);
    fired.length === 0
      ? pass('a channel that refilled silently is not disconnected')
      : fail('disconnected despite the recheck saying otherwise');
  }

  section('ανεξάρτητα guilds');
  {
    const { watcher, fired } = harness();
    watcher.evaluate('g1', true);
    watcher.evaluate('g2', true);
    await sleep(GRACE / 2);
    watcher.evaluate('g1', false);
    await sleep(GRACE * 4);
    fired.length === 1 && fired[0] === 'g2'
      ? pass('one guild returning does not save the other')
      : fail(`fired: ${JSON.stringify(fired)}`);
  }

  section('clearAll');
  {
    const { watcher, fired } = harness();
    watcher.evaluate('g1', true);
    watcher.evaluate('g2', true);
    watcher.pending === 2 ? pass('two timers pending') : fail(`pending was ${watcher.pending}`);
    watcher.clearAll();
    watcher.pending === 0 ? pass('clearAll empties the map') : fail('clearAll left timers behind');
    await sleep(GRACE * 4);
    fired.length === 0 ? pass('cleared timers never fire') : fail(`fired ${fired.length} time(s)`);
  }

  finish('όλοι οι έλεγχοι φωνής πέρασαν');
}

main();
