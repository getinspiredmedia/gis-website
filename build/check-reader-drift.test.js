'use strict';
/*
 * Regression test for check-reader-drift.js, run against a throwaway copy of
 * the readers in the OS temp dir (the real files are never touched): the
 * current state is clean; edits inside the markers are fine; edits outside
 * them, missing or unbalanced markers, and a new, unmarked reader are caught.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkReaderDrift } = require('./check-reader-drift');
const { listReaderPages } = require('./readers');

const REAL_ROOT = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function run() {
  const real = checkReaderDrift();
  assert(real.length === 0, 'the real readers are consistent, got: ' + JSON.stringify(real));
  console.log(`[check-reader-drift.test] PASS - the ${listReaderPages().length} real readers are clean`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-drift-'));
  try {
    for (const rel of listReaderPages(REAL_ROOT)) {
      fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
      fs.copyFileSync(path.join(REAL_ROOT, rel), path.join(tmp, rel));
    }
    const readers = listReaderPages(tmp);
    const name = readers[readers.length - 1];
    const target = path.join(tmp, name);
    const original = fs.readFileSync(target, 'utf8');
    const reset = () => fs.writeFileSync(target, original);
    assert(checkReaderDrift(tmp).length === 0, 'the temp copy starts clean');

    fs.writeFileSync(target, original.replace(/(<!-- issue:start -->\r?\n)/, '$1<title>Anything at all</title>\n'));
    assert(checkReaderDrift(tmp).length === 0, 'content inside issue markers may differ');
    reset();

    fs.writeFileSync(target, original.replace('.stage{flex:1;', '.stage{flex:2;'));
    let errors = checkReaderDrift(tmp);
    assert(errors.length === 1 && errors[0].includes(name) && errors[0].includes('outside the issue markers'),
      'a CSS change outside the markers is reported against that reader, got: ' + JSON.stringify(errors));
    reset();

    fs.writeFileSync(target, original.replace(/<!-- issue:(start|end) -->\r?\n/g, ''));
    errors = checkReaderDrift(tmp);
    assert(errors.some(e => e.includes(name)), 'a reader missing its HTML markers is reported, got: ' + JSON.stringify(errors));
    reset();

    fs.writeFileSync(target, original.replace(/\/\/ issue:end\r?\n/, ''));
    errors = checkReaderDrift(tmp);
    assert(errors.some(e => e.includes(name)), 'an unbalanced marker is reported, got: ' + JSON.stringify(errors));
    reset();

    const extra = path.join(tmp, 'public', 'magazine', 'zz-new-issue');
    fs.mkdirSync(extra);
    fs.writeFileSync(path.join(extra, 'index.html'), '<!DOCTYPE html><html><body>copy-paste gone wrong</body></html>');
    assert(listReaderPages(tmp).includes('public/magazine/zz-new-issue/index.html'), 'a new reader folder is picked up without editing any list');
    errors = checkReaderDrift(tmp);
    assert(errors.some(e => e.includes('zz-new-issue') && e.includes('no issue:start')), 'the new, unmarked reader is reported, got: ' + JSON.stringify(errors));
    fs.copyFileSync(path.join(REAL_ROOT, readers[0]), path.join(extra, 'index.html'));
    assert(checkReaderDrift(tmp).length === 0, 'a faithful copy of a reader passes');
    console.log('[check-reader-drift.test] PASS - in-marker edits pass; outside edits, missing/unbalanced markers and an unmarked new reader are caught');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  run();
} catch (e) {
  console.error('FAIL -', e.message);
  process.exit(1);
}
