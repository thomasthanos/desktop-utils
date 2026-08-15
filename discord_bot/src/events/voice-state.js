const { isIdleLiveActive, stopIdleLive, getIdleLiveSession } = require('../idle-live');
const { isVoiceEmpty, emptyGraceMs } = require('../utils/voice');
const log = require('../utils/logger')('voice');

/**
 * Αποσύνδεση από άδειο κανάλι — τη ΜΙΣΗ δουλειά την κάνει ήδη το discord-player.
 *
 * Οι δύο διαδρομές αναπαραγωγής συμπεριφέρονται τελείως διαφορετικά όταν
 * αδειάζει το κανάλι:
 *
 *   /play (ουρά discord-player) — φεύγει μόνο του. Ρυθμίζεται στο
 *     `buildNodeOptions` και δεν το αγγίζουμε από εδώ.
 *
 *   /idlemusic (ραδιόφωνο) — τρέχει με `NoSubscriberBehavior.Play`, εκτός
 *     discord-player. Παίζει σε άδειο κανάλι για πάντα. Αυτό το αρχείο υπάρχει
 *     γι' αυτή τη διαδρομή και μόνο.
 *
 * Δεν υπήρχε κανένας `voiceStateUpdate` handler πριν — το intent
 * `GuildVoiceStates` ήταν ήδη ενεργό, απλώς κανείς δεν άκουγε.
 */

/**
 * Η μηχανή χρονομέτρησης, χωρίς τίποτα από Discord μέσα της.
 *
 * Ξεχωριστή από το `register` επίτηδες: με πέντε λεπτά χάρης, ένα τεστ που
 * περιμένει πραγματικό χρόνο δεν γράφεται. Έτσι γράφεται με 20ms.
 *
 * @param {object} options
 * @param {number} options.graceMs
 * @param {(guildId: string) => boolean} options.stillEmpty ξαναελέγχει τη
 *   στιγμή που χτυπάει ο χρονομετρητής. Χωρίς αυτό, μια επιστροφή μέσα στα
 *   πέντε λεπτά που για κάποιο λόγο δεν παρήγαγε γεγονός θα κατέληγε σε
 *   αποσύνδεση με κόσμο μέσα.
 * @param {(guildId: string) => void|Promise<void>} options.onEmpty
 */
function createEmptyChannelWatcher({ graceMs, stillEmpty, onEmpty }) {
  const timers = new Map();

  function cancel(guildId) {
    const timer = timers.get(guildId);
    if (!timer) return false;
    clearTimeout(timer);
    timers.delete(guildId);
    return true;
  }

  /** @param {boolean} empty η τρέχουσα κατάσταση του καναλιού */
  function evaluate(guildId, empty) {
    if (!empty) {
      if (cancel(guildId)) log.debug(`someone came back to ${guildId} — countdown cancelled`);
      return;
    }
    // Ήδη μετράει: ΔΕΝ τον ξαναρχίζουμε. Αλλιώς κάποιος που μπαινοβγαίνει θα
    // ανανέωνε τη χάρη επ' άπειρον και το bot δεν θα έφευγε ποτέ.
    if (timers.has(guildId)) return;

    const timer = setTimeout(async () => {
      timers.delete(guildId);
      if (!stillEmpty(guildId)) return;
      try {
        await onEmpty(guildId);
      } catch (error) {
        log.error(`auto-leave failed for ${guildId}:`, error.message || error);
      }
    }, graceMs);

    // Ένας εκκρεμής χρονομετρητής δεν πρέπει να κρατάει τη διεργασία ζωντανή
    // στον τερματισμό.
    timer.unref?.();
    timers.set(guildId, timer);
    log.debug(`${guildId} is empty — leaving in ${Math.round(graceMs / 1000)}s unless someone returns`);
  }

  return {
    evaluate,
    cancel,
    clearAll: () => {
      for (const guildId of [...timers.keys()]) cancel(guildId);
    },
    get pending() {
      return timers.size;
    }
  };
}

