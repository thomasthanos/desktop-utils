#!/usr/bin/env node
require('./load-env').loadEnv();

const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const ROOT = path.join(__dirname, '..', '..');
const { FALLBACK, ID_OVERRIDES } = require(path.join(ROOT, 'src/utils/emojis'));

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('Λείπει το DISCORD_BOT_TOKEN. Στον server χρειάζεται root: sudo node src/tools/diag-emoji.js');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', async () => {
  console.log(`\nΣυνδέθηκα ως ${client.user.tag}\n`);

  console.log('─── Servers όπου είναι μέλος ───');
  for (const guild of client.guilds.cache.values()) {
    console.log(`  ${guild.name.padEnd(28)} ${guild.id}  (${guild.emojis.cache.size} emoji ορατά)`);
  }

  console.log('\n─── Application emoji (Developer Portal) ───');
  let uploaded = new Map();
  try {
    const fetched = await client.application.emojis.fetch();
    uploaded = new Map([...fetched.values()].map((e) => [e.name, e]));
    if (uploaded.size === 0) console.log('  (κανένα)');
    for (const [name, item] of uploaded) {
      const known = name in FALLBACK ? '' : '  ← ο κώδικας ΔΕΝ ζητά αυτό το όνομα';
      console.log(`  ${name.padEnd(16)} ${item.animated ? 'animated' : 'static  '}  ${item.id}${known}`);
    }
  } catch (error) {
    console.log('  σφάλμα:', error.message);
  }

  console.log('\n─── Τι θα δει ο χρήστης, ανά όνομα ───');
  for (const name of Object.keys(FALLBACK)) {
    const overrideId = ID_OVERRIDES[name];

    const byId = overrideId
      ? ([...uploaded.values()].find((e) => e.id === overrideId) || client.emojis.cache.get(overrideId))
      : null;

    if (byId) console.log(`  ${name.padEnd(16)} ID      ${byId.toString()}  ${byId.animated ? '(animated)' : ''}`);
    else if (overrideId) console.log(`  ${name.padEnd(16)} ΑΟΡΑΤΟ  το ${overrideId} δεν βρέθηκε πουθενά -> εφεδρεία`);
    else if (uploaded.has(name)) console.log(`  ${name.padEnd(16)} όνομα   ${uploaded.get(name).toString()}`);
    else console.log(`  ${name.padEnd(16)} unicode ${FALLBACK[name]}   ← λείπει· ανέβασέ το ως "${name}"`);
  }

  console.log('');
  client.destroy();
  process.exitCode = 0;
});

client.login(token).catch((error) => {
  console.error('Αποτυχία σύνδεσης:', error.message);
  process.exitCode = 1;
});
