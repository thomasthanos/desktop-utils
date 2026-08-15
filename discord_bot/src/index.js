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

// Το youtubei.js είναι πολύ φλύαρο από προεπιλογή. Το logLevel του extractor
// ελέγχει τη ΔΙΚΗ του καταγραφή, όχι αυτή της βιβλιοθήκης.
Log.setLevel(Log.Level.ERROR);

acquireInstanceLock();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    // Privileged — πρέπει να ενεργοποιηθούν και στο Developer Portal.
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites
  ],
  // Χωρίς το Partials.Channel το `messageCreate` ΔΕΝ φτάνει ποτέ για DM κανάλι
  // που δεν βρίσκεται ήδη στη μνήμη — και ένα DM από κάποιον που δεν σου έχει
  // ξαναγράψει είναι πάντα σε τέτοιο κανάλι. Το intent από μόνο του δεν αρκεί.
  partials: [Partials.Channel, Partials.Message]
});

// Κοινή κατάσταση, κρεμασμένη στον client ώστε να τη βλέπουν όλοι οι handlers.
client.commands = new Collection();
client.inviteCache = new Collection();
client.currentTrack = null;
client.trackFallbackAttempts = new Set();
client.pendingStreamFallbacks = 0;
client.lastAnnouncedTrackByGuild = new Map();
client.autoIdleGuilds = new Set();
client.musicEmbedByGuild = new Map();
client.emptyQueueTimers = new Map();

const { slashCommands, dmCommands } = loadCommands(client);

const player = createPlayer(client);
client.player = player;

// Γεμίζει στο clientReady· ο τερματισμός το χρειάζεται για να κλείσει το
// dashboard, οπότε περνιέται ως αντικείμενο και όχι ως τιμή.
const runtime = { dashboard: null };

installLifecycle({ client, database, runtime });

const sync = createDashboardSync(client);
const embeds = createEmbedManager(client);

// Ένα αρχείο ανά ομάδα γεγονότων. Καθένα δηλώνει τι χρειάζεται αντί να
// κλείνει πάνω σε ένα αρχείο 700 γραμμών.
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
  // Η βάση αρχικοποιείται πλέον σύγχρονα στο require· η ready() μένει για
  // συμβατότητα και σε περίπτωση που ξαναγίνει ασύγχρονη.
  await database.ready();
  log.info(`Prefix commands enabled with prefix: ${PREFIX}`);
  await initializeExtractors(player);
  await client.login(DISCORD_TOKEN);
}

bootstrap().catch((error) => {
  log.error('Failed to start bot:', error);
  process.exit(1);
});
