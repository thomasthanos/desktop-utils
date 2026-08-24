#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const { start, ROOT } = require('./harness');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quiptest-'));
process.env.DATA_DIR = tmp;

const { section, finish, check } = start();
const { clearQuip, summarize, capKey } = require(path.join(ROOT, 'src/ai/quip'));
const database = require(path.join(ROOT, 'src/database'));


const SECRETS = ['μυστικο-κειμενο', 'evil.example', 'photo.png'];
const sample = [
  { authorId: 'a', content: 'μυστικο-κειμενο', createdAt: '2026-08-10T10:00:00Z', attachments: [] },
  { authorId: 'b', content: 'δες https://evil.example/x', createdAt: '2026-08-12T10:00:00Z', attachments: [] },
  { authorId: 'a', content: '', createdAt: '2026-08-14T10:00:00Z', attachments: [{ name: 'photo.png' }] }
];

const leaks = (text) => SECRETS.filter((s) => String(text).includes(s));

async function main() {
  section('summarize — συγκεντρωτικά, τοπικά');
  const facts = summarize(sample);
  check(facts.count === 3, `count=${facts.count}`);
  check(facts.authors === 2, `authors=${facts.authors}`);
  check(facts.withFiles === 1, `withFiles=${facts.withFiles}`);
  check(facts.withLinks === 1, `withLinks=${facts.withLinks}`);
  check(facts.spanDays === 4, `spanDays=${facts.spanDays}`);
  check(summarize([]) === null, 'άδεια λίστα δίνει null, όχι μηδενικά');
  check(leaks(JSON.stringify(facts)).length === 0, 'τα facts δεν περιέχουν περιεχόμενο μηνυμάτων');

  section('τι φεύγει στο δίκτυο');
  let sent = null;
  const spy = async (url, init) => {
    sent = { url, body: init.body };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: ' "Καθάρισε το χάος." ' }] } }] }) };
  };
  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_QUIP_DAILY = '100';
  database.setStat(capKey(), '0');

  const line = await clearQuip(facts, database, { fetch: spy, apiKey: 'TEST-KEY' });
  check(line === 'Καθάρισε το χάος.', `εισαγωγικά και κενά καθαρίζονται: ${JSON.stringify(line)}`);
  check(leaks(sent.body).length === 0, 'ΤΟ ΣΩΜΑ ΤΟΥ ΑΙΤΗΜΑΤΟΣ ΔΕΝ ΠΕΡΙΕΧΕΙ ΠΕΡΙΕΧΟΜΕΝΟ ΜΗΝΥΜΑΤΩΝ');
  check(!sent.body.includes('TEST-KEY'), 'το κλειδί δεν μπαίνει στο σώμα');
  check(JSON.parse(sent.body).generationConfig.maxOutputTokens === 40, 'maxOutputTokens=40');
  check(sent.body.length < 800, `το αίτημα μένει μικρό (${sent.body.length} χαρακτήρες)`);

  section('κάθε αποτυχία δίνει null, ποτέ εξαίρεση');
  check(await clearQuip(facts, database, { fetch: async () => { throw new Error('down'); }, apiKey: 'K' }) === null, 'σφάλμα δικτύου');
  check(await clearQuip(facts, database, { fetch: async () => ({ ok: false, status: 429 }), apiKey: 'K' }) === null, 'HTTP 429');
  check(await clearQuip(facts, database, { fetch: spy, apiKey: null }) === null, 'χωρίς κλειδί — καμία κλήση');
  check(await clearQuip(null, database, { fetch: spy, apiKey: 'K' }) === null, 'χωρίς στοιχεία');
  const flood = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'α'.repeat(300) }] } }] }) });
  check(await clearQuip(facts, database, { fetch: flood, apiKey: 'K' }) === null, 'απάντηση-σεντόνι απορρίπτεται');

  section('ημερήσιο πλαφόν');
  process.env.AI_QUIP_DAILY = '2';
  database.setStat(capKey(), '0');
  let allowed = 0;
  for (let i = 0; i < 5; i++) if (await clearQuip(facts, database, { fetch: spy, apiKey: 'K' })) allowed++;
  check(allowed === 2, `με πλαφόν 2 πέρασαν ${allowed} από 5 κλήσεις`);

  process.env.AI_QUIP_DAILY = '0';
  database.setStat(capKey(), '0');
  check(await clearQuip(facts, database, { fetch: spy, apiKey: 'K' }) === null, 'πλαφόν 0 απενεργοποιεί εντελώς τη λειτουργία');

  try { database.close(); } catch {}
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  finish('όλοι οι έλεγχοι της ατάκας πέρασαν');
}

main();
