#!/usr/bin/env node
/**
 * Διάγνωση του AI: τι δέχεται ΟΝΤΩΣ το κλειδί σου.
 *
 *   npm run diag:ai
 *
 * Γράφτηκε επειδή ένα 404 από το Gemini δεν σημαίνει «λάθος κλειδί» — σημαίνει
 * «αυτό το μοντέλο δεν υπάρχει για αυτό το κλειδί». Τα ονόματα των μοντέλων
 * αλλάζουν, οι προεπισκοπήσεις αποσύρονται, και δεν έχουν όλα τα κλειδιά τα
 * ίδια. Η μαντεψιά του σωστού ονόματος είναι χάσιμο χρόνου όταν το API μπορεί
 * να σου το πει.
 *
 * ΔΕΝ τυπώνει ποτέ το κλειδί.
 */
const { loadEnv } = require('./load-env');

const { sources, unreadable } = loadEnv();

const { activeProviderName, getApiKey, PROVIDERS } = require('../src/ai/provider');

const mask = (key) => `${key.slice(0, 6)}…${key.slice(-4)} (${key.length} χαρακτήρες)`;

const isStable = (id) => !/preview|exp|-\d{2}-\d{2}$/i.test(id);

/**
 * Ποιο μοντέλο να προτείνουμε.
 *
 * Τα ψευδώνυμα `-latest` προηγούνται όλων, και ο λόγος είναι ακριβώς αυτό που
 * μόλις έσπασε: το `gemini-2.5-flash-lite` αποσύρθηκε για νέα κλειδιά και το
 * bot έπεσε στον εφεδρικό router χωρίς να το καταλάβει κανείς. Ένα καρφωμένο
 * όνομα ξαναφέρνει το ίδιο πρόβλημα σε λίγους μήνες· το ψευδώνυμο ακολουθεί
 * μόνο του. Η τιμή του σταθερού ονόματος — ίδια συμπεριφορά για πάντα — δεν
 * αξίζει εδώ: είναι bot μουσικής, όχι σύστημα που χρειάζεται αναπαραγωγιμότητα.
 *
 * Τα `flash-lite` πρώτα γιατί το δωρεάν tier μετράει ΑΙΤΗΜΑΤΑ, όχι tokens —
 * ένα ακριβότερο μοντέλο δεν σου δίνει τίποτα παραπάνω σε ποσόστωση.
 */
function suggestModel(ids, exclude) {
  // Τα gemma-* είναι ανοιχτά μοντέλα με άλλη συμπεριφορά στο API, και τα
  // -image / -tts / embedding δεν κάνουν καθόλου για κουβέντα.
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
    // Η συνηθέστερη αιτία δεν είναι «δεν έβαλα κλειδί», είναι «το script δεν
    // βλέπει το αρχείο». Το ξεχωρίζουμε, αλλιώς ψάχνεις λάθος πρόβλημα.
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

  // --- 1. Ποια μοντέλα βλέπει αυτό το κλειδί -------------------------------
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
      // Το 403 είναι άλλο πρόβλημα από το 404 και θέλει άλλη λύση.
      if (response.status === 403) {
        console.log('\n  403 = το κλειδί υπάρχει αλλά το Generative Language API δεν είναι');
        console.log('  ενεργοποιημένο σε αυτό το project, ή το κλειδί έχει περιορισμούς.');
      }
      if (response.status === 400) {
        console.log('\n  400 = το κλειδί δεν έγινε δεκτό. Φτιάξε νέο στο');
        console.log('  https://aistudio.google.com/apikey');
      }
      // Όχι process.exit(): με ανοιχτό socket, το Node στα Windows πεθαίνει με
      // assertion του libuv αντί να τερματίσει καθαρά.
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

  // Τα σταθερά (χωρίς preview/exp) πρώτα: ένα preview μπορεί να εξαφανιστεί
  // χωρίς προειδοποίηση και να ξαναφέρει το ίδιο 404 σε δύο μήνες.
  const ids = models.map((m) => m.name.replace(/^models\//, ''));
  const stable = ids.filter(isStable);
  const preview = ids.filter((id) => !isStable(id));

  console.log(`\n  Σταθερά (${stable.length}):`);
  for (const id of stable) console.log(`    ${id}`);
  if (preview.length) console.log(`\n  Preview/πειραματικά (${preview.length}): ${preview.slice(0, 8).join(', ')}${preview.length > 8 ? ' …' : ''}`);

  // --- 2. Δουλεύει το ρυθμισμένο; ------------------------------------------
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

  // Η λίστα ΔΕΝ είναι εγγύηση, και αυτό δεν είναι θεωρητικό: το
  // gemini-2.5-flash-lite εμφανίζεται κανονικά στο ListModels και μετά
  // απαντάει 404 «no longer available to new users». Γι' αυτό γίνεται
  // πραγματική κλήση — και μάλιστα μέσα από το ίδιο callProvider που
  // χρησιμοποιεί το bot, με το σχήμα δομημένης εξόδου, γιατί ούτε αυτό το
  // υποστηρίζουν όλα τα μοντέλα.
  const { callProvider } = require('../src/ai/provider');
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
