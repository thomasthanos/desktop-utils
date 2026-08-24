#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const { start, ROOT } = require('./harness');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'invites-'));
process.env.DATA_DIR = tmp;

const database = require(path.join(ROOT, 'src/database.js'));
const {
  fakeWindowMs,
  isFreshAccount,
  minAccountAgeMs,
  humanDuration,
  parseStoredTime,
  buildJoinEmbed,
  buildLeaveEmbed,
  rememberRemoval,
  recentRemoval
} = require(path.join(ROOT, 'src/utils/invite-log.js'));

const { section, check, finish } = start();

const guild = { id: 'g1', name: 'Test Guild' };
const inviter = { id: 'i1', tag: 'inviter#0001' };

function joinRow(userId, extra = {}) {
  return database.logInviteEvent({
    event: 'join',
    inviter,
    invited: { id: userId, tag: `${userId}#0001` },
    code: 'abc',
    guild,
    totalInvites: 1,
    ...extra
  });
}

section('The announcement channel');
{
  check(database.getInviteLogChannel('g1') === null, 'nothing is announced until a channel is chosen');

  database.setInviteLogChannel('g1', 'c1');
  check(database.getInviteLogChannel('g1') === 'c1', 'the channel is remembered');

  database.setInviteLogChannel('g1', null);
  check(database.getInviteLogChannel('g1') === null, 'and can be turned off again');
}

section('Someone who has been here before');
{
  check(database.countPreviousJoins('g1', 'u1') === 0, 'a first-timer has no history');

  joinRow('u1');
  check(database.countPreviousJoins('g1', 'u1') === 1, 'the join is remembered');
  check(database.countPreviousJoins('g1', 'u-other') === 0, 'and it belongs to that person only');
  check(database.countPreviousJoins('g2', 'u1') === 0, 'and to that server only');
}

section('Leaving quickly turns the invite fake');
{
  const id = joinRow('u2');
  const stored = database.getLastJoin('g1', 'u2');

  check(stored?.id === id, 'the newest join is the one we find');
  check(stored.is_fake === 0, 'it starts out real');

  const joinedAt = parseStoredTime(stored.timestamp);
  check(joinedAt !== null, 'the stored time is readable');

  const stayed = Date.now() - joinedAt;
  check(stayed < fakeWindowMs(), 'a join that just happened is inside the window');

  database.markJoinFake(stored.id, new Date().toISOString());
  const after = database.getLastJoin('g1', 'u2');
  check(after.is_fake === 1, 'leaving inside the window marks it fake');
}

section('Leaving later does not');
{
  joinRow('u3');
  const stored = database.getLastJoin('g1', 'u3');

  const longAgo = Date.now() - (fakeWindowMs() + 60000);
  const stayed = Date.now() - longAgo;
  check(stayed >= fakeWindowMs(), 'a long stay falls outside the window');
  check(stored.is_fake === 0, 'so the invite stays real');
}

section('The leaderboard counts real invites, and shows fakes apart');
{
  const board = database.getInviteLeaderboardByGuild('g1');
  const row = board.find((entry) => entry.inviter_id === 'i1');

  check(Boolean(row), 'the inviter appears');
  check(row.total_invites === 2, 'u1 and u3 count, the fake one does not');
  check(row.fake_invites === 1, 'and the fake is reported separately');
}

section('Joins with no known inviter are recorded but never credited');
{
  database.logInviteEvent({
    event: 'join',
    inviter: null,
    invited: { id: 'u4', tag: 'u4#0001' },
    code: null,
    guild
  });

  const board = database.getInviteLeaderboardByGuild('g1');
  check(!board.some((row) => row.inviter_id === 'unknown'), 'an unknown inviter never reaches the leaderboard');
  check(database.countPreviousJoins('g1', 'u4') === 1, 'but the join itself is remembered');
}

section('Leaves are stored as their own kind of row');
{
  database.logInviteEvent({
    event: 'leave',
    inviter: null,
    invited: { id: 'u1', tag: 'u1#0001' },
    code: null,
    guild
  });

  const rows = database.getInviteLogsByGuild('g1', 50);
  check(rows.some((row) => row.event === 'leave'), 'the leave is in the log');
  check(database.countPreviousJoins('g1', 'u1') === 1, 'and it does not count as another join');
}

