const { EmbedBuilder } = require('discord.js');
const { getBotOwnerIds } = require('./authorization');
const log = require('./logger')('notify');
const { emoji, plainEmoji } = require('./emojis');

const COOLDOWN_MS = 60 * 60 * 1000;
const lastSentByType = new Map();

const STYLES = {
  'crash-restart': {
    color: 0xe67e22,
    icon: 'bot_warn',
    title: 'Το bot ξαναξεκίνησε μετά από crash',
    fix: 'Δες τι προηγήθηκε:\n```\njournalctl -u discord-bot --since "30 min ago" -p warning\n```'
  },
  'yt-auth-expired': {
    color: 0xe74c3c,
    icon: 'bot_error',
    title: 'Το YouTube απορρίπτει τα αιτήματα',
    fix: 'Συνήθως λήγουν τα cookies. Δες τη §9 του DEPLOY.md — ή αγνόησέ το αν παίζει μέσω SoundCloud.'
  },
  'disk-pressure': {
    color: 0xe67e22,
    icon: 'bot_warn',
    title: 'Ο δίσκος γεμίζει',
    fix: 'Χαμήλωσε το `ATTACHMENT_MAX_TOTAL_MB` ή σβήσε παλιά backups:\n```\ndu -sh /opt/discord-bot/data/*\n```'
  },
  'idle-radio-failing': {
    color: 0xe74c3c,
    icon: 'bot_radio',
    title: 'Το ραδιόφωνο δεν ξαναρχίζει',
    fix: 'Το ραδιόφωνο παίζει YouTube (lofi girl), που μπλοκάρει datacenter IPs. '
      + 'Ανανέωσε τα cookies (§9 του DEPLOY.md) — ή, αν επιμένει, βάλε Icecast '
      + 'στο `IDLE_MUSIC_URL`: δεν έχει έλεγχο bot και δεν πέφτει ποτέ.'
  },
  'kicked-from-guild': {
    color: 0xe74c3c,
    icon: 'bot_kick',
    title: 'Με πέταξαν έξω από server',
    fix: 'Αν ήταν κατά λάθος, χρειάζεται νέα πρόσκληση με τα ίδια δικαιώματα. '
      + 'Οι ρυθμίσεις και το ιστορικό του server μένουν στη βάση.'
  },
  'recovered': {
    color: 0x2ecc71,
    icon: 'bot_ok',
    title: 'Όλα ξανά στη θέση τους'
  },
  'daily-digest': {
    color: 0x3498db,
    icon: 'bot_stats',
    title: 'Σύνοψη ημέρας'
  },
  'startup-warning': {
    color: 0xf1c40f,
    icon: 'bot_warn',
    title: 'Προειδοποίηση εκκίνησης'
  }
};

const getOwnerIds = getBotOwnerIds;

async function notifyOwner(client, type, detail, options = {}) {
  const owners = getOwnerIds();
  if (owners.length === 0) return false;

  if (!options.force) {
    const last = lastSentByType.get(type) || 0;
    if (Date.now() - last < COOLDOWN_MS) return false;
  }
  lastSentByType.set(type, Date.now());

  const style = STYLES[type] || { color: 0x95a5a6, icon: 'bot_general', title: 'Ειδοποίηση' };

  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setTitle(`${plainEmoji(style.icon)} ${style.title}`)
    .setDescription(detail)
    .setTimestamp();

  if (options.fields?.length) embed.addFields(options.fields);
  if (style.fix) embed.addFields({ name: `${emoji('bot_admin')} Τι να κάνεις`, value: style.fix });

  embed.setFooter({ text: `${require('os').hostname()} • ${client.user?.tag || 'bot'}` });

  let delivered = false;
  for (const ownerId of owners) {
    try {
      const user = await client.users.fetch(ownerId);
      await user.send({ embeds: [embed] });
      delivered = true;
    } catch (error) {
      log.warn(`Δεν στάλθηκε DM στον ${ownerId}:`, error.message);
    }
  }
  return delivered;
}

function isYouTubeAuthError(error) {
  const text = String(error?.message || error || '');
  return /sign in to confirm|not a bot|login required|age.?restricted|consent/i.test(text);
}

const counters = { commands: 0, ytRefused: 0, soundcloudRescues: 0, radioRestarts: 0, errors: 0 };
function bump(key, by = 1) {
  if (key in counters) counters[key] += by;
}

const DIGEST_ROWS = [
  { key: 'commands', icon: 'bot_general', label: 'Εντολές', good: false },
  { key: 'errors', icon: 'bot_error', label: 'Σφάλματα', good: true },
  { key: 'radioRestarts', icon: 'bot_radio', label: 'Επανεκκινήσεις ραδιοφώνου', good: true },
  { key: 'ytRefused', icon: 'bot_warn', label: 'Αρνήσεις YouTube', good: true },
  { key: 'soundcloudRescues', icon: 'bot_loop', label: 'Διασώσεις SoundCloud', good: false }
];

function buildDigestFields() {
  return DIGEST_ROWS
    .filter((row) => counters[row.key] > 0)
    .map((row) => ({
      name: `${emoji(row.icon)} ${row.label}`,
      value: `**${counters[row.key]}**`,
      inline: true
    }));
}

function buildDigestBody() {
  const quiet = DIGEST_ROWS.filter((row) => row.good && counters[row.key] === 0);
  const lines = ['Τι έγινε το τελευταίο 24ωρο:'];
  if (quiet.length === DIGEST_ROWS.filter((r) => r.good).length) {
    lines.push(`${emoji('bot_ok')} Κανένα πρόβλημα — ούτε σφάλμα, ούτε πτώση ραδιοφώνου.`);
  } else if (quiet.length) {
    lines.push(`${emoji('bot_ok')} Στο μηδέν: ${quiet.map((r) => r.label.toLowerCase()).join(', ')}.`);
  }
  return lines.join('\n');
}

function startDailyDigest(client) {
  const timer = setInterval(async () => {
    const total = Object.values(counters).reduce((a, b) => a + b, 0);
    if (total === 0) return;

    await notifyOwner(
      client,
      'daily-digest',
      buildDigestBody(),
      { force: true, fields: buildDigestFields() }
    ).catch(() => {});

    for (const key of Object.keys(counters)) counters[key] = 0;
  }, 24 * 60 * 60 * 1000);

  timer.unref();
  return timer;
}

module.exports = { notifyOwner, isYouTubeAuthError, getOwnerIds, bump, counters, startDailyDigest };
