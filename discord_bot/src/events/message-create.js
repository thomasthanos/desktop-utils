const { handlePrefixMessage } = require('../prefix-commands');
const { handleDirectMessage } = require('../dm-replies');
const log = require('../utils/logger')('prefix');

function register({ client, database, sync }) {
  const { emitDashboardSync, emitCommandLogsSync } = sync;

  client.on('messageCreate', async (message) => {
    try {
      // Τα DM φεύγουν ΠΡΙΝ τον router των prefix εντολών, ο οποίος τα απορρίπτει
      // σκόπιμα (χρειάζεται guild για τον έλεγχο δικαιωμάτων). Χωρίς αυτόν τον
      // κλάδο, ένα DM στο bot απλώς δεν παίρνει καμία απάντηση.
      if (!message.guild) {
        // Μερικό μήνυμα: ήρθε από το Partials.Channel και δεν έχει περιεχόμενο
        // ακόμα. Χωρίς fetch, το `content` είναι κενό και απαντάμε στα τυφλά.
        if (message.partial) await message.fetch().catch(() => {});
        await handleDirectMessage(message, client, database);
        return;
      }

      const handled = await handlePrefixMessage(
        message, client, database, emitCommandLogsSync, emitDashboardSync
      );
      if (handled) emitDashboardSync();
    } catch (error) {
      log.error('prefix message handler error:', error);
    }
  });
}

module.exports = { register };
