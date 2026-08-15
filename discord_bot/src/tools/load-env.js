const fs = require('fs');
const path = require('path');

/**
 * Φορτώνει τις ίδιες μεταβλητές που βλέπει η υπηρεσία.
 *
 * Υπάρχει επειδή τα μυστικά ζουν σε ΔΥΟ διαφορετικά σημεία ανάλογα με το πού
 * τρέχεις:
 *
 *   τοπικά   `.env` δίπλα στο package.json
 *   server   `/etc/discord-bot.env`, το EnvironmentFile του systemd
 *
 * Ένα διαγνωστικό που διαβάζει μόνο το πρώτο λέει «ΔΕΝ ΕΧΕΙ ΟΡΙΣΤΕΙ» για ένα
 * κλειδί που το bot χρησιμοποιεί κανονικά — δηλαδή σου δίνει λάθος απάντηση
 * ακριβώς όταν το εμπιστεύεσαι. Ακριβώς αυτό συνέβη με το `diag:ai`.
 *
 * Το `/etc/discord-bot.env` είναι `chmod 600 root:root` επίτηδες, οπότε ένα
 * script που τρέχει ως `discordbot` ΔΕΝ μπορεί να το διαβάσει. Αυτό δεν είναι
 * αποτυχία προς σιωπηλή απόκρυψη — είναι η αιτία, και επιστρέφεται.
 *
 * Το dotenv δεν πατάει ό,τι υπάρχει ήδη στο περιβάλλον, οπότε η σειρά σημαίνει
 * προτεραιότητα: ό,τι έχει ήδη το systemd κερδίζει.
 *
 * @returns {{sources: string[], unreadable: string|null}}
 */
function loadEnv() {
  const sources = [];
  let unreadable = null;

  const local = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(local)) {
    require('dotenv').config({ path: local });
    sources.push(local);
  }

  const serviceFile = process.env.ENV_FILE || '/etc/discord-bot.env';
  try {
    fs.accessSync(serviceFile, fs.constants.R_OK);
    require('dotenv').config({ path: serviceFile });
    sources.push(serviceFile);
  } catch (error) {
    // ENOENT σημαίνει απλώς «δεν είναι εγκατάσταση server» — φυσιολογικό τοπικά.
    if (error.code === 'EACCES') unreadable = serviceFile;
  }

  return { sources, unreadable };
}

module.exports = { loadEnv };