function register({ client, database, embeds }) {
  /**
   * Το κανάλι διαβάζεται ΠΑΝΤΑ από το `members.me.voice`, ποτέ από το
   * αποθηκευμένο `joinConfig.channelId` της συνεδρίας: αν κάποιος μετακινήσει
   * το bot με drag-and-drop, το δεύτερο μένει ξεπερασμένο και θα μετρούσαμε
   * τους ανθρώπους σε λάθος κανάλι.
   */
  function botChannelOf(guildId) {
    const guild = client.guilds.cache.get(guildId);
    return guild?.members?.me?.voice?.channel || null;
  }

  /**
   * Το ραδιόφωνο και η ουρά είναι αμοιβαία αποκλειόμενα. Όταν υπάρχει ουρά,
   * ιδιοκτήτης της αποσύνδεσης είναι το discord-player — δύο χρονομετρητές
   * πάνω στο ίδιο κανάλι θα πάλευαν.
   */
  function radioOwnsThisGuild(guildId) {
    // Το 24/7 σημαίνει «μη φύγεις ποτέ» — και για το ραδιόφωνο, όχι μόνο για
    // την ουρά. Ελέγχεται σε κάθε voiceStateUpdate, γι' αυτό το getStay247
    // έχει cache.
    if (database.getStay247(guildId)) return false;
    if (client.player?.nodes?.get(guildId)) return false;
    return isIdleLiveActive(client, guildId);
  }

  const watcher = createEmptyChannelWatcher({
    graceMs: emptyGraceMs(),
    stillEmpty: (guildId) => radioOwnsThisGuild(guildId) && isVoiceEmpty(botChannelOf(guildId)),
    onEmpty: async (guildId) => {
      const channel = botChannelOf(guildId);
      log.info(`Leaving empty voice channel in ${guildId} (radio)`);

      // ΠΡΕΠΕΙ να περάσει από το stopIdleLive: είναι το μόνο σημείο που θέτει
      // `session.stopping` και καθαρίζει το `restartTimer`. Σκέτη καταστροφή
      // της σύνδεσης αφήνει τον βρόχο επανεκκίνησης να χτυπάει για πάντα.
      const textChannel = getIdleLiveSession(client, guildId)?.textChannel || null;
      await stopIdleLive(client, guildId);

      // Χωρίς αυτό, το «τώρα παίζει» μένει ορφανό και δείχνει για πάντα ένα
      // τραγούδι που δεν παίζει.
      await embeds.deleteMusicEmbed(guildId).catch(() => {});

      // Μια γραμμή εξήγησης: αλλιώς η έξοδος του bot μοιάζει με κατάρρευση.
      const minutes = Math.round(emptyGraceMs() / 60000);
      await textChannel?.send(
        `👋 Έφυγα από το **${channel?.name || 'κανάλι φωνής'}** — ήταν άδειο για ${minutes} λεπτά.`
      ).catch(() => {});
    }
  });

  /**
   * Ξαναϋπολογίζει ένα guild εκτός γεγονότος φωνής.
   *
   * Το χρειάζεται το `/247 off`: αν το κανάλι είναι ήδη άδειο εκείνη τη στιγμή,
   * δεν θα έρθει κανένα voiceStateUpdate για να ξεκινήσει η αντίστροφη μέτρηση
   * και το bot θα έμενε εκεί μέχρι να τύχει να μπει ή να βγει κάποιος.
   */
  function refresh(guildId) {
    if (!guildId) return;

    if (!radioOwnsThisGuild(guildId)) {
      watcher.cancel(guildId);
      return;
    }

    const channel = botChannelOf(guildId);
    if (!channel) {
      // Το bot δεν είναι σε φωνή· δεν υπάρχει τίποτα να μετρήσουμε.
      watcher.cancel(guildId);
      return;
    }

    watcher.evaluate(guildId, isVoiceEmpty(channel));
  }

  client.on('voiceStateUpdate', (oldState, newState) => {
    refresh(newState?.guild?.id || oldState?.guild?.id);
  });

  // Το /247 το χρειάζεται για να ισχύσει η αλλαγή αμέσως.
  client.voiceWatcher = { refresh, cancel: watcher.cancel, clearAll: watcher.clearAll };
}

module.exports = { register, createEmptyChannelWatcher };
