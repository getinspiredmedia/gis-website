'use strict';
/*
 * Regression test for check-analytics-drift.js. Covers both directions:
 *  1. Negative — the current, unmodified state reports zero errors (no
 *     false positives), so the check doesn't cry wolf on files nobody touched.
 *  2. Positive — a deliberate, temporary edit to one of the 5 hand-maintained
 *     copies (not the partial) is detected and named specifically; and a
 *     deliberate edit to the partial itself is detected across all copies.
 * Every mutation is restored in a finally block, including on assertion
 * failure or a thrown error, so a failing run never leaves the repo dirty.
 */
const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const PARTIAL = path.join(ROOT, 'build', 'partials', 'analytics.html');
const COPY    = path.join(ROOT, 'public', 'work', 'index.html');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function freshCheck() {
  delete require.cache[require.resolve('./check-analytics-drift')];
  return require('./check-analytics-drift').checkAnalyticsDrift;
}

function run() {
  // 1. Negative: current state has no drift.
  {
    const checkAnalyticsDrift = freshCheck();
    const errors = checkAnalyticsDrift();
    assert(errors.length === 0, 'current, unmodified state reports zero drift errors — got: ' + JSON.stringify(errors));
    console.log('[check-analytics-drift.test] PASS — no false positives on the current, consistent state');
  }

  // 2. Positive: mutating one copy (not the partial) is caught and named.
  {
    const original = fs.readFileSync(COPY, 'utf8');
    assert(original.includes('plausible.init()'), 'fixture assumption: public/work/index.html has the Plausible init script');

    const mutated = original.replace(
      '<script async src="/js/pa-MH-OTeJcc74k86JrwLa7k.js"></script>',
      '<script async src="/js/pa-DIFFERENT-HASH.js"></script>'
    );
    assert(mutated !== original, 'mutation actually changed the file content');

    fs.writeFileSync(COPY, mutated, 'utf8');
    try {
      const checkAnalyticsDrift = freshCheck();
      const errors = checkAnalyticsDrift();
      assert(errors.length > 0, 'checkAnalyticsDrift() reports at least one error after changing one copy\'s script src');
      const scriptError = errors.find(e => e.includes('public/work/index.html') && e.includes('script tag'));
      assert(
        scriptError && scriptError.includes('pa-MH-OTeJcc74k86JrwLa7k.js') && scriptError.includes('pa-DIFFERENT-HASH.js'),
        'the reported error names public/work/index.html specifically and shows both script src values — got: ' + JSON.stringify(errors)
      );
      // Only the mutated copy should be implicated, not the other 4.
      const wronglyBlamed = errors.some(e => e.includes('on-view') || e.includes('chasing-light') || e.includes('no-algorithm') || e.includes('origins'));
      assert(!wronglyBlamed, 'only the mutated copy is reported, the other 4 untouched copies are not — got: ' + JSON.stringify(errors));

      console.log('[check-analytics-drift.test] PASS — a single-copy edit is detected and correctly attributed:');
      console.log('  ' + scriptError);
    } finally {
      fs.writeFileSync(COPY, original, 'utf8');
      freshCheck();
    }
  }

  // 3. Positive: mutating the partial itself is caught for every copy.
  {
    const original = fs.readFileSync(PARTIAL, 'utf8');
    assert(original.includes('plausible.init()'), 'fixture assumption: the partial has the Plausible init script');

    const mutated = original.replace('plausible.init()', 'plausible.init({tagged: true})');
    assert(mutated !== original, 'mutation actually changed the file content');

    fs.writeFileSync(PARTIAL, mutated, 'utf8');
    try {
      const checkAnalyticsDrift = freshCheck();
      const errors = checkAnalyticsDrift();
      const expectedCopies = [
        'public/on-view/index.html',
        'public/work/index.html',
        'public/magazine/chasing-light/index.html',
        'public/magazine/no-algorithm/index.html',
        'public/magazine/origins/index.html',
      ];
      for (const copyPath of expectedCopies) {
        const found = errors.some(e => e.includes(copyPath) && e.includes('init script'));
        assert(found, `drift against ${copyPath} is reported after changing the partial's init script — got: ` + JSON.stringify(errors));
      }
      console.log(`[check-analytics-drift.test] PASS — a partial-side edit is detected against all ${expectedCopies.length} copies`);
    } finally {
      fs.writeFileSync(PARTIAL, original, 'utf8');
      freshCheck();
    }
  }

  // Final sanity: everything restored, back to zero errors.
  {
    const checkAnalyticsDrift = freshCheck();
    const errors = checkAnalyticsDrift();
    assert(errors.length === 0, 'after restoring all mutations, drift check is clean again — got: ' + JSON.stringify(errors));
    console.log('[check-analytics-drift.test] PASS — all fixture files restored, check is clean again');
  }
}

if (require.main === module) {
  try {
    run();
    process.exit(0);
  } catch (e) {
    console.error('[check-analytics-drift.test] FAIL —', e.message);
    process.exit(1);
  }
}

module.exports = { run };
