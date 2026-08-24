#!/usr/bin/env node
const path = require('path');

const { start, ROOT } = require('./harness');

delete process.env.GEMINI_API_KEY;
delete process.env.GROQ_API_KEY;

const { createDepartureWatcher } = require(path.join(ROOT, 'src/events/voice-state.js'));
const {
  expectLeave,
  wasExpected,
  consumeExpected,
  clearExpected,
  rememberExecutor,
  recentExecutor
} = require(path.join(ROOT, 'src/utils/voice-departure.js'));
const { kickQuip } = require(path.join(ROOT, 'src/ai/quip.js'));
const {
  pickFallback,
  formatKickMessage,
  resolveComplaintChannel,
  KICK_LINES,
  MOVE_LINES
} = require(path.join(ROOT, 'src/utils/kick-message.js'));

const { fail, section, check, finish } = start();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONFIRM = 60;
const SETTLE = CONFIRM + 60;

const database = {
  getStat: () => 0,
  setStat: () => {},
  getLastCommandChannelId: () => 'text1'
};

function makeWorld({ botChannelId = null, canSpeak = true, lastCommandChannel = 'text1' } = {}) {
  const sent = [];

  const textChannel = {
    id: 'text1',
    name: 'general',
    isTextBased: () => true,
    isDMBased: () => false,
    permissionsFor: () => ({ has: () => canSpeak }),
    send: async (payload) => { sent.push(payload); return payload; }
  };

  const guild = {
    id: 'g1',
    name: 'Test Guild',
    channels: {
      cache: new Map([['text1', textChannel]]),
      fetch: async () => null
    },
    members: { me: { voice: { channelId: botChannelId } } }
  };

  const client = {
    user: { id: 'bot' },
    guilds: { cache: new Map([['g1', guild]]) },
    player: { nodes: { get: () => null } },
    currentTrack: null,
    lastTrackByGuild: new Map(),
    shuttingDown: false
  };

  const db = { ...database, getLastCommandChannelId: () => lastCommandChannel };
  const watcher = createDepartureWatcher({ client, database: db, confirmMs: CONFIRM });

  return { client, guild, sent, watcher, textChannel };
}

const voiceState = (channelId, name) => ({
  id: 'bot',
  guild: { id: 'g1' },
  channelId,
  channel: channelId ? { id: channelId, name: name || channelId } : null
});

