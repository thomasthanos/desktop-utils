const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function start() {
  const report = {
    failures: 0,
    warnings: 0,

    section: (title) => { console.log(`\n${title}`); },

    pass: (message) => { console.log(`  ✓ ${message}`); },

    fail: (message) => { report.failures++; console.log(`  ✗ ${message}`); },

    warn: (message) => { report.warnings++; console.log(`  ! ${message}`); },

    check: (ok, okMessage, failMessage) => {
      ok ? report.pass(okMessage) : report.fail(failMessage ?? okMessage);
    },

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
