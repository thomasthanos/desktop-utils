const { activeProviderName, getApiKey, defaultModel } = require('./provider');
const log = require('../utils/logger')('quip');

const TIMEOUT_MS = 2500;

function dailyCap() {
  const raw = Number(process.env.AI_QUIP_DAILY);
  return Number.isFinite(raw) && raw >= 0 ? raw : 40;
}

function capKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `ai_quips_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function consumeCap(database) {
  const cap = dailyCap();
  if (cap === 0) return false;
  const key = capKey();
  const used = Number(database.getStat(key) || 0);
  if (used >= cap) return false;
  database.setStat(key, String(used + 1));
  return true;
}

const CLEAR_INSTRUCTION = [
  'Γράψε ΜΙΑ σύντομη, πειραχτική ατάκα στα ελληνικά για μια μαζική διαγραφή',
  'μηνυμάτων σε Discord. Το πολύ 12 λέξεις. Χωρίς emoji, χωρίς εισαγωγικά,',
  'χωρίς εξηγήσεις — μόνο η ατάκα. Χιούμορ ελαφρύ, ποτέ προσβλητικό.'
].join(' ');

const KICK_INSTRUCTION = [
  'Είσαι ένα music bot που μόλις το πέταξαν από φωνητικό κανάλι στο Discord.',
  'Γράψε ΜΙΑ σύντομη, παραπονιάρικη και αστεία ατάκα στα ελληνικά, σε πρώτο πρόσωπο.',
  'Το πολύ 14 λέξεις. Χωρίς emoji, χωρίς εισαγωγικά, χωρίς εξηγήσεις — μόνο η ατάκα.',
  'Χιούμορ ελαφρύ και πειραχτικό, ποτέ προσβλητικό ή χυδαίο.'
].join(' ');

function describeClear(facts) {
  const bits = [`${facts.count} μηνύματα`];
  if (facts.authors > 1) bits.push(`από ${facts.authors} άτομα`);
  if (facts.withFiles > 0) bits.push(`${facts.withFiles} με αρχεία`);
  if (facts.withLinks > 0) bits.push(`${facts.withLinks} με συνδέσμους`);
  if (facts.spanDays > 0) bits.push(`απλωμένα σε ${facts.spanDays} μέρες`);
  return bits.join(', ');
}

function describeKick(facts) {
  const bits = [];
  bits.push(facts.kind === 'move' ? 'με μετακίνησαν σε άλλο κανάλι' : 'με πέταξαν έξω από το κανάλι');
  if (facts.channelName) bits.push(`ήμουν στο "${facts.channelName}"`);
  if (facts.kind === 'move' && facts.toChannelName) bits.push(`τώρα είμαι στο "${facts.toChannelName}"`);
  if (facts.byName) bits.push(`το έκανε ο/η ${facts.byName}`);
  bits.push(facts.wasPlaying ? 'έπαιζα μουσική εκείνη τη στιγμή' : 'δεν έπαιζα κάτι');
  if (facts.trackTitle) bits.push(`το κομμάτι ήταν "${String(facts.trackTitle).slice(0, 80)}"`);
  return bits.join(', ');
}

function buildRequest(key, prompt) {
  const name = activeProviderName();

  if (name === 'gemini') {
    const model = defaultModel();
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],

        generationConfig: { temperature: 1.1, maxOutputTokens: 40 }
      },
      extract: (d) => d?.candidates?.[0]?.content?.parts?.[0]?.text
    };
  }

  if (name === 'groq') {
    return {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: {
        model: process.env.AI_MODEL || 'llama-3.3-70b-versatile',
        temperature: 1.1,
        max_tokens: 40,
        messages: [{ role: 'user', content: prompt }]
      },
      extract: (d) => d?.choices?.[0]?.message?.content
    };
  }

  return null;
}

function tidy(text) {
  const line = String(text || '').split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const clean = line.replace(/^["'«»\s-]+|["'«»\s]+$/g, '').trim();

  if (!clean || clean.length > 120) return null;
  return clean;
}

async function runQuip(prompt, database, deps = {}) {
  const doFetch = deps.fetch || globalThis.fetch;
  const key = deps.apiKey ?? getApiKey();
  if (!key || !prompt) return null;
  if (!consumeCap(database)) return null;

  const request = buildRequest(key, prompt);
  if (!request) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await doFetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal
    });
    if (!response.ok) { log.debug(`quip HTTP ${response.status}`); return null; }
    return tidy(request.extract(await response.json()));
  } catch (error) {
    log.debug('quip skipped:', error.name === 'AbortError' ? 'timeout' : error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function clearQuip(facts, database, deps = {}) {
  if (!facts || !Number.isFinite(facts.count)) return null;
  return runQuip(`${CLEAR_INSTRUCTION}\n\nΣτοιχεία: ${describeClear(facts)}.`, database, deps);
}

async function kickQuip(facts, database, deps = {}) {
  if (!facts || (facts.kind !== 'kick' && facts.kind !== 'move')) return null;
  return runQuip(`${KICK_INSTRUCTION}\n\nΣτοιχεία: ${describeKick(facts)}.`, database, deps);
}

function summarize(messages) {
  const list = Array.from(messages || []);
  if (list.length === 0) return null;

  const authors = new Set();
  let withFiles = 0;
  let withLinks = 0;
  let oldest = Infinity;
  let newest = 0;

  for (const msg of list) {
    if (msg.authorId || msg.author) authors.add(msg.authorId || msg.author);
    if (msg.attachments?.length) withFiles++;
    if (/https?:\/\//.test(msg.content || '')) withLinks++;
    const ts = msg.createdAt ? Date.parse(msg.createdAt) : NaN;
    if (Number.isFinite(ts)) { oldest = Math.min(oldest, ts); newest = Math.max(newest, ts); }
  }

  return {
    count: list.length,
    authors: authors.size,
    withFiles,
    withLinks,
    spanDays: Number.isFinite(oldest) && newest > oldest
      ? Math.round((newest - oldest) / 86400000)
      : 0
  };
}

module.exports = { clearQuip, kickQuip, summarize, capKey, dailyCap, TIMEOUT_MS };
