const { Player } = require('discord-player');
const { YoutubeiExtractor } = require('discord-player-youtubei');
const { DefaultExtractors } = require('@discord-player/extractor');
const log = require('./utils/logger')('player');

/**
 * Στήσιμο του discord-player και των extractors του.
 */
function createPlayer(client) {
  return new Player(client);
}

/**
 * Καταχώρηση του YouTube extractor.
 *
 * ΠΡΟΣΟΧΗ στο `await`: το `extractors.register()` επιστρέφει Promise που
 * τρέχει το `activate()` του extractor — εκεί δημιουργείται η συνεδρία
 * InnerTube. Χωρίς αναμονή, το `handle()` μπορεί να κληθεί με `innerTube`
 * ακόμα undefined, και το σφάλμα που προκύπτει το καταπίνει το discord-player
 * και το εμφανίζει ως «No results found (Extractor: N/A)» — μήνυμα που δείχνει
 * προς το YouTube ενώ το πρόβλημα είναι εντελώς τοπικό.
 */
async function registerYoutube(player) {

  // Το YouTube μπλοκάρει τα datacenter IPs. Οι δύο ρυθμίσεις παρακάτω είναι οι
  // βασικές άμυνες και είναι ενεργές από προεπιλογή — μια ρύθμιση που πρέπει
  // να τη θυμηθείς στον server είναι ρύθμιση που θα ξεχαστεί.
  //
  // PoToken: αποδεικνύει στο YouTube ότι το αίτημα προέρχεται από πραγματικό
  // περιβάλλον browser. Ιδιαίτερα σημαντικό επειδή χρησιμοποιούμε
  // useServerAbrStream — το SABR απαιτεί έγκυρο PoToken. Κόστος ~40-60MB RAM
  // για το jsdom· αν σε στριμώξει η μνήμη, YT_POTOKEN=0.
  const usePoToken = String(process.env.YT_POTOKEN ?? '1') !== '0';
  // Δεύτερη διαδρομή επίλυσης ροής μέσω yt-dlp, με δική της περιοδική
  // αυτοενημέρωση. Απενεργοποίηση με YT_USE_YTDLP=0.
  const useYoutubeDL = String(process.env.YT_USE_YTDLP ?? '1') !== '0';

  // Ο InnerTube client που δηλώνουμε στο YouTube. Ήταν 'ANDROID' — ακριβώς
  // αυτός που μπλοκάρεται από datacenter IPs με «Sign in to confirm you're not
  // a bot». Το TV_EMBEDDED περνάει καθαρά χωρίς cookies και χωρίς λογαριασμό,
  // επιβεβαιωμένο στον ίδιο τον server.
  //
  // Έγκυρες τιμές (youtubei.js InnerTubeClient): IOS, WEB, MWEB, ANDROID,
  // YTMUSIC, YTMUSIC_ANDROID, YTSTUDIO_ANDROID, TV, TV_SIMPLY, TV_EMBEDDED,
  // YTKIDS, WEB_EMBEDDED, WEB_CREATOR.
  const innertubeClient = process.env.YT_CLIENT || 'TV_EMBEDDED';

  // disablePlayer=true λέει στον extractor να μη φέρει δεδομένα player· τότε
  // για ΑΜΕΣΟ video URL δεν υπάρχει format να επιλεγεί και το handle() σκάει
  // με «Streaming data not available». Η αναζήτηση με κείμενο δουλεύει έτσι κι
  // αλλιώς, γι' αυτό το πρόβλημα φαινόταν μόνο στα links.
  const disablePlayer = String(process.env.YT_DISABLE_PLAYER ?? '0') !== '0';

  // SABR (server-side adaptive bitrate) απαιτεί έγκυρο PoToken και συνεργασία
  // του client. Όταν αποτυγχάνει, δεν πετάει σφάλμα — επιστρέφει ροή που
  // τελειώνει ακαριαία και άδεια, οπότε το bot νομίζει ότι το τραγούδι
  // τελείωσε. Ακριβώς το «λέει ότι παίζει αλλά δεν ακούγεται τίποτα».
  const useServerAbrStream = String(process.env.YT_SABR ?? '0') !== '0';

  await player.extractors.register(YoutubeiExtractor, {
    disablePlayer,
    overrideBridgeMode: 'yt',
    useServerAbrStream,
    generateWithPoToken: usePoToken,
    useYoutubeDL,
    // Σιωπηλός από προεπιλογή, αλλά ρυθμιζόμενος: με NONE, μια αποτυχία του
    // extractor εμφανίζεται ως ένα ανεξήγητο «Extractor: N/A» και δεν έχεις
    // τίποτα να κοιτάξεις. YT_LOG_LEVEL=DEBUG για διάγνωση.
    logLevel: process.env.YT_LOG_LEVEL || 'NONE',
    // Raw Cookie header — ΔΙΑΦΟΡΕΤΙΚΗ μορφή από το YT_COOKIES_FILE (Netscape)
    // που χρησιμοποιεί το yt-dlp για το ραδιόφωνο. Το μπέρδεμά τους είναι ο
    // κλασικός τρόπος να «μη δουλεύουν τα cookies».
    cookie: process.env.YT_COOKIE || undefined,
    // 1MB buffer. Ήταν 1<<25 (32MB) ανά stream — υπερβολικό για server με 2GB
    // και δεν αγοράζει τίποτα: το bottleneck είναι το δίκτυο, όχι το buffer.
    streamOptions: { useClient: innertubeClient, highWaterMark: 1 << 20 }
  });

  // Επιβεβαίωση ότι η συνεδρία στήθηκε όντως. Χωρίς αυτόν τον έλεγχο, μια
  // αποτυχία εμφανίζεται αργότερα ως «δεν βρέθηκαν αποτελέσματα» σε κάθε
  // αναζήτηση, χωρίς τίποτα στα logs να δείχνει προς την πραγματική αιτία.
  const extractor = player.extractors.store.get(YoutubeiExtractor.identifier);
  if (!extractor?.innerTube) {
    throw new Error(
      'The YouTube extractor registered but its InnerTube session is missing. '
      + 'Every /play will fail with "No results found". '
      + 'Run `npm run diag:extractors` for details.'
    );
  }

  log.info(
    `YouTube extractor ready: client=${innertubeClient}, PoToken=${usePoToken ? 'on' : 'off'}, `
    + `SABR=${useServerAbrStream ? 'on' : 'off'}, yt-dlp fallback=${useYoutubeDL ? 'on' : 'off'}`
  );
}

async function initializeExtractors(player) {
  // Ο YouTube πρώτος και με await — είναι ο μόνος που χρειάζεται δικτυακή
  // αρχικοποίηση, και είναι αυτός που χρησιμοποιείται περισσότερο.
  await registerYoutube(player);

  const extractorOptions = {};

  // Το SoundCloud ήταν εξαιρεσμένο επειδή άρπαζε ερωτήματα που προορίζονταν
  // για το YouTube και επέστρεφε λάθος κομμάτια. Πλέον χρειάζεται ως ΕΦΕΔΡΕΙΑ:
  // το YouTube αρνείται ορισμένα βίντεο σε datacenter IP, και το SoundCloud δεν
  // έχει τέτοιον έλεγχο. Παραμένει δεύτερη επιλογή — το /play δοκιμάζει πρώτα
  // YouTube και πέφτει εδώ μόνο όταν αποτύχει, οπότε ο αρχικός λόγος εξαίρεσης
  // δεν ισχύει.
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
