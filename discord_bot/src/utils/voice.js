/**
 * Πρωτογενή βοηθητικά για φωνή και ουρές.
 *
 * Ξεχωριστό αρχείο από το [utils/music.js](src/utils/music.js) επίτηδες: εκείνο
 * κάνει `require` το `idle-live` και το `idle-pending`, οπότε αν το
 * `idle-pending` το χρειαζόταν πίσω θα προέκυπτε κύκλος — και σε CommonJS ο
 * κύκλος δεν σκάει, απλώς δίνει μισοάδειο `exports` ανάλογα με τη σειρά
 * φόρτωσης. Εδώ μπαίνει μόνο ο logger, που είναι φύλλο και δεν χρειάζεται
 * τίποτα πίσω.
 */
const log = require('./logger')('voice');

/** Πόσοι πραγματικοί άνθρωποι είναι στο κανάλι — τα bots δεν μετράνε. */
function countHumans(channel) {
  if (!channel?.members) return 0;
  return channel.members.filter((member) => !member.user.bot).size;
}

/**
 * Ίδια σημασιολογία με το `Util.isVoiceEmpty` του discord-player, σκόπιμα:
 * ανύπαρκτο κανάλι δεν είναι «άδειο», είναι «άγνωστο». Αν επέστρεφε `true`,
 * κάθε έλεγχος πάνω σε bot εκτός φωνής θα φαινόταν σαν άδειο κανάλι και θα
 * πυροδοτούσε αποσύνδεση που δεν έχει νόημα.
 */
function isVoiceEmpty(channel) {
  if (!channel?.members) return false;
  return countHumans(channel) === 0;
}

/**
 * Οι ρυθμίσεις με τις οποίες δημιουργείται μια ουρά του discord-player.
 *
 * Ήταν αντιγραμμένες αυτούσιες σε ΕΠΤΑ σημεία (play.js ×3, idle-pending.js ×2,
 * player-events.js ×2). Κάθε αλλαγή συμπεριφοράς έπρεπε να γίνει επτά φορές
 * χωρίς να ξεχαστεί καμία, και ένα σημείο που ξεχνιόταν θα έδινε ουρά με
 * διαφορετικούς κανόνες από τις υπόλοιπες — χωρίς κανένα ορατό σύμπτωμα μέχρι
 * να τύχει να δημιουργηθεί η ουρά από εκείνο ακριβώς το σημείο.
 *
 * ΤΡΕΙΣ ανεξάρτητες ρυθμίσεις αποσυνδέουν το bot, όχι μία:
 *   leaveOnEmpty — άδειασε το κανάλι
 *   leaveOnEnd   — τελείωσε η ουρά (ισχύει ΚΑΙ σε γεμάτο κανάλι)
 *   leaveOnStop  — έγινε /stop
 *
 * @param {object} database
 * @param {string} guildId
 * @param {object} metadata περνιέται αυτούσιο (δύο call sites δίνουν queue.metadata)
 * @param {object} [overrides]
 */
function buildNodeOptions(database, guildId, metadata, overrides = {}) {
  // Το 24/7 πρέπει να ακυρώσει ΚΑΙ ΤΙΣ ΤΡΕΙΣ. Ακυρώνοντας μόνο το προφανές
  // (leaveOnEmpty), το bot θα έφευγε ούτως ή άλλως πέντε λεπτά μετά το
  // τελευταίο τραγούδι — σε γεμάτο κανάλι, χωρίς κανένα ορατό αίτιο.
  const stay = Boolean(database.getStay247?.(guildId));

  return {
    metadata,
    leaveOnEnd: !stay,
    leaveOnEndCooldown: 300000,
    leaveOnStop: !stay,
    leaveOnStopCooldown: 120000,
    // Το `leaveOnEmpty` δεν δηλωνόταν πουθενά, άρα ίσχυε σιωπηλά η προεπιλογή
    // του discord-player: `true` με cooldown `0` — αποσύνδεση την ίδια στιγμή
    // που φεύγει ο τελευταίος. Πέντε λεπτά χάρης σημαίνει ότι μια πτώση
    // σύνδεσης ή ένα σύντομο βγες-μπες δεν κόβει τη μουσική.
    //
    // ΔΕΝ γράφουμε δικό μας χρονομετρητή γι' αυτή τη διαδρομή: το
    // discord-player τον ακυρώνει μόνο του αν γυρίσει κάποιος και ξαναελέγχει
    // πριν ενεργήσει (DefaultVoiceStateHandler). Δεύτερος χρονομετρητής θα
    // πάλευε μαζί του.
    leaveOnEmpty: !stay,
    leaveOnEmptyCooldown: emptyGraceMs(),
    volume: database.getGuildVolume(guildId),
    ...overrides
  };
}

const DEFAULT_EMPTY_GRACE_MS = 300000;

/**
 * Πόση ώρα χάρης πριν φύγει το bot από άδειο κανάλι.
 * Κοινή για τις δύο διαδρομές (ουρά και ραδιόφωνο) — δύο διαφορετικοί χρόνοι
 * θα ήταν ανεξήγητοι για όποιον τους ζει.
 */
