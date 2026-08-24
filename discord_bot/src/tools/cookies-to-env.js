#!/usr/bin/env node
const fs = require('fs');

const COOKIES = process.env.YT_COOKIES_FILE || '/etc/discord-bot-cookies.txt';
const ENV_FILE = process.env.ENV_FILE || '/etc/discord-bot.env';

if (!fs.existsSync(COOKIES)) {
  console.error(`Δεν βρέθηκε ${COOKIES}. Ανέβασέ το πρώτα από το PC σου.`);
  process.exit(1);
}

const header = fs.readFileSync(COOKIES, 'utf8')
  .split('\n')
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split('\t'))
  .filter((parts) => parts.length >= 7 && parts[0].includes('youtube'))
  .map((parts) => `${parts[5]}=${parts[6]}`)
  .join('; ');

const pairs = header ? header.split(';').length : 0;
if (pairs < 5) {
  console.error(`Μόνο ${pairs} cookies YouTube — η εξαγωγή δεν φαίνεται σωστή. Το env ΔΕΝ πειράχτηκε.`);
  process.exit(1);
}

const kept = fs.readFileSync(ENV_FILE, 'utf8')
  .split('\n')
  .filter((line) => !/^(YT_COOKIE|YT_COOKIES_FILE)=/.test(line))
  .join('\n')
  .replace(/\n+$/, '');

fs.writeFileSync(
  ENV_FILE,
  `${kept}\nYT_COOKIE="${header}"\nYT_COOKIES_FILE=${COOKIES}\n`,
  { mode: 0o600 }
);

console.log(`Ανανεώθηκε: ${pairs} cookies, ${header.length} χαρακτήρες.`);
