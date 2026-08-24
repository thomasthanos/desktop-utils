require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const { Log } = require('youtubei.js');

const database = require('./database');
const { loadCommands } = require('./command-loader');
const { createPlayer, initializeExtractors } = require('./player');
const { acquireInstanceLock, installLifecycle } = require('./lifecycle');
const { createDashboardSync } = require('./utils/dashboard-sync');
const { createEmbedManager } = require('./utils/embeds');
const { PREFIX } = require('./prefix-commands');
const log = require('./utils/logger')('bot');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!DISCORD_TOKEN) throw new Error('Missing DISCORD_TOKEN (or DISCORD_BOT_TOKEN) in .env');

Log.setLevel(Log.Level.ERROR);

acquireInstanceLock();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,

    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,

    GatewayIntentBits.GuildModeration
  ],

  partials: [Partials.Channel, Partials.Message]
});

client.commands = new Collection();
client.inviteCache = new Collection();
client.currentTrackByGuild = new Map();
client.trackFallbackAttempts = new Set();
client.pendingStreamFallbacks = 0;
client.lastAnnouncedTrackByGuild = new Map();
client.autoIdleGuilds = new Set();
client.musicEmbedByGuild = new Map();
client.emptyQueueTimers = new Map();
client.lastTrackByGuild = new Map();

const { slashCommands, dmCommands } = loadCommands(client);

const player = createPlayer(client);
client.player = player;

const runtime = { dashboard: null };

installLifecycle({ client, database, runtime });

const sync = createDashboardSync(client);
const embeds = createEmbedManager(client);

const context = {
  client, database, player, sync, embeds, runtime, slashCommands, dmCommands, token: DISCORD_TOKEN
};
for (const module of [
  require('./events/client-ready'),
  require('./events/player-events'),
  require('./events/interaction-create'),
  require('./events/message-create'),
  require('./events/guild-events'),
  require('./events/voice-state')
]) {
  module.register(context);
}

async function bootstrap() {
  await database.ready();
  log.info(`Prefix commands enabled with prefix: ${PREFIX}`);
  await initializeExtractors(player);
  await client.login(DISCORD_TOKEN);
}

bootstrap().catch((error) => {
  log.error('Failed to start bot:', error);
  process.exit(1);
});