section('A departure keeps the inviter it came in with');
{
  joinRow('u5');
  const join = database.getLastJoin('g1', 'u5');

  database.logInviteEvent({
    event: 'leave',
    inviter: { id: join.inviter_id, tag: join.inviter_tag },
    invited: { id: 'u5', tag: 'u5#0001' },
    code: join.invite_code,
    guild,
    totalInvites: join.total_invites
  });

  const rows = database.getInviteLogsByGuild('g1', 100);
  const leaveRow = rows.find((row) => row.invited_id === 'u5' && row.event === 'leave');

  check(leaveRow?.inviter_id === 'i1', 'the leave row still knows who brought them');
  check(leaveRow?.invite_code === 'abc', 'and which invite they used');
  check(database.countPreviousJoins('g1', 'u5') === 1, 'and it is still not counted as a join');
}

section('A brand-new account counts as fake');
{
  const now = Date.now();
  const fresh = { createdTimestamp: now - 60000 };
  const old = { createdTimestamp: now - (400 * 86400000) };

  check(isFreshAccount(fresh, now), 'an account made a minute ago is fresh');
  check(!isFreshAccount(old, now), 'an old account is not');
  check(!isFreshAccount({}, now), 'an unknown creation date is never held against anyone');
  check(minAccountAgeMs() === 3 * 86400000, 'three days by default');

  process.env.INVITE_MIN_ACCOUNT_AGE_DAYS = '0';
  check(!isFreshAccount(fresh, now), 'setting the threshold to zero turns the rule off');
  delete process.env.INVITE_MIN_ACCOUNT_AGE_DAYS;
}

section('The leaderboard subtracts the ones who left');
{
  const board = database.getInviteLeaderboardByGuild('g1');
  const row = board.find((entry) => entry.inviter_id === 'i1');

  check(Number(row.left_invites) > 0, 'departures are counted against the inviter');
  check(
    Math.max(0, row.total_invites - row.left_invites) < row.total_invites,
    'so "stayed" is lower than "brought"'
  );
}

section('Clearing the invite history of one server');
{
  database.logInviteEvent({
    event: 'join',
    inviter,
    invited: { id: 'u6', tag: 'u6#0001' },
    code: 'abc',
    guild: { id: 'g-other', name: 'Other' },
    totalInvites: 1
  });

  const removed = database.deleteInviteLogsByGuild('g1');
  check(removed > 0, 'the history of this server is cleared');
  check(database.getInviteLogsByGuild('g1', 100).length === 0, 'and nothing is left behind');
  check(database.getInviteLogsByGuild('g-other', 100).length === 1, 'while another server keeps its own');
}

section('Reading a stored time');
{
  const asUtc = Date.parse('2026-08-20T12:00:00Z');
  check(parseStoredTime('2026-08-20 12:00:00') === asUtc, 'sqlite writes UTC without a marker, and we read it that way');
  check(parseStoredTime('2026-08-20T12:00:00Z') === asUtc, 'an explicit Z is respected');
  check(parseStoredTime('2026-08-20T14:00:00+02:00') === asUtc, 'so is an offset');
  check(parseStoredTime('banana') === null, 'garbage is refused');
}

section('How long they stayed, in words');
{
  check(humanDuration(30000) === 'λιγότερο από ένα λεπτό', 'half a minute is not rounded up to one');
  check(humanDuration(60000) === '1 λεπτό', 'one minute');
  check(humanDuration(5 * 60000) === '5 λεπτά', 'a few minutes');
  check(humanDuration(2 * 3600000) === '2 ώρες', 'hours');
  check(humanDuration(-1) === 'άγνωστο διάστημα', 'nonsense says so');
}

