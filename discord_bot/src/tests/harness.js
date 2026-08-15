/**
 * Ο κοινός σκελετός των ελέγχων του `src/tests/`.
 *
 * Υπάρχει επειδή κάθε αρχείο ελέγχων ξανάγραφε τις ίδιες τέσσερις γραμμές —
 * μετρητή αποτυχιών, `pass`, `fail`, και μια σύνοψη στο τέλος. Τέσσερις
 * αντιγραφές σημαίνουν τέσσερις ευκαιρίες να ξεχαστεί το `failures++`, κι ένας
 * έλεγχος που τυπώνει «✗» αλλά βγαίνει με κωδικό 0 είναι χειρότερος από
 * καθόλου έλεγχος: το CI τον περνάει.
 *
 * Δεν είναι test framework και δεν θέλει να γίνει. Μόνο μέτρημα και έξοδος.
 */
const path = require('path');

/** Η ρίζα του project — τα αρχεία εδώ ζουν δύο επίπεδα βαθύτερα. */
const ROOT = path.join(__dirname, '..', '..');

/**
 * Ξεκινάει μια αναφορά ελέγχων.
 *
 * Οι μέθοδοι δένονται στο αντικείμενο, οπότε το `const { pass, fail } = start()`
 * δουλεύει κανονικά και ο μετρητής παραμένει κοινός.
 */
function start() {
  const report = {
    failures: 0,
    warnings: 0,

    /** Τίτλος ομάδας ελέγχων. */
    section: (title) => { console.log(`\n${title}`); },

    pass: (message) => { console.log(`  ✓ ${message}`); },

    fail: (message) => { report.failures++; console.log(`  ✗ ${message}`); },

    /** Αξίζει προσοχή αλλά δεν ρίχνει το build — π.χ. λείπει προαιρετικό native module. */
    warn: (message) => { report.warnings++; console.log(`  ! ${message}`); },

    /** `check(συνθήκη, «τι πέρασε», «τι έσπασε»)` — για το συνηθισμένο τριαδικό. */
    check: (ok, okMessage, failMessage) => {
      ok ? report.pass(okMessage) : report.fail(failMessage ?? okMessage);
    },

    /**
     * Τυπώνει τη σύνοψη και τερματίζει με τον σωστό κωδικό εξόδου.
     * Ο κωδικός είναι το μόνο που διαβάζει ο runner — μη τον παρακάμψεις.
     */
    finish: (label) => {
      console.log('');
      if (report.failures > 0) {
        console.log(`FAILED — ${report.failures} check(s), ${report.warnings} warning(s)\n`);
        process.exit(1);
      }
      console.log(`OK — ${label}${report.warnings ? `, ${report.warnings} warning(s)` : ''}\n`);
      process.exit(0);
    }
  };

  return report;
}

module.exports = { start, ROOT };
