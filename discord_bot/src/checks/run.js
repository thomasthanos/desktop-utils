#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUFFIX = '.check.js';

const ORDER = ['smoke', 'music', 'voice', 'dm', 'ai', 'quip', 'youtube-auth', 'dates', 'security'];

const discovered = fs.readdirSync(__dirname)
  .filter((file) => file.endsWith(SUFFIX))
  .map((file) => file.slice(0, -SUFFIX.length));

const SUITES = [
  ...ORDER.filter((name) => discovered.includes(name)),
  ...discovered.filter((name) => !ORDER.includes(name)).sort()
];

if (SUITES.length === 0) {
  console.error(`Δεν βρέθηκε κανένα *${SUFFIX} στο ${__dirname}`);
  process.exit(2);
}

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !SUITES.includes(name));
if (unknown.length) {
  console.error(`Άγνωστοι έλεγχοι: ${unknown.join(', ')}\nΔιαθέσιμοι: ${SUITES.join(', ')}`);
  process.exit(2);
}

const suites = requested.length ? requested : SUITES;
const failed = [];

for (const name of suites) {
  console.log(`\n${'─'.repeat(60)}\n  ${name}\n${'─'.repeat(60)}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, `${name}${SUFFIX}`)], { stdio: 'inherit' });

  if (result.status !== 0) failed.push(`${name}${result.status === null ? ' (crashed)' : ''}`);
}

console.log(`\n${'═'.repeat(60)}`);
if (failed.length) {
  console.log(`FAILED — ${failed.length}/${suites.length}: ${failed.join(', ')}\n`);
  process.exit(1);
}
console.log(`OK — πέρασαν και οι ${suites.length} έλεγχοι\n`);
