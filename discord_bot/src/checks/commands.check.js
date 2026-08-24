#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { start, ROOT } = require('./harness');

const { pass, fail, section, check, finish } = start();

const COMMANDS_DIR = path.join(ROOT, 'src/commands');
const files = fs.readdirSync(COMMANDS_DIR).filter((name) => name.endsWith('.js')).sort();

const OPTION_READERS = [
  /ctx\.option\(\s*'([^']+)'/g,
  /interaction\.options\.get\(\s*'([^']+)'/g,
  /interaction\.options\.getString\(\s*'([^']+)'/g,
  /interaction\.options\.getInteger\(\s*'([^']+)'/g,
  /interaction\.options\.getBoolean\(\s*'([^']+)'/g,
  /interaction\.options\.getNumber\(\s*'([^']+)'/g,
  /interaction\.options\.getUser\(\s*'([^']+)'/g,
  /interaction\.options\.getChannel\(\s*'([^']+)'/g
];

// Οι υποεντολές κρύβουν τα δικά τους options ένα επίπεδο πιο μέσα, οπότε
// χωρίς αναδρομή ο έλεγχος θα φώναζε για options που ΕΙΝΑΙ δηλωμένα.
function collectOptionNames(options, into) {
  for (const option of options || []) {
    into.add(option.name);
    if (option.options) collectOptionNames(option.options, into);
  }
  return into;
}

function declaredOptionNames(command) {
  const json = typeof command.data?.toJSON === 'function' ? command.data.toJSON() : command.data;
  return collectOptionNames(json?.options, new Set());
}

function readOptionNames(source) {
  const names = new Set();
  for (const pattern of OPTION_READERS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      names.add(match[1]);
      match = pattern.exec(source);
    }
  }
  return names;
}

section('Every option a command reads is an option it declares');
{
  let mismatches = 0;
  let checked = 0;

  for (const file of files) {
    const fullPath = path.join(COMMANDS_DIR, file);

    let command;
    try {
      command = require(fullPath);
    } catch (error) {
      fail(`${file} could not be loaded — ${error.message}`);
      mismatches++;
      continue;
    }

    if (!command?.data) continue;

    const declared = declaredOptionNames(command);
    const read = readOptionNames(fs.readFileSync(fullPath, 'utf8'));

    const unknown = [...read].filter((name) => !declared.has(name));
    checked++;

    if (unknown.length === 0) continue;

    mismatches++;
    fail(
      `${file} reads option(s) it never declares: ${unknown.join(', ')} `
      + `(declared: ${[...declared].join(', ') || 'none'})`
    );
  }

  if (mismatches === 0) pass(`${checked} commands agree with their own option names`);
}

section('Custom emoji only where Discord actually renders them');
{
  const { plainEmoji, FALLBACK } = require(path.join(ROOT, 'src/utils/emojis.js'));

  check(
    plainEmoji('bot_play') === FALLBACK.bot_play,
    'plainEmoji gives the unicode form, which renders in titles'
  );

  const roots = ['src/commands', 'src/utils', 'src/events'];
  const offenders = [];

  for (const dir of roots) {
    const full = path.join(ROOT, dir);
    for (const name of fs.readdirSync(full)) {
      if (!name.endsWith('.js')) continue;

      const body = fs.readFileSync(path.join(full, name), 'utf8').split(String.fromCharCode(10));
      body.forEach((line, index) => {
        const deadPosition = line.includes('setTitle(') || line.includes('setAuthor(') || line.includes('setFooter(');
        if (deadPosition && line.includes('${emoji(')) offenders.push(`${dir}/${name}:${index + 1}`);
      });
    }
  }

  check(
    offenders.length === 0,
    'no embed title, author or footer carries a custom emoji',
    `these would show raw <:name:id> text to users: ${offenders.join(', ')}`
  );
}

section('Stopping a wipe actually stops it');
{
  const body = fs.readFileSync(path.join(ROOT, 'src/commands/wipe-channel.js'), 'utf8');
  const lines = body.split(String.fromCharCode(10));

  const inner = lines.findIndex((l) => l.includes('for (const message of targets)'));
  const window = lines.slice(inner, inner + 4).join(String.fromCharCode(10));
  check(
    window.includes('state.stopped'),
    'Stop is checked before every message, not once per 100-message batch'
  );

  check(
    body.includes('protectedIds'),
    'the wipe never deletes the message carrying its own Stop button'
  );
}

section('Commands that change playback ask for voice first');
{
  const mutating = [
    'play', 'pause', 'resume', 'skip', 'stop', 'volume',
    'loop', 'shuffle', 'remove', '247', 'idlemusic'
  ];

  const ungated = mutating.filter((name) => {
    const body = fs.readFileSync(path.join(COMMANDS_DIR, `${name}.js`), 'utf8');
    return !['musicGate', '.voice?.channel', 'member?.voice'].some((needle) => body.includes(needle));
  });

  check(
    ungated.length === 0,
    'every command that changes playback checks voice first',
    `these change playback without a voice check: ${ungated.join(', ')}`
  );
}

section('Read-only commands stay open');
{
  const readOnly = ['queue', 'nowplaying'];
  const gated = readOnly.filter((name) => {
    const body = fs.readFileSync(path.join(COMMANDS_DIR, `${name}.js`), 'utf8');
    return body.includes('musicGate');
  });

  check(
    gated.length === 0,
    'looking at the queue never requires being in voice',
    `these read-only commands were gated by mistake: ${gated.join(', ')}`
  );
}

finish(`${files.length} εντολές, τα ονόματα των options συμφωνούν με τις δηλώσεις τους`);
