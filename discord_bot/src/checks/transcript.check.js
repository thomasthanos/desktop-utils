#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const { start, ROOT } = require('./harness');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));

const { serializeMessage, extensionOf } = require(path.join(ROOT, 'src/utils/transcript.js'));

const { fail, section, check, finish } = start();

function fakeMessage(overrides = {}) {
  return {
    id: '1',
    author: { id: 'u1', tag: 'user#0001', displayAvatarURL: () => null },
    content: 'hello',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    attachments: new Map(),
    embeds: [],
    stickers: new Map(),
    ...overrides
  };
}

async function main() {
  section('Working out the file extension');
  {
    check(extensionOf('https://media.tenor.com/abc.gif', 'png') === 'gif', 'a plain .gif is kept');
    check(extensionOf('https://cdn.discordapp.com/x/y.png?size=128&q=1', 'jpg') === 'png', 'query strings are ignored');
    check(extensionOf('https://tenor.com/view/no-extension-here', 'png') === 'png', 'no extension falls back');
    check(extensionOf('https://x/y.verylongthing', 'png') === 'png', 'nonsense falls back');
    check(extensionOf(null, 'png') === 'png', 'a missing url falls back');
    check(extensionOf('https://x/a.b/c.webp', 'png') === 'webp', 'only the last segment counts');
  }

  section('What a transcript entry carries');
  {
    const entry = await serializeMessage(fakeMessage(), 'g1');

    check(Array.isArray(entry.attachments), 'attachments are recorded');
    check(Array.isArray(entry.stickers), 'stickers have their own list, they used to be dropped entirely');
    check(Array.isArray(entry.embeds), 'embeds are recorded');
    check('authorAvatarFilePath' in entry, 'there is a slot for the avatar copy');
    check(entry.author === 'user#0001' && entry.content === 'hello', 'the basics still work');
  }

  section('Media that is a link, not an attachment');
  {
    const withEmbed = await serializeMessage(fakeMessage({
      embeds: [{
        title: null, description: null, url: 'https://tenor.com/view/x',
        image: { url: 'https://example.invalid/x.gif' },
        thumbnail: { url: 'https://example.invalid/t.gif' },
        video: null,
        fields: []
      }]
    }), 'g1');

    const embed = withEmbed.embeds[0];
    check('imageFilePath' in embed, 'an embed image gets a slot for its local copy');
    check('thumbnailFilePath' in embed, 'so does the thumbnail');
    check(embed.image === 'https://example.invalid/x.gif', 'the original url is still kept as a fallback');
  }

  section('Lottie stickers are skipped, the rest are kept');
  {
    const stickers = new Map([
      ['a', { id: 'a', name: 'png-one', format: 1, url: 'https://example.invalid/1.png' }],
      ['b', { id: 'b', name: 'lottie-one', format: 3, url: 'https://example.invalid/2.json' }]
    ]);

    const entry = await serializeMessage(fakeMessage({ stickers }), 'g1');
    check(entry.stickers.length === 1, 'the animated-json sticker is left out, it cannot be shown');
    check(entry.stickers[0]?.name === 'png-one', 'the picture sticker is kept');
  }

  section('The transcript page prefers the copy on disk');
  {
    const view = fs.readFileSync(path.join(ROOT, 'src/dashboard/views/transcript.ejs'), 'utf8');

    check(view.includes('embed.imageFilePath'), 'embed images read the stored copy first');
    check(view.includes('msg.authorAvatarFilePath'), 'avatars read the stored copy first');
    check(view.includes('msg.stickers'), 'stickers are rendered');
    check(view.includes('normalizeMediaUrl(embed.image)'), 'and the remote url is still the fallback');
  }

  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch { /* temp dir */ }

  finish('τα GIF και τα stickers μένουν στον δίσκο, όχι σε ξένη διεύθυνση');
}

main().catch((error) => {
  fail(`unexpected error: ${error.stack || error}`);
  finish('transcript');
});
