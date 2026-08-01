'use strict';
/*
 * Regression test for check-nav-drift.js: proves it catches an ARIA-only
 * mismatch (not just a structural one). Mutates aria-label in the real
 * partial file temporarily, asserts checkNavDrift() reports it by name,
 * then restores the original file no matter what — including on assertion
 * failure or a thrown error.
 */
const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const PARTIAL    = path.join(ROOT, 'build', 'partials', 'nav.html');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function run() {
  const original = fs.readFileSync(PARTIAL, 'utf8');
  assert(original.includes('aria-label="Open menu"'), 'fixture assumption: partial has aria-label="Open menu" on the toggle button');

  const mutated = original.replace('aria-label="Open menu"', 'aria-label="Toggle navigation"');
  assert(mutated !== original, 'mutation actually changed the file content');

  fs.writeFileSync(PARTIAL, mutated, 'utf8');
  try {
    delete require.cache[require.resolve('./check-nav-drift')];
    const { checkNavDrift } = require('./check-nav-drift');
    const errors = checkNavDrift();

    assert(errors.length > 0, 'checkNavDrift() reports at least one error after an aria-label-only change');
    const ariaError = errors.find(e => e.includes('aria-label'));
    assert(
      ariaError && ariaError.includes('Open menu') && ariaError.includes('Toggle navigation'),
      'one of the reported errors names the aria-label mismatch with both values — got: ' + JSON.stringify(errors)
    );

    console.log('[check-nav-drift.test] PASS — aria-label mismatch correctly detected:');
    console.log('  ' + ariaError);
  } finally {
    fs.writeFileSync(PARTIAL, original, 'utf8');
    delete require.cache[require.resolve('./check-nav-drift')];
  }
}

if (require.main === module) {
  try {
    run();
    process.exit(0);
  } catch (e) {
    console.error('[check-nav-drift.test] FAIL —', e.message);
    process.exit(1);
  }
}

module.exports = { run };