function emptyGraceMs() {
  const raw = Number(process.env.VOICE_EMPTY_GRACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_EMPTY_GRACE_MS;
}

/**
 * Σε ποιο guild είναι αυτή τη στιγμή σε κανάλι φωνής ο χρήστης.
 *
 * Υπάρχει για τα DM. Ένα DM δεν κουβαλάει guild, οπότε ένα «βάλε Mad Clip»
 * έφτανε στον εκτελεστή με `guildId: null` και απαντούσε «μόνο μέσα σε server»
 * ενώ ο χρήστης ήταν ήδη σε κανάλι φωνής — τεχνικά σωστό, πρακτικά λάθος.
 *
 * Η απάντηση είναι μονοσήμαντη: το Discord επιτρέπει ΜΙΑ σύνδεση φωνής ανά
 * λογαριασμό, οπότε δεν υπάρχει περίπτωση να διαλέγουμε ανάμεσα σε δύο.
 *
 * Διαβάζει από το `voiceStates.cache`, που γεμίζει από το GUILD_CREATE και τα
 * voiceStateUpdate — όχι από το `members.cache`, που μπορεί να είναι άδειο.
 *
 * @returns {Promise<{guild: object, member: object}|null>}
 */
async function findUserVoiceGuild(client, userId) {
  if (!userId) return null;

  // Καταγράφεται τι σαρώθηκε, γιατί η αποτυχία εδώ είναι διφορούμενη: «δεν
  // είσαι σε φωνή» και «το bot δεν είναι σε ΑΥΤΟΝ τον server» δίνουν το ίδιο
  // αποτέλεσμα και θέλουν τελείως διαφορετική λύση.
  const scanned = [];

  for (const guild of client.guilds?.cache?.values?.() || []) {
    const state = guild.voiceStates?.cache?.get(userId);
    scanned.push(`${guild.name}${state?.channelId ? '=' + state.channelId : ''}`);
    if (!state?.channelId) continue;

    // Το `state.member` μπορεί να λείπει αν δεν έχει καθαριστεί ποτέ ο χρήστης
    // στη μνήμη. Χωρίς member δεν υπάρχει `member.voice.channel`, που είναι
    // ακριβώς αυτό που χρειάζεται ο εκτελεστής του /play.
    const member = state.member
      || guild.members?.cache?.get(userId)
      || await guild.members?.fetch?.(userId).catch(() => null);

    if (member) return { guild, member };
    log.warn(`${userId} is in voice in ${guild.name} but the member could not be resolved.`);
  }

  log.info(`No voice channel found for ${userId}. Guilds searched: ${scanned.join(', ') || 'ΚΑΝΕΝΑ'}`);
  return null;
}

/**
 * Εφαρμόζει τη σημαία 24/7 σε ουρά που ΗΔΗ τρέχει.
 *
 * Οι ρυθμίσεις της ουράς παγώνουν τη στιγμή της δημιουργίας. Χωρίς αυτό, το
 * `/247 on` θα ίσχυε μόνο για την επόμενη ουρά — δηλαδή θα «δούλευε» και το
 * bot θα έφευγε μπροστά στα μάτια σου.
 *
 * @returns {boolean} αν υπήρχε ουρά να πειραχτεί
 */
function applyStay247(queue, stay) {
  if (!queue?.options) return false;

  queue.options.leaveOnEnd = !stay;
  queue.options.leaveOnStop = !stay;
  queue.options.leaveOnEmpty = !stay;

  // Ένας χρονομετρητής «άδειο κανάλι» μπορεί ήδη να μετράει. Ο έλεγχος του
  // discord-player τη στιγμή της πυροδότησης κοιτάει το `leaveOnEmpty`, οπότε
  // τεχνικά θα σεβόταν την αλλαγή — τον ακυρώνουμε ούτως ή άλλως ώστε να μη
  // μείνει τίποτα εκκρεμές.
  //
  // ΠΡΟΣΟΧΗ σε ό,τι ΔΕΝ καλύπτεται: το `leaveOnEnd` του discord-player φτιάχνει
  // τοπικό timeout που δεν το αποθηκεύει πουθενά και δεν ξαναελέγχει τη σημαία
  // όταν χτυπήσει. Αν ενεργοποιήσεις το 24/7 μέσα στα 5 λεπτά που ακολουθούν
  // το τελευταίο τραγούδι, το bot θα αποσυνδεθεί εκείνη τη φορά. Το επόμενο
  // /play φτιάχνει καθαρή ουρά και όλα δουλεύουν.
  if (stay && queue.timeouts) {
    for (const [key, timer] of queue.timeouts) {
      if (!String(key).startsWith('empty_')) continue;
      clearTimeout(timer);
      queue.timeouts.delete(key);
    }
  }

  return true;
}

module.exports = {
  countHumans,
  isVoiceEmpty,
  buildNodeOptions,
  emptyGraceMs,
  applyStay247,
  findUserVoiceGuild
};
