const fs = require('fs');
const path = require('path');
const { getVoiceConnection } = require('@discordjs/voice');
const { stopIdleLive } = require('./idle-live');
const { expectLeave } = require('./utils/voice-departure');
const log = require('./utils/logger')('lifecycle');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const INSTANCE_LOCK_FILE = path.join(DATA_DIR, '.bot.instance.lock');

const INSTANCE_LOCK_ENABLED = String(process.env.INSTANCE_LOCK || '0') !== '0';

function isOurProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('node');
  } catch {
    return true;
  }
}

function acquireInstanceLock() {
  if (!INSTANCE_LOCK_ENABLED) return;
  try {
    if (fs.existsSync(INSTANCE_LOCK_FILE)) {
      const raw = fs.readFileSync(INSTANCE_LOCK_FILE, 'utf8').trim();
      const existingPid = Number.parseInt(raw, 10);
      if (isOurProcessAlive(existingPid) && existingPid !== process.pid) {
        throw new Error(`Another bot instance is already running (PID ${existingPid}). Stop it first.`);
      }
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INSTANCE_LOCK_FILE, String(process.pid), 'utf8');
  } catch (error) {
    throw new Error(`Failed to acquire instance lock: ${error.message}`);
  }
}

function releaseInstanceLock() {
  if (!INSTANCE_LOCK_ENABLED) return;
  try {
    if (!fs.existsSync(INSTANCE_LOCK_FILE)) return;
    const raw = fs.readFileSync(INSTANCE_LOCK_FILE, 'utf8').trim();
    if (Number.parseInt(raw, 10) === process.pid) fs.unlinkSync(INSTANCE_LOCK_FILE);
  } catch (error) {
    log.warn('Could not release instance lock:', error.message);
  }
}

function installLifecycle({ client, database, runtime }) {
  let shuttingDown = false;

  async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    client.shuttingDown = true;
    for (const guildId of client.guilds?.cache?.keys() || []) expectLeave(client, guildId, 60000);
    log.info(`${signal} received — closing down`);

    const hardExit = setTimeout(() => {
      log.error('Teardown timed out after 10s — forcing exit');
      process.exit(exitCode || 1);
    }, 10_000);
    hardExit.unref();

    for (const guildId of [...(client.idleLiveSessions?.keys() || [])]) {
      try {
        await stopIdleLive(client, guildId, { clearPersisted: false });
      } catch (error) {
        log.warn(`idle session ${guildId}:`, error.message);
      }
    }

    for (const queue of [...(client.player?.nodes?.cache?.values() || [])]) {
      try {
        queue.delete();
      } catch (error) {
        log.warn('queue teardown:', error.message);
      }
    }

    for (const guildId of client.guilds.cache.keys()) {
      try {
        getVoiceConnection(guildId)?.destroy();
      } catch {}
    }

    try {
      await client.destroy();
    } catch (error) {
      log.warn('client.destroy:', error.message);
    }

    if (runtime.dashboard?.server) {
      await new Promise((resolve) => {
        runtime.dashboard.server.close(() => resolve());

        runtime.dashboard.io?.close();
        setTimeout(resolve, 3000).unref();
      });
    }

    try {
      if (exitCode === 0) database.setStat('clean_shutdown', '1');
      database.close();
    } catch (error) {
      log.warn('database.close:', error.message);
    }

    releaseInstanceLock();
    clearTimeout(hardExit);
    log.info('Clean exit');
    process.exit(exitCode);
  }

  process.on('exit', releaseInstanceLock);
  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection:', reason);
  });

  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception:', error);
    shutdown('uncaughtException', 1);
  });

  return shutdown;
}

module.exports = { acquireInstanceLock, releaseInstanceLock, installLifecycle, DATA_DIR };
