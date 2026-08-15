#!/usr/bin/env node
/**
 * Τρέχει όλους τους ελέγχους και τυπώνει μία σύνοψη.
 *
 *   npm test
 *
 * Κάθε έλεγχος τρέχει σε ΔΙΚΗ του διεργασία, επίτηδες. Πολλοί από αυτούς
 * πειράζουν το `process.env` (DATA_DIR, VOICE_EMPTY_GRACE_MS), σηκώνουν
 * dashboard σε πόρτα ή ανοίγουν τη βάση — μέσα σε μία διεργασία θα μόλυναν ο
 * ένας τον άλλο και η σειρά εκτέλεσης θα άλλαζε το αποτέλεσμα.
 *
 * ΔΕΝ σταματάει στην πρώτη αποτυχία: θέλεις να ξέρεις όλα όσα έσπασαν, όχι
 * μόνο το πρώτο. Ο κωδικός εξόδου είναι 1 αν έσπασε έστω ένας.
 *
 * Με όρισμα τρέχει μόνο τα ζητούμενα:  node src/tests/run.js music voice
 */
const path = require('path');
const { spawnSync } = require('child_process');

// Η σειρά έχει νόημα: πρώτα το smoke (αν δεν φορτώνουν τα modules, τα
// υπόλοιπα απλώς θα επαναλάβουν το ίδιο σφάλμα), τελευταίο το security που
// σηκώνει πραγματικό server.
const SUITES = ['smoke', 'music', 'voice', 'dm', 'ai', 'dates', 'security'];

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
  const result = spawnSync(process.execPath, [path.join(__dirname, `${name}.js`)], { stdio: 'inherit' });
  // Ένα σπασμένο αρχείο δεν βγάζει καν κωδικό εξόδου — το `status` είναι null.
  if (result.status !== 0) failed.push(`${name}${result.status === null ? ' (crashed)' : ''}`);
}

console.log(`\n${'═'.repeat(60)}`);
if (failed.length) {
  console.log(`FAILED — ${failed.length}/${suites.length}: ${failed.join(', ')}\n`);
  process.exit(1);
}
console.log(`OK — πέρασαν και οι ${suites.length} έλεγχοι\n`);
