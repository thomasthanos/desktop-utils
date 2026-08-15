#!/usr/bin/env node
/**
 * Έλεγχοι για την ανάγνωση ημερομηνίας του /clear.
 *
 *   node src/tests/run.js dates
 *
 * Έχει σημασία περισσότερο από ό,τι φαίνεται: το `before_date` καθορίζει ΠΟΣΟ
 * πίσω σβήνονται μηνύματα, μη αναστρέψιμα. Μια ημερομηνία που διαβάζεται λάθος
 * σβήνει λάθος πράγματα, και η JavaScript δεν βοηθάει — το `new Date(2024, 1, 31)`
 * δεν αποτυγχάνει, γίνεται σιωπηλά 2 Μαρτίου.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { start } = require('./harness');

const { pass, fail, section, finish } = start();

const CLEAR = path.join(__dirname, '..', 'commands', 'clear.js');
const src = fs.readFileSync(CLEAR, 'utf8');

/** Βγάζει μία συνάρτηση από το clear.js μετρώντας αγκύλες. */
function extract(name) {
  const from = src.indexOf(`function ${name}(`);
  if (from === -1) throw new Error(`${name} not found in clear.js`);
  let depth = 0;
  let i = src.indexOf('{', from);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(from, i + 1);
}

const ctx = vm.createContext({ Date, Number, String, Math });
vm.runInContext([extract('buildDate'), extract('daysAgo'), extract('parseDate')].join('\n'), ctx);
const parse = (s) => vm.runInContext(`parseDate(${JSON.stringify(s)})`, ctx);

// ΤΟΠΙΚΗ ημερομηνία, όχι toISOString(): η parseDate δουλεύει σε τοπική ώρα και
// το UTC μπορεί να βρίσκεται σε άλλη ημερομηνία τη στιγμή του ελέγχου.
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

function accepts(input, expected) {
  const r = parse(input);
  if (!r.date) return fail(`"${input}" απορρίφθηκε: ${r.error}`);
  const got = ymd(r.date);
  if (expected && got !== expected) return fail(`"${input}" -> ${got}, περίμενα ${expected}`);
  pass(`"${input}" -> ${got}`);
}

function rejects(input, mustMention) {
  const r = parse(input);
  if (r.date) return fail(`"${input}" ΕΓΙΝΕ ΔΕΚΤΟ (${ymd(r.date)})`);
  if (mustMention && !String(r.error).toLowerCase().includes(mustMention.toLowerCase())) {
    return fail(`"${input}": το σφάλμα δεν αναφέρει "${mustMention}" — ${r.error}`);
  }
  pass(`"${input}" — ${r.error}`);
}

section('Σχετικές εκφράσεις');
accepts('σήμερα', back(0)); accepts('today', back(0));
accepts('χθες', back(1)); accepts('χτες', back(1)); accepts('yesterday', back(1));
accepts('7d', back(7)); accepts('7 days', back(7)); accepts('7 μέρες', back(7));
accepts('2w', back(14)); accepts('2 εβδομάδες', back(14));
accepts('3m', back(90)); accepts('3 μήνες', back(90));
accepts('1y', back(365)); accepts('1 χρόνο', back(365));

section('Απόλυτες ημερομηνίες');
accepts('2024-06-15', '2024-06-15');
accepts('2024/06/15', '2024-06-15');
accepts('15/06/2024', '2024-06-15');
accepts('15-06-2024', '2024-06-15');
accepts('15.06.2024', '2024-06-15');
accepts('15/06/24', '2024-06-15');
accepts('1/1/2024', '2024-01-01');
accepts('29/02/2024', '2024-02-29'); // δίσεκτο έτος

section('Πρέπει να απορρίπτονται');
// Το σημαντικότερο: παλιά γινόταν σιωπηλά 2 Μαρτίου και έσβηνε από λάθος σημείο.
rejects('31/02/2024', 'υπαρκτή');
rejects('29/02/2023', 'υπαρκτή'); // μη δίσεκτο
rejects('15/13/2024', 'μήνας');
rejects('32/01/2024', 'ημέρα');
rejects('2030-01-01', 'μέλλον');
rejects('99999 μέρες', '10 χρόνια');
rejects('αύριο');
rejects('banana');
rejects('');

finish('όλοι οι έλεγχοι ημερομηνίας πέρασαν');
