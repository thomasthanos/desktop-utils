#!/usr/bin/env node
/**
 * Έλεγχοι ασφαλείας του dashboard.
 *
 *   npm run test:security
 *
 * Σηκώνει το πραγματικό dashboard με ψεύτικο Discord client σε προσωρινή πόρτα
 * και επιβεβαιώνει ότι:
 *   - κάθε διαδρομή απαιτεί συνεδρία (και τα /attachments)
 *   - το login δουλεύει, τα λάθος συνθηματικά απορρίπτονται και περιορίζονται
 *   - παραποιημένο cookie απορρίπτεται και το ?next= δεν γίνεται open redirect
 *   - τα αποθηκευμένα SVG σερβίρονται ως λήψη, όχι ως εκτελέσιμη σελίδα
 *   - ο renderer των transcripts δεν παράγει ποτέ εκτελέσιμη markup
 *
 * Τρέξ' το πριν εκθέσεις το dashboard στο internet, και ξανά μετά από κάθε
 * αλλαγή στο auth.js, στο server.js ή στο transcript.ejs.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { EventEmitter } = require('events');

const { start, ROOT } = require('./harness');
const PORT = 39000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'test-password-' + Math.random().toString(36).slice(2);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sectest-'));
const realDb = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'bot.db');
if (fs.existsSync(realDb)) fs.copyFileSync(realDb, path.join(tmp, 'bot.db'));
fs.mkdirSync(path.join(tmp, 'attachments'), { recursive: true });

process.env.DATA_DIR = tmp;
process.env.PORT = String(PORT);
process.env.DASHBOARD_HOST = '127.0.0.1';
process.env.DASHBOARD_PASSWORD = PASSWORD;
process.env.DASHBOARD_SECRET = 'x'.repeat(64);
process.env.DASHBOARD_COOKIE_SECURE = '0'; // η δοκιμή τρέχει σε http

const { pass, fail, section, finish } = start();

const { Collection } = require('discord.js');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.user = { id: '1', tag: 'test#0001', displayAvatarURL: () => '' };
    this.commands = new Collection([['play', {}]]);
    this.guilds = {
      cache: new Collection([['g1', {
        id: 'g1', name: 'Test Guild', memberCount: 3,
        iconURL: () => null, members: { me: null }
      }]])
    };
    // Στο discord-player το nodes είναι manager: έχει .cache ΚΑΙ .get()
    this.player = { nodes: { cache: new Collection(), get: () => null } };
    this.ws = { ping: 42 };
    this.currentTrack = null;
    this.inviteCache = new Collection();
  }
  isReady() { return true; }
}

// --------------------------------------------------------------------------
// XSS: ο renderer των transcripts, ελεγμένος στο πραγματικό DOM
// --------------------------------------------------------------------------
function testTranscriptRenderer() {
  section('Transcript renderer (stored XSS)');
  const src = fs.readFileSync(path.join(ROOT, 'src/dashboard/views/transcript.ejs'), 'utf8');

  const extract = (name) => {
    const start = src.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name} not found`);
    let depth = 0, i = src.indexOf('{', start);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    return src.slice(start, i + 1);
  };

  const ctx = vm.createContext({});
  vm.runInContext(`${extract('escapeHtml')}\n${extract('renderDiscordLikeText')}`, ctx);
  const render = (s) => vm.runInContext(`renderDiscordLikeText(${JSON.stringify(s)})`, ctx);

  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch { console.log('  ! jsdom unavailable — skipping DOM assertions'); return; }

  const SAFE = ['http:', 'https:'];
  const hostile = [
    ['javascript: markdown link', '[click](javascript:alert(1))'],
    ['javascript: without parens', "[x](javascript:location='//evil.example/'+document.cookie)"],
    ['uppercase JAVASCRIPT:', '[x](JAVASCRIPT:alert`1`)'],
    ['data: URI', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
    ['vbscript:', '[x](vbscript:msgbox(1))'],
    ['file: URI', '[x](file:///etc/passwd)'],
    ['protocol-relative', '[x](//evil.example/x)'],
    ['raw script tag', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['quote break-out of href', '[x](https://a" onmouseover="alert(1))']
  ];

  for (const [label, input] of hostile) {
    // Ο έλεγχος γίνεται στο DOM, όχι με regex πάνω στο κείμενο: το
    // "&lt;img onerror=...&gt;" είναι ακίνδυνο κείμενο που όμως ΠΕΡΙΕΧΕΙ τη
    // συμβολοσειρά "onerror=", οπότε ένας υφολογικός έλεγχος βγάζει ψευδή
    // συναγερμό και σε μαθαίνει να τον αγνοείς.
    const out = render(input);
    const root = new JSDOM(`<div id="r">${out}</div>`).window.document.getElementById('r');
    const problems = [];
    if (root.querySelector('script')) problems.push('<script> element');
    for (const el of root.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        const ownSpoiler = attr.name === 'onclick' && el.classList.contains('discord-spoiler');
        if (attr.name.startsWith('on') && !ownSpoiler) problems.push(`${el.tagName}[${attr.name}]`);
        if (attr.name === 'href' || attr.name === 'src') {
          const raw = attr.value.trim();
          const scheme = (raw.match(/^([a-z][a-z0-9+.-]*):/i) || [])[1];
          if (scheme && !SAFE.includes(`${scheme.toLowerCase()}:`)) problems.push(`scheme ${scheme}:`);
          if (!scheme && raw.startsWith('//')) problems.push('protocol-relative URL');
        }
      }
    }
    problems.length ? fail(`${label} — ${problems.join(', ')}`) : pass(label);
  }

  const ok = render('[Anthropic](https://anthropic.com) and **bold**');
  /<a href="https:\/\/anthropic\.com"/.test(ok) && ok.includes('<strong>bold</strong>')
    ? pass('legitimate links and formatting still render')
    : fail(`legitimate rendering broke: ${ok}`);
}

// --------------------------------------------------------------------------
// HTTP: authentication και κεφαλίδες
// --------------------------------------------------------------------------
async function testHttp() {
  const startDashboard = require(path.join(ROOT, 'src/dashboard/server.js'));
  const database = require(path.join(ROOT, 'src/database.js'));
  const { server } = await startDashboard(new FakeClient(), database);

  section('Every route requires a session');
  for (const route of ['/', '/api/stats', '/transcript/1', '/attachments/', '/commands', '/invites']) {
    const res = await fetch(BASE + route, { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    (res.status === 401 || (res.status === 302 && loc.startsWith('/login')))
      ? pass(`${route} -> ${res.status}`)
      : fail(`${route} -> ${res.status} (expected 401 or /login redirect)`);
  }

  section('State-changing endpoints blocked when signed out');
  const rowsBefore = database.getClearLogs().length;
  const del = await fetch(`${BASE}/api/clear-logs/1`, { method: 'DELETE', redirect: 'manual' });
  del.status === 401 ? pass('DELETE /api/clear-logs -> 401') : fail(`DELETE -> ${del.status}`);
  const ctl = await fetch(`${BASE}/api/player/control`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'stop' }), redirect: 'manual'
  });
  ctl.status === 401 ? pass('POST /api/player/control -> 401') : fail(`control -> ${ctl.status}`);
  database.getClearLogs().length === rowsBefore
    ? pass('database untouched')
    : fail('database changed despite 401');

  section('Login');
  const form = (body) => fetch(`${BASE}/login`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body, redirect: 'manual'
  });

  const bad = await form('password=definitely-wrong&next=/');
  bad.status === 401 ? pass('wrong password -> 401') : fail(`wrong password -> ${bad.status}`);

  const good = await form(`password=${encodeURIComponent(PASSWORD)}&next=/`);
  const setCookie = good.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  good.status === 302 && cookie.startsWith('dash_session=')
    ? pass('correct password -> 302 with session cookie')
    : fail(`login -> ${good.status}`);
  for (const attr of ['HttpOnly', 'SameSite=Strict', 'Path=/']) {
    setCookie.includes(attr) ? pass(`cookie has ${attr}`) : fail(`cookie missing ${attr}`);
  }

  const evil = await form(`password=${encodeURIComponent(PASSWORD)}&next=//evil.example.com`);
  evil.headers.get('location') === '/'
    ? pass('open redirect via ?next= blocked')
    : fail(`open redirect: ${evil.headers.get('location')}`);

  const forged = await fetch(`${BASE}/api/stats`, {
    headers: { cookie: 'dash_session=eyJleHAiOjk5OTk5OTk5OTk5OTl9.deadbeef' }, redirect: 'manual'
  });
  forged.status === 401 ? pass('tampered cookie rejected') : fail(`tampered cookie -> ${forged.status}`);

  let limited = false;
  for (let i = 0; i < 15 && !limited; i++) limited = (await form(`password=guess${i}`)).status === 429;
  limited ? pass('login brute force rate limited') : fail('no rate limiting on /login');

  section('Signed in');
  for (const route of ['/', '/api/stats']) {
    const res = await fetch(BASE + route, { headers: { cookie }, redirect: 'manual' });
    res.status === 200 ? pass(`${route} -> 200`) : fail(`${route} -> ${res.status} with a valid session`);
  }

  section('Stored file serving');
  const dir = path.join(tmp, 'attachments', 'g1', 'u1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const svg = await fetch(`${BASE}/attachments/g1/u1/x.svg`, { headers: { cookie } });
  (svg.headers.get('content-disposition') || '').includes('attachment')
    ? pass('SVG served as a download, not an executable page')
    : fail(`SVG content-disposition: '${svg.headers.get('content-disposition')}'`);
  svg.headers.get('x-content-type-options') === 'nosniff'
    ? pass('SVG has nosniff') : fail('SVG missing nosniff');

  const big = await fetch(`${BASE}/api/player/control`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ action: 'x', pad: 'A'.repeat(64 * 1024) }), redirect: 'manual'
  });
  big.status === 413 ? pass('oversized body -> 413') : fail(`64KB body -> ${big.status}`);

  await new Promise((r) => { server.close(r); setTimeout(r, 1500).unref(); });
  try { database.close(); } catch { /* ήδη κλειστή */ }
}

(async () => {
  try {
    testTranscriptRenderer();
    await testHttp();
  } catch (err) {
    fail(`harness error: ${err.message}`);
    console.error(err);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows lock */ }
  finish('all security checks passed');
})();
