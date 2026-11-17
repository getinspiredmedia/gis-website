'use strict';
/*
 * Regression test for check-footer-drift.js: proves it catches a drifted
 * .footer-logos block (not just the <style> block). Mutates the alt text in
 * the real partial file temporarily, asserts checkFooterDrift() reports it,
 * then restores the original file no matter what — including on assertion
 * failure or a thrown error.
 */
const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const PARTIAL = path.join(ROOT, 'build', 'partials', 'footer.html');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function run() {
  const original = fs.readFileSync(PARTIAL, 'utf8');
  assert(original.includes('alt="Get Inspired Magazine"'), 'fixture assumption: partial has alt="Get Inspired Magazine" on the magazine logo');

  const mutated = original.replace('alt="Get Inspired Magazine"', 'alt="Get Inspired Mag"');
  assert(mutated !== original, 'mutation actually changed the file content');

  fs.writeFileSync(PARTIAL, mutated, 'utf8');
  try {
    delete require.cache[require.resolve('./check-footer-drift')];
    const { checkFooterDrift } = require('./check-footer-drift');
    const errors = checkFooterDrift();

    assert(errors.length > 0, 'checkFooterDrift() reports at least one error after a .footer-logos-only change');
    const logosError = errors.find(e => e.includes('.footer-logos'));
    assert(logosError, 'one of the reported errors names the .footer-logos drift — got: ' + JSON.stringify(errors));

    console.log('[check-footer-drift.test] PASS — .footer-logos mismatch correctly detected:');
    console.log('  ' + logosError);
  } finally {
    fs.writeFileSync(PARTIAL, original, 'utf8');
    delete require.cache[require.resolve('./check-footer-drift')];
  }
}

if (require.main === module) {
  try {
    run();
    process.exit(0);
  } catch (e) {
    console.error('[check-footer-drift.test] FAIL —', e.message);
    process.exit(1);
  }
}

module.exports = { run };
