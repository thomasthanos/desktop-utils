#!/usr/bin/env node
const { loadEnv } = require('./load-env');

const { sources, unreadable } = loadEnv();

const { activeProviderName, getApiKey, PROVIDERS } = require('../ai/provider');

const mask = (key) => `${key.slice(0, 6)}…${key.slice(-4)} (${key.length} χαρακτήρες)`;

const isStable = (id) => !/preview|exp|-\d{2}-\d{2}$/i.test(id);

function suggestModel(ids, exclude) {
  const usable = ids.filter((id) => (
    id.startsWith('gemini-')
    && id !== exclude
    && !/-image|-tts|embedding|thinking/i.test(id)
  ));

  const stableOnly = usable.filter(isStable);
  const pool = stableOnly.length ? stableOnly : usable;

  for (const want of ['flash-lite-latest', 'flash-latest', 'flash-lite', 'flash', 'pro']) {
    const hit = pool.find((id) => id.includes(want));
    if (hit) return hit;
  }
  return pool[0] || null;
}

async function main() {
  const name = activeProviderName();
  const key = getApiKey();

  console.log(`\nΠάροχος:  ${name}`);
  console.log(`Μοντέλο:  ${PROVIDERS[name]?.model() ?? '—'}`);
  console.log(`Κλειδί:   ${key ? mask(key) : 'ΔΕΝ ΕΧΕΙ ΟΡΙΣΤΕΙ'}`);
  console.log(`Ρυθμίσεις: ${sources.length ? sources.join(', ') : 'μόνο από το περιβάλλον'}`);

  if (!key) {
    if (unreadable) {
      console.log(`\n✗ Το ${unreadable} υπάρχει αλλά ΔΕΝ διαβάζεται από αυτόν τον χρήστη.`);
      console.log('  Είναι chmod 600 root:root επίτηδες. Ξανατρέξ\' το ως root:\n');
      console.log('      sudo node scripts/diag-ai.js\n');
      process.exitCode = 1;
      return;
    }

    console.log('\nΧωρίς κλειδί δεν υπάρχει τίποτα να ελεγχθεί. Το bot δουλεύει');
    console.log('κανονικά — απλώς η /ask δεν φορτώνεται.\n');
    process.exitCode = 1;
    return;
  }

  if (name !== 'gemini') {
    console.log('\nΗ λίστα μοντέλων υλοποιείται μόνο για το Gemini.');
    console.log('Για άλλους παρόχους δες την τεκμηρίωσή τους.\n');
    process.exitCode = 0;
    return;
  }

  console.log('\n── Μοντέλα διαθέσιμα σε αυτό το κλειδί ──');

  let models = [];
  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
      { headers: { 'x-goog-api-key': key } }
    );

    if (!response.ok) {
      const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 400);
      console.log(`\n✗ ListModels απέτυχε: ${response.status}`);
      console.log(`  ${body}`);

      if (response.status === 403) {
        console.log('\n  403 = το κλειδί υπάρχει αλλά το Generative Language API δεν είναι');
        console.log('  ενεργοποιημένο σε αυτό το project, ή το κλειδί έχει περιορισμούς.');
      }
      if (response.status === 400) {
        console.log('\n  400 = το κλειδί δεν έγινε δεκτό. Φτιάξε νέο στο');
        console.log('  https://aistudio.google.com/apikey');
      }

      process.exitCode = 1;
      return;
    }

    const data = await response.json();
    models = (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'));
  } catch (error) {
    console.log(`\n✗ Δεν έγινε καν η κλήση: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (models.length === 0) {
    console.log('\n✗ Κανένα μοντέλο δεν υποστηρίζει generateContent με αυτό το κλειδί.');
    process.exitCode = 1;
    return;
  }

  const ids = models.map((m) => m.name.replace(/^models\//, ''));
  const stable = ids.filter(isStable);
  const preview = ids.filter((id) => !isStable(id));

  console.log(`\n  Σταθερά (${stable.length}):`);
  for (const id of stable) console.log(`    ${id}`);
  if (preview.length) console.log(`\n  Preview/πειραματικά (${preview.length}): ${preview.slice(0, 8).join(', ')}${preview.length > 8 ? ' …' : ''}`);

  const configured = PROVIDERS.gemini.model();
  console.log(`\n── Το ρυθμισμένο μοντέλο: ${configured} ──`);

  const advise = (reason) => {
    console.log(`\n✗ ${reason}`);
    const suggestion = suggestModel(ids, configured);
    if (!suggestion) {
      console.log('  Δεν βρέθηκε κατάλληλη εναλλακτική στη λίστα.');
      return;
    }
    console.log('\n  Βάλε στο /etc/discord-bot.env:\n');
    console.log(`      AI_MODEL=${suggestion}\n`);
    console.log('  και μετά: sudo systemctl restart discord-bot');
  };

  if (!ids.includes(configured)) {
    advise('ΔΕΝ βρίσκεται στη λίστα. Αυτή είναι η αιτία του 404.');
    process.exitCode = 1;
    return;
  }

  console.log('  ✓ Υπάρχει στη λίστα. Δοκιμή πραγματικής κλήσης…');

  const { callProvider } = require('../ai/provider');
  const result = await callProvider([{ role: 'user', content: 'Πες μου γεια σε 5 λέξεις.' }]);

  if (!result) {
    advise('Είναι στη λίστα αλλά η κλήση απέτυχε — δες τον λόγο παραπάνω.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ✓ Απάντησε: "${result.reply}"`);
  console.log(`  ✓ action: ${result.action}`);
  console.log('\nΤο AI δουλεύει.\n');
}

main().catch((error) => {
  console.error('\nΔιαγνωστικό απέτυχε:', error.message);
  process.exitCode = 1;
});
