/**
 * Ειδοποιήσεις προς το dashboard.
 *
 * Οι μεταβάσεις κομματιών παράγουν ριπές γεγονότων (finish, trackRemove,
 * start, volume). Χωρίς debounce κάθε μία θα προκαλούσε πλήρη ανασύνθεση του
 * payload και εκπομπή σε κάθε συνδεδεμένο socket.
 */
function createDashboardSync(client) {
  let timer = null;

  function emitDashboardSync() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      client.emit('dashboard:sync');
    }, 80);
  }

  /** Για ενέργειες του χρήστη, όπου η καθυστέρηση 80ms γίνεται αισθητή. */
  function emitDashboardSyncImmediate() {
    if (timer) { clearTimeout(timer); timer = null; }
    client.emit('dashboard:sync');
  }

  function emitCommandLogsSync() {
    client.emit('dashboard:commandLogs');
  }

  return { emitDashboardSync, emitDashboardSyncImmediate, emitCommandLogsSync };
}

module.exports = { createDashboardSync };
