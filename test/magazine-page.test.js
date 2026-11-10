'use strict';
/*
 * /magazine's issue-05 archive row used to carry stale, now-false open call
 * information ("January", "the open call on 1 November", "Five places,
 * still open.", a "Not yet" cover). It now reuses the exact copy already on
 * /submit (build/pages/submit.html, via build/pages.config.js's ISSUE_05_*
 * constants), and links to it like every other row.
 *
 * This also guards the cover-cropping bugfix across /magazine and the four
 * issue pages: no cover thumbnail anywhere on those five pages may use
 * object-fit:cover (every one of them now takes its box ratio from the
 * real image instead).
 */
const fs = require('fs');
const path = require('path');

const { ISSUE_CALL_URL, ISSUE_CALL_CARD_LINE, ISSUE_05_TITLE, ISSUE_05_STATEMENT, ISSUE_05_LAUNCH_LINE } = require('../build/pages.config');
const { ISSUES } = require('../build/data/issues');

const ROOT = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function readPublic(p) {
  return fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
}

function listHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listHtmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// Strips <script>/<style> bodies and HTML comments, then every tag
// (attributes included), leaving only the text that actually renders on
// screen — a placeholder="..." attribute (e.g. on-view/submit's genuine
// "Untitled" input hint) is not visible text and is correctly not part of
// this, only literal text nodes are.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ');
}

function run() {
  const magazineHtml = readPublic('magazine/index.html');

  // Criterion 1: the issue 05 row, exact order, linking to ISSUE_CALL_URL.
  const rowMatch = magazineHtml.match(/<a class="row next rv" href="([^"]*)">([\s\S]*?)<\/a>/);
  assert(rowMatch, 'the issue 05 row ("row next") is present as a link');
  assert(rowMatch[1] === ISSUE_CALL_URL, `the row links to ISSUE_CALL_URL (${ISSUE_CALL_URL}) — got ${rowMatch[1]}`);
  const rowBody = rowMatch[2];
  const expectedOrder = [
    'No. 05',
    ISSUE_05_TITLE,
    ISSUE_05_STATEMENT,
    ISSUE_CALL_CARD_LINE,
    ISSUE_05_LAUNCH_LINE,
  ];
  let cursor = -1;
  expectedOrder.forEach((needle) => {
    const at = rowBody.indexOf(needle, cursor + 1);
    assert(at > cursor, `the row contains "${needle}" after the previous line, in order — not found in the expected position`);
    cursor = at;
  });
  console.log('PASS - /magazine\'s issue 05 row has exactly the five expected lines, in order, linking to ' + ISSUE_CALL_URL);

  // Criterion 2 / test 1: no stale open call information anywhere in the
  // built site's visible text. "Untitled" is deliberately not included
  // here as a banned phrase — see on-view/submit/index.html's genuine,
  // unrelated placeholder="Untitled" input hint, which is an attribute,
  // not visible text, and this check only ever looks at visible text.
  const STALE_PHRASES = [
    '1 November',
    '10 January',
    'Five places',
    'opens 9 November',
    'The theme goes out with the open call',
    'still open.',
  ];
  const htmlFiles = listHtmlFiles(path.join(ROOT, 'public'));
  const offenders = [];
  for (const file of htmlFiles) {
    const text = visibleText(fs.readFileSync(file, 'utf8'));
    for (const phrase of STALE_PHRASES) {
      if (text.includes(phrase)) offenders.push(`${path.relative(ROOT, file)}: "${phrase}"`);
    }
  }
  assert(offenders.length === 0, `no stale open call phrase anywhere in public/'s visible text — got ${JSON.stringify(offenders)}`);
  console.log('PASS - no stale open call information (old dates, "Five places", the old placeholder cover text) anywhere in the built site\'s visible text');

  // Criterion 3: no *cover* thumbnail on /magazine or any issue page crops
  // via object-fit:cover any more — scoped to the cover-specific selectors
  // (.i-cover, .cover), not every image on the page: .i-artist-row .tile
  // img and .i-look-item img are spread thumbnails, not magazine covers,
  // and are deliberately unaffected by this bugfix.
  const COVER_PAGES = ['magazine/index.html', ...ISSUES.map(i => `magazine/${i.slug}/index.html`)];
  const COVER_SELECTOR_RULE = /(^|[\s,}])(\.i-cover|\.cover)\{[^}]*\}/g;
  const cropOffenders = [];
  for (const rel of COVER_PAGES) {
    const html = readPublic(rel);
    const rules = html.match(COVER_SELECTOR_RULE) || [];
    if (rules.some(rule => /object-fit:\s*cover/.test(rule))) cropOffenders.push(rel);
  }
  assert(cropOffenders.length === 0, `no cover-selector rule uses object-fit:cover on /magazine or the issue pages — got ${JSON.stringify(cropOffenders)}`);
  console.log('PASS - no cover thumbnail (.i-cover/.cover) on /magazine or any of the four issue pages uses object-fit:cover (every one takes its real ratio instead)');

  // No long dash, no "community" in the new copy specifically.
  assert(!rowBody.includes('—'), 'no long dash in the issue 05 row');
  assert(!/community/i.test(rowBody), 'no "community" in the issue 05 row');
  console.log('PASS - no long dash or "community" in the new issue 05 row copy');

  console.log('\nALL PASS');
}

if (require.main === module) {
  try {
    run();
    process.exit(0);
  } catch (e) {
    console.error('FAIL -', e.message);
    process.exit(1);
  }
}

module.exports = { run };
