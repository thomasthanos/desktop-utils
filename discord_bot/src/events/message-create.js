const { handlePrefixMessage } = require('../prefix-commands');
const { handleDirectMessage } = require('../dm-replies');
const log = require('../utils/logger')('prefix');

function register({ client, database, sync }) {
  const { emitDashboardSync, emitCommandLogsSync } = sync;

  client.on('messageCreate', async (message) => {
    try {
      if (!message.guild) {
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
