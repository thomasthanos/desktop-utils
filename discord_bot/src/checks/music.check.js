#!/usr/bin/env node
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

const { formatDuration, buildProgressBar, trackDurationMs } = require(
  path.join(ROOT, 'src/utils/music.js')
);

section('formatDuration');
eq('90s', formatDuration(90000), '1:30');
eq('under a minute pads', formatDuration(5000), '0:05');
eq('over an hour', formatDuration(3723000), '1:02:03');
eq('zero', formatDuration(0), '0:00');
eq('negative is unknown', formatDuration(-1), '--:--');
eq('NaN is unknown', formatDuration(NaN), '--:--');

section('buildProgressBar');
const bar = buildProgressBar(0, 100000);
bar.startsWith('🔘') ? pass('at position 0 the marker is first') : fail(`start: ${bar}`);
const endBar = buildProgressBar(100000, 100000);
endBar.endsWith('🔘') ? pass('at the end the marker is last') : fail(`end: ${endBar}`);
buildProgressBar(50000, 0) === 'LIVE'
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
  const ids = rows.map((r) => r.guild_id).filter((id) => id.startsWith('guild-')).sort();
  eq('only active guilds are restored', ids, ['guild-a', 'guild-b']);

  const a = rows.find((r) => r.guild_id === 'guild-a');
  eq('voice channel persisted', a.active_voice_channel, 'vc-1');
  eq('text channel persisted', a.active_text_channel, 'tc-1');

  database.setIdleState('guild-a', { voiceChannelId: null, textChannelId: null, active: false });
  database.getIdleStatesToRestore().some((r) => r.guild_id === 'guild-a')
    ? fail('stopping the radio should clear it from the restore list')
    : pass('stopping the radio clears it from the restore list');

  database.setGuildVolume('guild-vol', 33);
  database.setIdleState('guild-vol', { voiceChannelId: 'vc-9', textChannelId: null, active: true });
  database.getGuildVolume('guild-vol') === 33
    ? pass('setIdleState preserves the saved volume')
    : fail(`volume was clobbered: ${database.getGuildVolume('guild-vol')}`);

  const cols = database.db.prepare('PRAGMA table_info(guild_settings)').all().map((c) => c.name);
  ['active_voice_channel', 'active_text_channel', 'idle_active'].every((c) => cols.includes(c))
    ? pass('schema migration added all three columns')
    : fail(`guild_settings columns: ${cols.join(', ')}`);
} catch (err) {
  fail(`idle state: ${err.message}`);
}

const { countHumans, isVoiceEmpty, buildNodeOptions } = require(path.join(ROOT, 'src/utils/voice.js'));

const channelWith = (members) => ({
  members: { filter: (fn) => ({ size: members.filter(fn).length }) }
});
const human = (id) => ({ user: { bot: false, id } });
const bot = (id) => ({ user: { bot: true, id } });

section('countHumans / isVoiceEmpty');
eq('two humans + one bot', countHumans(channelWith([human('a'), bot('b'), human('c')])), 2);
eq('only bots counts zero', countHumans(channelWith([bot('a'), bot('b'), bot('c')])), 0);

isVoiceEmpty(channelWith([bot('a'), bot('b'), bot('c')]))
  ? pass('three bots and no humans is empty')
  : fail('three bots should count as empty');
isVoiceEmpty(channelWith([human('a'), bot('b')]))
  ? fail('one human should not be empty')
  : pass('one human is not empty');

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

  eq('leaveOnEmpty', opts.leaveOnEmpty, true);
  eq('leaveOnEmptyCooldown is five minutes', opts.leaveOnEmptyCooldown, 300000);

  const overridden = buildNodeOptions(fakeDb, 'guild-1', null, { volume: 7, leaveOnEnd: false });
  overridden.volume === 7 && overridden.leaveOnEnd === false
    ? pass('overrides win over the defaults')
    : fail(`overrides ignored: ${JSON.stringify(overridden)}`);

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

