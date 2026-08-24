function createDashboardSync(client) {
  let timer = null;

  function emitDashboardSync() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      client.emit('dashboard:sync');
    }, 80);
  }

  function emitCommandLogsSync() {
    client.emit('dashboard:commandLogs');
  }

  return { emitDashboardSync, emitCommandLogsSync };
}

module.exports = { createDashboardSync };
