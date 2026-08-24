const { Player } = require('discord-player');
const { YoutubeiExtractor } = require('discord-player-youtubei');
const { DefaultExtractors } = require('@discord-player/extractor');
const log = require('./utils/logger')('player');

function createPlayer(client) {
  return new Player(client);
}

async function registerYoutube(player) {
  const usePoToken = String(process.env.YT_POTOKEN ?? '1') !== '0';

  const useYoutubeDL = String(process.env.YT_USE_YTDLP ?? '1') !== '0';

  const innertubeClient = process.env.YT_CLIENT || 'TV_EMBEDDED';

  const disablePlayer = String(process.env.YT_DISABLE_PLAYER ?? '0') !== '0';

  const useServerAbrStream = String(process.env.YT_SABR ?? '0') !== '0';

  await player.extractors.register(YoutubeiExtractor, {
    disablePlayer,
    overrideBridgeMode: 'yt',
    useServerAbrStream,
    generateWithPoToken: usePoToken,
    useYoutubeDL,

    logLevel: process.env.YT_LOG_LEVEL || 'NONE',

    cookie: process.env.YT_COOKIE || undefined,

    authentication: process.env.YT_OAUTH || undefined,

    streamOptions: { useClient: innertubeClient, highWaterMark: 1 << 20 }
  });

  const extractor = player.extractors.store.get(YoutubeiExtractor.identifier);
  if (!extractor?.innerTube) {
    throw new Error(
      'The YouTube extractor registered but its InnerTube session is missing. '
      + 'Every /play will fail with "No results found". '
      + 'Run `npm run diag:extractors` for details.'
    );
  }

  log.info(
    `YouTube extractor ready: client=${innertubeClient}, auth=${process.env.YT_COOKIE ? 'cookie' : process.env.YT_OAUTH ? 'oauth' : 'none'}, `
    + `PoToken=${usePoToken ? 'on' : 'off'}, SABR=${useServerAbrStream ? 'on' : 'off'}, `
    + `yt-dlp fallback=${useYoutubeDL ? 'on' : 'off'}`
  );
}

async function initializeExtractors(player) {
  await registerYoutube(player);

  const extractorOptions = {};

  const enableSoundcloud = String(process.env.ENABLE_SOUNDCLOUD ?? '1') !== '0';
  const extractors = enableSoundcloud
    ? DefaultExtractors
    : DefaultExtractors.filter(
      (Extractor) => Extractor.identifier !== 'com.discord-player.soundcloudextractor'
    );

  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    extractorOptions['com.discord-player.spotifyextractor'] = {
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      bridgeSearch: true
    };
  } else {
    log.info('Spotify credentials are not set — Spotify links fall back to a YouTube search.');
  }

  await player.extractors.loadMulti(extractors, extractorOptions);
}

module.exports = { createPlayer, initializeExtractors };