async function main() {
  section('Departure registry');
  {
    const client = {};
    check(expectLeave(client, 'g1'), 'expectLeave records an intentional leave');
    check(wasExpected(client, 'g1'), 'wasExpected sees the flag while it is fresh');
    check(consumeExpected(client, 'g1'), 'consumeExpected reports the flag');
    check(!wasExpected(client, 'g1'), 'the flag is gone once consumed');

    expectLeave(client, 'g2', 1);
    await sleep(20);
    check(!wasExpected(client, 'g2'), 'an expired flag does not linger');

    expectLeave(client, 'g3');
    clearExpected(client, 'g3');
    check(!wasExpected(client, 'g3'), 'clearExpected drops the flag');

    check(!wasExpected({}, 'never-set'), 'an unknown guild was never expected to leave');
  }

  section('Executor attribution window');
  {
    const client = {};
    rememberExecutor(client, 'g1', { displayName: 'Thomas' });
    check(recentExecutor(client, 'g1')?.displayName === 'Thomas', 'a fresh executor is reported');

    rememberExecutor(client, 'g2', { displayName: 'Old' }, Date.now() - 10000);
    check(recentExecutor(client, 'g2') === null, 'a stale executor is never blamed');
    check(recentExecutor(client, 'nope') === null, 'no executor means no blame');
  }

  section('Kick detection');
  {
    const world = makeWorld();
    world.watcher.onVoiceStateUpdate(voiceState('v1', 'Voice 1'), voiceState(null));
    await sleep(SETTLE);
    check(world.sent.length === 1, 'an unexplained kick produces exactly one complaint');
    check(
      typeof world.sent[0]?.content === 'string' && world.sent[0].content.length > 0,
      'the complaint has content'
    );
    check(
      world.sent[0]?.allowedMentions?.parse?.length === 0,
      'the complaint pings nobody'
    );
  }

  section('Intentional leaves stay silent');
  {
    const world = makeWorld();
    expectLeave(world.client, 'g1');
    world.watcher.onVoiceStateUpdate(voiceState('v1'), voiceState(null));
    await sleep(SETTLE);
    check(world.sent.length === 0, 'a flagged leave (stop, empty channel, shutdown) says nothing');
  }

  {
    const world = makeWorld();
    expectLeave(world.client, 'g1', 1);
    await sleep(20);
    world.watcher.onVoiceStateUpdate(voiceState('v1'), voiceState(null));
    await sleep(SETTLE);
    check(world.sent.length === 1, 'an expired flag does not silence a real kick');
  }

  {
    const world = makeWorld();
    world.client.shuttingDown = true;
    world.watcher.onVoiceStateUpdate(voiceState('v1'), voiceState(null));
    await sleep(SETTLE);
    check(world.sent.length === 0, 'a shutting-down bot does not complain on its way out');
  }

  section('Rejoining inside the confirmation window');
  {
    const world = makeWorld();
    world.watcher.onVoiceStateUpdate(voiceState('v1'), voiceState(null));
    world.guild.members.me.voice.channelId = 'v1';
    await sleep(SETTLE);
    check(world.sent.length === 0, 'a bounce back to the same channel is not a kick');
  }

  section('Moves');
  {
    const world = makeWorld({ botChannelId: 'v2' });
    world.watcher.onVoiceStateUpdate(voiceState('v1', 'Voice 1'), voiceState('v2', 'Voice 2'));
    await sleep(SETTLE);
    check(world.sent.length === 1, 'being dragged to another channel is worth a word');
    check(
      MOVE_LINES.some((line) => world.sent[0]?.content?.includes(line)),
      'a move uses the move wording, not the kick wording'
    );
  }

  section('Other members are none of our business');
  {
    const world = makeWorld();
    const human = { id: 'someone-else', guild: { id: 'g1' }, channelId: 'v1', channel: { name: 'Voice 1' } };
    const humanGone = { id: 'someone-else', guild: { id: 'g1' }, channelId: null, channel: null };
    world.watcher.onVoiceStateUpdate(human, humanGone);
    await sleep(SETTLE);
    check(world.sent.length === 0, 'a human leaving voice does not trigger the bot complaint');
  }

  section('Blame only when the audit log agrees');
  {
    const world = makeWorld();
    rememberExecutor(world.client, 'g1', { displayName: 'Thomas' });
    world.watcher.onVoiceStateUpdate(voiceState('v1', 'Voice 1'), voiceState(null));
    await sleep(SETTLE);
    check(world.sent[0]?.content?.includes('Thomas'), 'a confirmed executor is named');
  }

  {
    const world = makeWorld();
    rememberExecutor(world.client, 'g1', { displayName: 'Innocent' }, Date.now() - 30000);
    world.watcher.onVoiceStateUpdate(voiceState('v1', 'Voice 1'), voiceState(null));
    await sleep(SETTLE);
    check(
      world.sent.length === 1 && !world.sent[0].content.includes('Innocent'),
      'a stale audit entry never gets the blame'
    );
  }

  section('discord-player deletes the queue before we see the kick');
  {
    const world = makeWorld();
    world.client.lastTrackByGuild.set('g1', { title: 'Lofi Beats', author: 'Girl' });
    world.watcher.onVoiceStateUpdate(voiceState('v1', 'Voice 1'), voiceState(null));
    await sleep(SETTLE);
    check(
      world.sent.length === 1,
      'a kick still complains even though the queue is already gone'
    );
  }

  {
    const captured = [];
    const fakeFetch = async (url, options) => {
      captured.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Ατάκα.' }] } }] }) };
    };
    process.env.AI_PROVIDER = 'gemini';
    await kickQuip(
      { kind: 'kick', channelName: 'Voice 1', wasPlaying: true, trackTitle: 'Lofi Beats' },
      database,
      { apiKey: 'test-key', fetch: fakeFetch }
    );
    const prompt = JSON.stringify(captured[0] || {});
    check(
      prompt.includes('Lofi Beats') && prompt.includes('έπαιζα μουσική'),
      'the quip is told what was playing when the kick landed'
    );
    check(!prompt.includes('test-key'), 'the api key never travels inside the prompt');
  }

  section('Spam control');
  {
    const world = makeWorld();
    world.watcher.onVoiceStateUpdate(voiceState('v1'), voiceState(null));
    await sleep(SETTLE);
    world.guild.members.me.voice.channelId = 'v1';
    world.watcher.onVoiceStateUpdate(voiceState('v1'), voiceState(null));
    world.guild.members.me.voice.channelId = null;
    await sleep(SETTLE);
    check(world.sent.length === 1, 'repeated kicks do not turn into a flood');
  }

  section('Nowhere to speak');
  {
    const world = makeWorld({ canSpeak: false });
    world.watcher.onVoiceStateUpdate(voiceState('v1'), voiceState(null));
    await sleep(SETTLE);
    check(world.sent.length === 0, 'a channel we cannot post in is skipped, not crashed into');
  }

  {
    const world = makeWorld({ lastCommandChannel: null });
    world.watcher.onVoiceStateUpdate(voiceState('v1'), voiceState(null));
    await sleep(SETTLE);
    check(world.sent.length === 0, 'no known channel means silence, not an exception');
  }

  section('Channel resolution');
  {
    const world = makeWorld();
    const resolved = await resolveComplaintChannel(world.client, 'g1', world.client.database || database, []);
    check(resolved?.id === 'text1', 'the last command channel is the first choice');

    const missing = await resolveComplaintChannel(world.client, 'nope', database, []);
    check(missing === null, 'an unknown guild resolves to nothing');

    const brokenDb = { getLastCommandChannelId: () => { throw new Error('db down'); } };
    const survived = await resolveComplaintChannel(world.client, 'g1', brokenDb, ['text1']);
    check(survived?.id === 'text1', 'a failing database falls through to the backup channel');
  }

  section('Fallback lines');
  {
    let repeats = 0;
    let previous = null;
    for (let i = 0; i < 200; i++) {
      const line = pickFallback('kick', 'gX');
      if (line === previous) repeats++;
      previous = line;
    }
    check(repeats === 0, 'the same line never lands twice in a row');
    check(KICK_LINES.length >= 10 && MOVE_LINES.length >= 5, 'there are enough lines to stay fresh');

    const withName = formatKickMessage('Ατάκα.', { kind: 'kick', channelName: 'General', byName: 'Thomas' });
    check(withName.includes('Thomas') && withName.includes('General'), 'the blame line carries who and where');

    const without = formatKickMessage('Ατάκα.', { kind: 'kick', channelName: 'General' });
    check(!without.includes('-#'), 'without an executor there is no blame line at all');
  }

  finish(`${KICK_LINES.length + MOVE_LINES.length} ατάκες, ο ανιχνευτής ξεχωρίζει το kick από την αποχώρηση`);
}

main().catch((error) => {
  fail(`unexpected error: ${error.stack || error}`);
  finish('kick');
});