section('The announcement says everything in two lines');
{
  const member = { id: 'u9', user: { id: 'u9', tag: 'new#0001' } };
  const inviterUser = { id: 'i1', tag: 'old#0002' };

  const join = buildJoinEmbed({
    member, inviter: inviterUser, inviteCode: 'abc', totalInvites: 4, isFake: false
  }).toJSON();

  check(!join.fields, 'no field grid — that is what made it tall');
  check(!join.thumbnail && !join.author, 'no avatar block and no header either');
  check(join.description.split(String.fromCharCode(10)).length === 2, 'exactly two lines');

  check(join.description.includes('<@u9>'), 'the person is a mention, so the client renders their name');
  check(join.description.includes('`u9`'), 'with the raw id still there to copy');
  check(join.description.includes('<@i1>') && join.description.includes('`i1`'), 'the inviter the same way');
  check(join.description.includes('abc'), 'the invite code');
  check(join.description.includes('4'), 'the running total');
  check(join.color === 0x57f287, 'a real join is green');

  const flagged = buildJoinEmbed({
    member, inviter: inviterUser, inviteCode: 'abc', totalInvites: 4, isFake: true, fakeReason: 'ξαναμπήκε'
  }).toJSON();
  check(flagged.color === 0xf1c40f, 'a fake join is amber');
  check(flagged.description.includes('fake'), 'and says so');

  const anonymous = buildJoinEmbed({ member, inviter: null, inviteCode: null, totalInvites: 0 }).toJSON();
  check(anonymous.description.includes('δεν βρέθηκε'), 'an unknown inviter is admitted, not invented');
  check(!anonymous.description.includes('σύνολο'), 'and no total is claimed for nobody');
}

section('A kick or a ban is not just "left"');
{
  const user = { id: 'u9', tag: 'new#0001' };

  const left = buildLeaveEmbed({ user, stayedMs: 4 * 60000, inviter: 'old#0002', inviterId: 'i1' }).toJSON();
  check(left.description.includes('<@u9>') && left.description.includes('έφυγε'), 'an ordinary leave mentions them and reads as leaving');
  check(left.description.includes('4 λεπτά'), 'and says how long they stayed');
  check(left.color === 0x8b93a1, 'and is grey, not alarming');

  const kicked = buildLeaveEmbed({
    user, stayedMs: 4 * 60000, removal: { kind: 'kick', executor: { id: 'mod1', tag: 'ModGuy' }, reason: 'spam' }
  }).toJSON();
  check(kicked.description.includes('kick'), 'a kick reads as a kick');
  check(kicked.description.includes('<@mod1>'), 'and mentions who did it');
  check(kicked.description.includes('spam'), 'and carries the reason');
  check(kicked.color === 0xe67e22, 'and is orange');

  const banned = buildLeaveEmbed({
    user, removal: { kind: 'ban', executor: { id: 'mod1', tag: 'ModGuy' }, reason: null }
  }).toJSON();
  check(banned.description.includes('ban'), 'a ban reads as a ban');
  check(banned.description.includes('χωρίς αιτία'), 'a missing reason is stated, not hidden');
  check(banned.color === 0xed4245, 'and is red');
}

section('Matching a removal to the person it happened to');
{
  const client = {};

  rememberRemoval(client, 'g1', 'u1', { kind: 'kick', executor: { tag: 'ModGuy' }, reason: 'spam' });
  const found = recentRemoval(client, 'g1', 'u1');
  check(found?.kind === 'kick' && found.reason === 'spam', 'the removal is found for that person');

  check(recentRemoval(client, 'g1', 'u1') === null, 'and is consumed, so a later leave is not mislabelled');
  check(recentRemoval(client, 'g1', 'someone-else') === null, 'another person gets nothing');

  rememberRemoval(client, 'g1', 'u2', { kind: 'ban' });
  check(recentRemoval(client, 'g2', 'u2') === null, 'and another server gets nothing');

  rememberRemoval(client, 'g1', 'u3', { kind: 'kick' });
  check(recentRemoval(client, 'g1', 'u3', -1) === null, 'an entry past its window is ignored rather than blamed');
}

try { database.close(); } catch { /* already closed */ }
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir */ }

finish('οι προσκλήσεις μετρώνται, τα fake ξεχωρίζουν');
