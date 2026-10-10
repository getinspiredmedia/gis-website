'use strict';
/*
 * The magazine readers (public/magazine/<slug>/index.html) are hand-maintained
 * copies of one template, outside the build pipeline. Everything that belongs
 * to a single issue sits between marker lines; everything else must be
 * identical in every reader:
 *
 *   <!-- issue:start --> ... <!-- issue:end -->   in HTML
 *   // issue:start ... // issue:end               in the script
 *
 * Readers are found by glob (build/readers.js), so a new issue is guarded the
 * moment its folder exists. A reader without (balanced) markers is an error,
 * not a skip.
 */
const fs = require('fs');
const path = require('path');
const { listReaderPages } = require('./readers');

const ROOT = path.resolve(__dirname, '..');

const START = /^\s*(?:<!--\s*issue:start\s*-->|\/\/\s*issue:start)\s*$/;
const END   = /^\s*(?:<!--\s*issue:end\s*-->|\/\/\s*issue:end)\s*$/;

// Lines of one reader with every marked region emptied (the marker lines
// stay), or an error for missing / unbalanced markers. BOM, line endings and
// trailing newlines are not part of the comparison.
function normalize(text) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const out = [];
  let open = false, pairs = 0;
  for (let i = 0; i < lines.length; i++) {
    if (START.test(lines[i])) {
      if (open) return { error: `issue:start on line ${i + 1} inside an unclosed region` };
      open = true;
      out.push(lines[i].trim());
    } else if (END.test(lines[i])) {
      if (!open) return { error: `issue:end on line ${i + 1} without a matching issue:start` };
      open = false;
      pairs++;
      out.push(lines[i].trim());
    } else if (!open) {
      out.push(lines[i]);
    }
  }
  if (open) return { error: 'issue:start without a matching issue:end' };
  if (pairs === 0) return { error: 'no issue:start / issue:end markers found' };
  return { lines: out };
}

function checkReaderDrift(root = ROOT) {
  const readers = listReaderPages(root);
  if (readers.length === 0) return ['No readers found under public/magazine/*/index.html'];

  const errors = [];
  const parsed = readers.map(p => ({ p, ...normalize(fs.readFileSync(path.join(root, p), 'utf8')) }));
  for (const r of parsed) if (r.error) errors.push(`${r.p}: ${r.error}`);

  const [ref, ...rest] = parsed.filter(r => r.lines);
  for (const r of rest) {
    const n = Math.max(ref.lines.length, r.lines.length);
    for (let i = 0; i < n; i++) {
      if (ref.lines[i] !== r.lines[i]) {
        const show = l => JSON.stringify((l ?? '<end of file>').slice(0, 120));
        errors.push(`${r.p} differs from ${ref.p} outside the issue markers at normalized line ${i + 1}: ${show(r.lines[i])} vs ${show(ref.lines[i])}`);
        break;
      }
    }
  }
  return errors;
}

if (require.main === module) {
  const errors = checkReaderDrift();
  if (errors.length) {
    console.error('[check-reader-drift] FAILED:');
    errors.forEach(e => console.error('  - ' + e));
    console.error('\nA reader may only differ from the others between its issue:start / issue:end markers.');
    console.error('Change shared markup, styles or script in every reader; per-issue content goes between the markers.');
    process.exit(1);
  }
  console.log(`[check-reader-drift] OK — ${listReaderPages().length} readers are identical outside their issue markers`);
}

module.exports = { checkReaderDrift };
