#!/usr/bin/env node
const path = require('path');

const { start, ROOT } = require('./harness');

const { section, finish, check } = start();
const { resolveLiveStream, isYouTubeUrl } = require(path.join(ROOT, 'src/idle-live'));

const YT = 'https://www.youtube.com/watch?v=4xDzrJKXOOY';
const ICECAST = 'https://ice1.somafm.com/groovesalad-256-mp3';

async function main() {
  section('αναγνώριση YouTube URL');
  check(isYouTubeUrl(YT), 'youtube.com/watch');
  check(isYouTubeUrl('https://youtu.be/abc'), 'youtu.be');
  check(isYouTubeUrl('https://music.youtube.com/watch?v=x'), 'υποτομέας music');
  check(!isYouTubeUrl(ICECAST), 'το Icecast ΔΕΝ είναι YouTube');

  check(!isYouTubeUrl('https://youtube.com.evil.example/x'), 'ψεύτικος τομέας δεν περνάει');
  check(!isYouTubeUrl('όχι-url'), 'σκουπίδια δεν είναι YouTube');
  check(!isYouTubeUrl(''), 'κενό δεν είναι YouTube');

  section('επιλογή διαδρομής');
  const calls = [];
  const spies = {
    resolveViaYoutubei: async () => { calls.push('youtubei'); return { streamUrl: 'A', title: 't', via: 'youtubei/hls' }; },
    resolveViaYtDlp: async () => { calls.push('yt-dlp'); return { streamUrl: 'B', title: 't', via: 'yt-dlp' }; }
  };

  calls.length = 0;
  let out = await resolveLiveStream(YT, { ...spies, hasCredentials: true });
  check(calls.join() === 'youtubei' && out.streamUrl === 'A', 'YouTube + token -> youtubei');

  calls.length = 0;
  out = await resolveLiveStream(YT, { ...spies, hasCredentials: false });
  check(calls.join() === 'yt-dlp' && out.streamUrl === 'B', 'YouTube χωρίς token -> yt-dlp');

  calls.length = 0;
  out = await resolveLiveStream(ICECAST, { ...spies, hasCredentials: true });
  check(!calls.includes('youtubei'), 'Icecast δεν αγγίζει ΠΟΤΕ τη youtubei, ακόμα και με token');
  check(out.via === 'direct' && out.streamUrl === ICECAST, 'Icecast πάει κατευθείαν στο ffmpeg, χωρίς yt-dlp');

  section('ποιο διαπιστευτήριο ανοίγει τη διαδρομή');

  for (const [label, env] of [["YT_COOKIE", "YT_COOKIE"], ["YT_OAUTH", "YT_OAUTH"]]) {
    const saved = process.env[env];
    delete process.env.YT_COOKIE;
    delete process.env.YT_OAUTH;
    process.env[env] = "x";
    calls.length = 0;
    await resolveLiveStream(YT, spies);
    check(calls.join() === "youtubei", `${label} ανοίγει την αυθεντικοποιημένη διαδρομή`);
    delete process.env[env];
    if (saved !== undefined) process.env[env] = saved;
  }

  calls.length = 0;
  delete process.env.YT_COOKIE;
  delete process.env.YT_OAUTH;
  await resolveLiveStream(YT, spies);
  check(calls.join() === 'yt-dlp', 'χωρίς κανένα διαπιστευτήριο -> yt-dlp');

  section('η εφεδρεία κρατάει');
  calls.length = 0;
  out = await resolveLiveStream(YT, {
    ...spies,
    hasCredentials: true,
    resolveViaYoutubei: async () => { calls.push('youtubei'); throw new Error('boom'); }
  });
  check(calls.join() === 'youtubei,yt-dlp' && out.streamUrl === 'B', 'σφάλμα youtubei -> πέφτει στο yt-dlp');

  let threw = null;
  try {
    await resolveLiveStream(YT, {
      hasCredentials: true,
      resolveViaYoutubei: async () => { throw new Error('boom'); },
      resolveViaYtDlp: async () => { throw new Error('και τα δύο έπεσαν'); }
    });
  } catch (error) { threw = error; }
  check(threw && threw.message === 'και τα δύο έπεσαν',
    'όταν πέφτουν και οι δύο, βγαίνει το σφάλμα του yt-dlp, όχι σιωπή');

  section('το token δεν διαρρέει');
  const SECRET = 'oauth-token-ΜΥΣΤΙΚΟ-12345';
  process.env.YT_OAUTH = SECRET;
  const written = [];
  const real = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a) => written.push(a.join(' '));
  try {
    await resolveLiveStream(YT, {
      hasCredentials: true,
      resolveViaYoutubei: async () => { throw new Error('απέτυχε'); },
      resolveViaYtDlp: async () => ({ streamUrl: 'B', title: 't', via: 'yt-dlp' })
    });
  } finally {
    Object.assign(console, real);
    delete process.env.YT_OAUTH;
  }
  check(!written.join(' ').includes(SECRET), 'ούτε στη διαδρομή σφάλματος δεν τυπώνεται το token');

  finish('όλοι οι έλεγχοι αυθεντικοποίησης πέρασαν');
}

main();
