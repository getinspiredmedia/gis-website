'use strict';
/*
 * 5 pages sit outside the build pipeline (see CLAUDE.md) and carry a
 * hand-maintained copy of build/partials/analytics.html's Plausible script
 * tags: public/on-view/index.html, public/work/index.html, and the 3
 * magazine reader pages (chasing-light, no-algorithm, origins — readers have
 * no nav, per the design system, so this is the only shared partial they
 * carry). This guards against any of them silently drifting from the
 * partial — e.g. if the script hash, domain, or init snippet ever changes
 * and one copy doesn't get updated.
 *
 * This is a separate checker from check-nav-drift.js, not an extension of
 * it: the two partials have structurally unrelated content to extract (nav
 * markup + toggle button/ARIA vs. two <script> tags with no nav at all), and
 * folding analytics checks into a file/function named "nav-drift" would
 * make that name stop describing what it actually checks.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Hand-maintained copies of build/partials/analytics.html. Add a page here
// the moment it gets its own copy of the analytics script tags.
const HAND_MAINTAINED_COPIES = [
  'public/on-view/index.html',
  'public/work/index.html',
  'public/magazine/chasing-light/index.html',
  'public/magazine/no-algorithm/index.html',
  'public/magazine/origins/index.html',
];

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

function extractScriptSrcTag(html) {
  const match = html.match(/<script async src="[^"]*"><\/script>/);
  return match ? match[0] : null;
}

function extractInitScript(html) {
  const scripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  return scripts.find(s => s.includes('window.plausible=window.plausible||')) || null;
}

function checkAnalyticsDrift() {
  const partial = read('build/partials/analytics.html');

  const partialSrcTag = extractScriptSrcTag(partial);
  const partialInit   = extractInitScript(partial);

  const errors = [];
  if (!partialSrcTag) errors.push('Could not find the Plausible <script async src="..."> tag in build/partials/analytics.html');
  if (!partialInit)   errors.push('Could not find the Plausible init <script> in build/partials/analytics.html');

  for (const copyPath of HAND_MAINTAINED_COPIES) {
    const copy = read(copyPath);
    const copySrcTag = extractScriptSrcTag(copy);
    const copyInit   = extractInitScript(copy);

    if (!copySrcTag) errors.push(`Could not find the Plausible <script async src="..."> tag in ${copyPath}`);
    if (!copyInit)   errors.push(`Could not find the Plausible init <script> in ${copyPath}`);

    if (partialSrcTag && copySrcTag && partialSrcTag !== copySrcTag) {
      errors.push(
        `Plausible script tag in ${copyPath} has drifted from build/partials/analytics.html — partial="${partialSrcTag}" vs copy="${copySrcTag}"`
      );
    }
    if (partialInit && copyInit && partialInit !== copyInit) {
      errors.push(`Plausible init script in ${copyPath} has drifted from build/partials/analytics.html`);
    }
  }

  return errors;
}

if (require.main === module) {
  const errors = checkAnalyticsDrift();
  if (errors.length) {
    console.error('[check-analytics-drift] FAILED:');
    errors.forEach(e => console.error('  - ' + e));
    console.error('\nThe pages listed in HAND_MAINTAINED_COPIES are maintained by hand (they are not part of the build pipeline).');
    console.error('When you change build/partials/analytics.html, copy the same <script> tags into each of them.');
    process.exit(1);
  }
  console.log(`[check-analytics-drift] OK — ${HAND_MAINTAINED_COPIES.length} hand-maintained copies match build/partials/analytics.html`);
}

module.exports = { checkAnalyticsDrift };
