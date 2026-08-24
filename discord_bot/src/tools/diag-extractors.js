#!/usr/bin/env node
require('./load-env').loadEnv();

const { Client, GatewayIntentBits } = require('discord.js');
const { QueryType } = require('discord-player');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { createPlayer, initializeExtractors } = require(path.join(ROOT, 'src/player.js'));

const TEST_URL = process.argv[2] || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const TEST_SEARCH = process.argv[3] || 'never gonna give you up';

async function countBytes(streamOrUrl, ms = 12000, limit = 256 * 1024) {
  let stream = streamOrUrl;

  if (typeof streamOrUrl === 'string') {
    const res = await fetch(streamOrUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} στο stream URL`);
    stream = require('stream').Readable.fromWeb(res.body);
  }
  if (!stream || typeof stream.on !== 'function') {
    throw new Error(`μη αναγνωρίσιμος τύπος ροής: ${typeof streamOrUrl}`);
  }

  return new Promise((resolve, reject) => {
    let total = 0;
    const timer = setTimeout(() => { try { stream.destroy(); } catch {} resolve(total); }, ms);
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) { clearTimeout(timer); try { stream.destroy(); } catch {} resolve(total); }
    });
    stream.on('end', () => { clearTimeout(timer); resolve(total); });
    stream.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

(async () => {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const player = createPlayer(client);

  console.log('\n=== Φόρτωση extractors ===');
  try {
    await initializeExtractors(player);
    console.log('initializeExtractors: OK');
  } catch (error) {
    console.error('initializeExtractors ΑΠΕΤΥΧΕ:', error.message);
  }

  console.log('\n=== Ενεργοί extractors ===');
  const active = [];
  player.extractors.store.forEach((extractor, id) => {
    active.push(id);
    console.log(` - ${id}`);
  });
  if (active.length === 0) console.log(' (ΚΑΝΕΝΑΣ — αυτό εξηγεί το "Extractor: N/A")');

  const youtubei = active.find((id) => /youtubei|youtube/i.test(id));
  console.log(`\nYouTube extractor: ${youtubei ? `ΕΝΕΡΓΟΣ (${youtubei})` : 'ΛΕΙΠΕΙ'}`);

  const yt = player.extractors.store.get('com.retrouser955.discord-player.discord-player-youtubei');
  if (yt) {
    console.log('\n=== validate() του YouTube extractor ===');
    for (const [label, q, type] of [
      ['URL / AUTO', TEST_URL, QueryType.AUTO],
      ['URL / YOUTUBE_VIDEO', TEST_URL, QueryType.YOUTUBE_VIDEO],
      ['κείμενο / YOUTUBE_SEARCH', TEST_SEARCH, QueryType.YOUTUBE_SEARCH],
      ['κείμενο / AUTO_SEARCH', TEST_SEARCH, QueryType.AUTO_SEARCH]
    ]) {
      try {
        console.log(`  ${label.padEnd(26)} -> ${await yt.validate(q, type)}`);
      } catch (error) {
        console.log(`  ${label.padEnd(26)} -> ΣΦΑΛΜΑ: ${error.message}`);
      }
    }
  }

  if (yt) {
    console.log('\n=== Κατάσταση InnerTube ===');
    console.log(`  yt.innerTube: ${yt.innerTube ? 'υπάρχει' : 'ΛΕΙΠΕΙ (ο extractor δεν αρχικοποιήθηκε)'}`);
    if (yt.innerTube) {
      console.log(`  session logged in: ${yt.innerTube.session?.logged_in}`);
      console.log(`  client_name:       ${yt.innerTube.session?.context?.client?.clientName || 'n/a'}`);
    }

    console.log('\n=== Απευθείας κλήση handle() ===');
    for (const [label, q, type] of [
      ['URL', TEST_URL, QueryType.YOUTUBE_VIDEO],
      ['κείμενο', TEST_SEARCH, QueryType.YOUTUBE_SEARCH]
    ]) {
      try {
        const res = await yt.handle(q, { type, requestedBy: null });
        console.log(`  ${label.padEnd(8)} -> playlist=${Boolean(res?.playlist)} tracks=${res?.tracks?.length ?? 'n/a'}`);
        if (res?.tracks?.[0]) console.log(`           first: ${res.tracks[0].title}`);
      } catch (error) {
        console.log(`  ${label.padEnd(8)} -> ΕΞΑΙΡΕΣΗ: ${error.message}`);
        console.log(`           ${(error.stack || '').split('\n').slice(1, 4).join('\n           ')}`);
      }
    }
  }

  for (const [label, query, engine] of [
    ['URL (AUTO)', TEST_URL, QueryType.AUTO],
    ['URL (YOUTUBE_VIDEO)', TEST_URL, QueryType.YOUTUBE_VIDEO],
    ['κείμενο (YOUTUBE_SEARCH)', TEST_SEARCH, QueryType.YOUTUBE_SEARCH],
    ['κείμενο (AUTO_SEARCH)', TEST_SEARCH, QueryType.AUTO_SEARCH]
  ]) {
    console.log(`\n=== player.search — ${label} ===`);
    console.log(`query: ${query}`);
    try {
      const result = await player.search(query, { searchEngine: engine });
      console.log(`  queryType: ${result.queryType || 'n/a'}`);
      console.log(`  extractor: ${result.extractor?.identifier || 'N/A'}`);
      console.log(`  tracks:    ${result.tracks.length}`);
      if (result.tracks[0]) console.log(`  first:     ${result.tracks[0].title}`);
    } catch (error) {
      console.error(`  ΣΦΑΛΜΑ: ${error.message}`);
      if (process.env.YT_LOG_LEVEL) console.error(error.stack);
    }
  }

  console.log('\n=== Δοκιμή ΡΟΗΣ (μετράει πραγματικά bytes) ===');
  try {
    const result = await player.search(TEST_SEARCH, { searchEngine: QueryType.YOUTUBE_SEARCH });
    const track = result.tracks[0];
    if (!track) throw new Error('δεν βρέθηκε κομμάτι για δοκιμή');
    console.log(`  track: ${track.title}`);

    const stream = await result.extractor.stream(track);
    if (!stream) throw new Error('ο extractor επέστρεψε null stream');
    const bytes = await countBytes(stream);

    if (bytes === 0) {
      console.log('  ✗ 0 bytes — η ροή τελείωσε άδεια. ΑΥΤΟ είναι το «παίζει αλλά δεν ακούγεται».');
    } else {
      console.log(`  ✓ ${Math.round(bytes / 1024)}KB σε λίγα δευτερόλεπτα — η ροή δουλεύει.`);
    }
  } catch (error) {
    console.log(`  ✗ ΣΦΑΛΜΑ ΡΟΗΣ: ${error.message}`);
  }

  console.log('\n=== SoundCloud (εφεδρική πηγή) ===');
  try {
    const sc = await player.search(TEST_SEARCH, { searchEngine: QueryType.SOUNDCLOUD_SEARCH });
    console.log(`  extractor: ${sc.extractor?.identifier || 'N/A'}`);
    console.log(`  tracks:    ${sc.tracks.length}`);
    if (!sc.tracks[0]) throw new Error('καμία αναζήτηση δεν επέστρεψε κομμάτι');
    console.log(`  first:     ${sc.tracks[0].title}`);

    const bytes = await countBytes(await sc.extractor.stream(sc.tracks[0]));
    bytes > 0
      ? console.log(`  ✓ ${Math.round(bytes / 1024)}KB — το SoundCloud δουλεύει ως εφεδρεία.`)
      : console.log('  ✗ 0 bytes — η εφεδρεία δεν παίζει.');
  } catch (error) {
    console.log(`  ✗ ${error.message}`);
  }

  console.log('');
  process.exit(0);
})().catch((error) => {
  console.error('\nΤΟ ΕΡΓΑΛΕΙΟ ΑΠΕΤΥΧΕ:', error);
  process.exit(1);
});