section('24/7 switch');
try {
  const { applyStay247 } = require(path.join(ROOT, 'src/utils/voice.js'));

  eq('defaults to off', database.getStay247('g247'), false);
  eq('setStay247 returns the new value', database.setStay247('g247', true), true);
  eq('and it reads back', database.getStay247('g247'), true);
  eq('turning it off again', database.setStay247('g247', false), false);
  eq('reads back as off', database.getStay247('g247'), false);

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

section('The queue changes for real, not on a copy of itself');
try {
  const { Queue } = require('@discord-player/utils');

  const q = new Queue('FIFO', ['a', 'b', 'c']);
  q.data.splice(0, 1);
  q.size === 3
    ? pass('.data is a copy — mutating it changes nothing (the trap this guards)')
    : fail('.data behaves like the live store now; this guard needs rewriting');

  const before = q.toArray().join(',');
  q.store.splice(0, 1);
  (q.size === 2 && q.toArray().join(',') !== before)
    ? pass('.store is the live array')
    : fail('.store did not mutate the queue');

  const shuffled = new Queue('FIFO', [1, 2, 3, 4, 5, 6, 7, 8]);
  shuffled.shuffle();
  shuffled.size === 8
    ? pass('shuffle() keeps every track')
    : fail(`shuffle() lost tracks: ${shuffled.size}`);

  const sources = ['src/commands/shuffle.js', 'src/commands/remove.js', 'src/dashboard/server.js'];
  const offenders = sources.filter((rel) => {
    const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    return body.includes('tracks?.data') || body.includes('tracks.data');
  });
  offenders.length === 0
    ? pass('no command reorders or removes through the throwaway copy')
    : fail(`these mutate queue.tracks.data, which does nothing: ${offenders.join(', ')}`);
} catch (err) {
  fail(`queue contract: ${err.message}`);
}

section('A radio that fails to start leaves nothing behind');
try {
  const body = fs.readFileSync(path.join(ROOT, 'src/idle-live.js'), 'utf8');
  const NEWLINE = String.fromCharCode(10);
  const lines = body.split(NEWLINE);

  const firstPlay = lines.findIndex((l) => l.includes('result = await playFromSource();'));
  firstPlay > -1
    ? pass('the first play is captured so it can be cleaned up')
    : fail('could not find the first playFromSource call');

  const window = lines.slice(firstPlay, firstPlay + 8).join(NEWLINE);
  (window.includes('catch') && window.includes('stopIdleLive'))
    ? pass('a failed start tears the session down instead of leaving a zombie')
    : fail('a failed first play would leave the session registered forever');

  const readyLine = lines.findIndex((l) => l.includes('VoiceConnectionStatus.Ready, 15000'));
  const readyWindow = lines.slice(readyLine, readyLine + 6).join(NEWLINE);
  readyWindow.includes('connection.destroy()')
    ? pass('a connection that never turns Ready is destroyed')
    : fail('a stuck connection would be left open');

  body.includes("player.on(AudioPlayerStatus.Playing")
    ? pass('the restart backoff resets only when audio actually plays')
    : fail('nothing resets consecutiveFailures on real playback');
} catch (err) {
  fail(`radio teardown: ${err.message}`);
}

section('One server finishing a track does not wipe another');
try {
  const np = require(path.join(ROOT, 'src/utils/now-playing.js'));
  const client = {};

  np.setCurrentTrack(client, 'gA', { title: 'radio' });
  np.setCurrentTrack(client, 'gB', { title: 'song' });
  np.clearCurrentTrack(client, 'gB');

  np.currentTrackFor(client, 'gA')?.title === 'radio'
    ? pass('the other server keeps playing')
    : fail('clearing one guild wiped another');
  np.currentTrackFor(client, 'gB') === null ? pass('the finished one is gone') : fail('it was not cleared');
  np.currentTrackFor(client, 'gA')?.guildId === 'gA' ? pass('the guild is stamped on the track') : fail('no guildId');
  np.currentTrackFor(client, null) === null ? pass('no guild means no track') : fail('a null guild returned something');

  const events = fs.readFileSync(path.join(ROOT, 'src/events/player-events.js'), 'utf8');
  events.includes('clearCurrentTrack(client, queue?.guild?.id)')
    ? pass('playerFinish names the guild that finished')
    : fail('playerFinish still clears globally');
} catch (err) {
  fail(`now playing: ${err.message}`);
}

section('A radio session that lost its connection stops claiming it plays');
try {
  const idle = require(path.join(ROOT, 'src/idle-live.js'));

  const alive = { idleLiveSessions: new Map([['g1', { connection: { state: { status: 'ready' } } }]]) };
  idle.isIdleLiveActive(alive, 'g1') ? pass('a live session reports playing') : fail('a live session was dropped');

  const dead = { idleLiveSessions: new Map([['g1', { connection: { state: { status: 'destroyed' } } }]]) };
  !idle.isIdleLiveActive(dead, 'g1')
    ? pass('a destroyed connection no longer says the radio is playing')
    : fail('a dead session still claims to be playing');
  dead.idleLiveSessions.has('g1')
    ? fail('the stale entry was left behind')
    : pass('and the stale entry is cleared, so /idlemusic can start again');

  const orphan = { idleLiveSessions: new Map([['g1', { connection: null }]]) };
  !idle.isIdleLiveActive(orphan, 'g1') ? pass('a session with no connection is not playing') : fail('orphan session counted');

  const stopping = { idleLiveSessions: new Map([['g1', { stopping: true, connection: { state: { status: 'ready' } } }]]) };
  !idle.isIdleLiveActive(stopping, 'g1') ? pass('a session on its way out is not playing') : fail('stopping session counted');

  !idle.isIdleLiveActive({}, 'nope') ? pass('an unknown guild is not playing') : fail('unknown guild counted');
} catch (err) {
  fail(`idle session health: ${err.message}`);
}

section('Who may touch the music');
try {
  const { canControlMusic } = require(path.join(ROOT, 'src/utils/voice.js'));
  const { musicGate } = require(path.join(ROOT, 'src/utils/music.js'));

  const world = ({ userChannel = null, botChannel = null, afk = null, serverDeaf = false }) => ({
    guilds: { cache: new Map([['g1', {
      id: 'g1',
      name: 'Test',
      afkChannelId: afk,
      voiceStates: { cache: new Map(userChannel ? [['u1', { channelId: userChannel, serverDeaf }]] : []) },
      members: { me: { voice: { channelId: botChannel } } }
    }]]) }
  });

  const reason = (options) => canControlMusic(world(options), 'g1', 'u1').reason;

  reason({ userChannel: 'v1', botChannel: 'v1' }) === 'ok'
    ? pass('same channel as the bot -> allowed')
    : fail(`same channel -> ${reason({ userChannel: 'v1', botChannel: 'v1' })}`);

  reason({ userChannel: null }) === 'not-in-voice'
    ? pass('outside voice -> refused')
    : fail('outside voice was allowed');

  reason({ userChannel: 'v2', botChannel: 'v1' }) === 'other-channel'
    ? pass('another channel -> refused')
    : fail('another channel was allowed');

  reason({ userChannel: 'afk1', afk: 'afk1' }) === 'afk-channel'
    ? pass('the AFK channel does not count as listening')
    : fail('AFK channel was accepted');

  reason({ userChannel: 'v1', botChannel: 'v1', serverDeaf: true }) === 'server-deafened'
    ? pass('server-deafened -> refused')
    : fail('a server-deafened user could change the music');

  canControlMusic(world({ userChannel: 'v1' }), 'g1', null).reason === 'no-identity'
    ? pass('no identity -> refused')
    : fail('an anonymous caller was allowed');

  const allowed = musicGate(world({ userChannel: 'v1', botChannel: 'v1' }), { guildId: 'g1', user: { id: 'u1' } });
  allowed === null ? pass('musicGate lets a listener through') : fail(`musicGate blocked a listener: ${allowed}`);

  const blocked = musicGate(world({ userChannel: null }), { guildId: 'g1', user: { id: 'u1' } });
  (typeof blocked === 'string' && blocked.length > 0)
    ? pass('musicGate explains itself when it refuses')
    : fail('musicGate refused without a message');

  const commandsDir = path.join(ROOT, 'src/commands');
  const mutating = ['play', 'pause', 'resume', 'skip', 'stop', 'volume', 'loop', 'shuffle', 'remove', '247', 'idlemusic'];
  const ungated = mutating.filter((name) => {
    const body = fs.readFileSync(path.join(commandsDir, `${name}.js`), 'utf8');
    return !['musicGate', '.voice?.channel', 'member?.voice'].some((needle) => body.includes(needle));
  });
  ungated.length === 0
    ? pass('every command that changes playback checks voice first')
    : fail(`these change playback without a voice check: ${ungated.join(', ')}`);
} catch (err) {
  fail(`music gate: ${err.message}`);
}

try { database.close(); } catch {}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

finish('all music checks passed');
