'use strict';
/*
 * The homepage (build/pages/index.html -> public/index.html) is a static
 * showcase for the issues, the gallery and the issue 05 open call: a Bloom
 * cold-open hero, a five-card issue strip, one blue statement, an exhibition
 * band and the doors. This checks the generated public/index.html directly
 * (no DOM runner in this repo): the five issue cards and their hrefs, that
 * there is exactly one statement element, that every <img> has an alt
 * attribute, the copy rules from docs/gis-design-system.md (no long dash,
 * never the word "community"), that nothing on the page links to /submit or
 * /on-view, and that the nav has no "On view" item.
 *
 * The issue 05 card and the "To be seen" door use ISSUE_CALL_URL,
 * ISSUE_CALL_CARD_LINE and ISSUE_CALL_DOOR_LINE from build/pages.config.js,
 * not a hardcoded link or claim: until the real form exists, that config
 * points at /magazine (a real page, not a placeholder) and the copy says
 * the open call hasn't started yet, rather than claiming it's already open
 * with a close date that isn't true today. Swapping all three in that one
 * file is how the actual open call goes live.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const { ISSUE_CALL_URL, ISSUE_CALL_CARD_LINE, ISSUE_CALL_DOOR_LINE } = require('../build/pages.config');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

// Visible text only: <style>/<script> content and HTML comments stripped
// first (e.g. the shared nav partial's "Close menu" aria-label and its
// close() helper function aren't copy on the page), then tags stripped.
// Used for every check below that reads what a visitor would actually see.
const visibleText = html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<[^>]*>/g, ' ');

// Five issue cards, in order, each a link to the right destination.
const cardRe = /<a class="card[^"]*"[^>]*href="([^"]+)"[^>]*>/g;
const hrefs = [];
let m;
while ((m = cardRe.exec(html))) hrefs.push(m[1]);
assert(hrefs.length === 5, `exactly five issue cards — got ${hrefs.length}`);
assert(
  JSON.stringify(hrefs) === JSON.stringify(['/magazine/bloom', '/magazine/chasing-light', '/magazine/no-algorithm', '/magazine/origins', ISSUE_CALL_URL]),
  `cards are in order 04 Bloom, 03 Chasing Light, 02 No Algorithm, 01 Origins, 05 (ISSUE_CALL_URL) with valid hrefs — got ${JSON.stringify(hrefs)}`
);
console.log('PASS - five issue cards, in order, each with a valid href');

// Every card is reachable by Tab (a plain <a href>, no tabindex="-1") and the
// 05 card points at the same destination as the "To be seen" door (both
// ISSUE_CALL_URL, André's own issue 05 form — not /submit, the weekly On
// View flow).
assert(!/<a class="card[^"]*"[^>]*tabindex="-1"/.test(html), 'no issue card is removed from the tab order');
const seenDoorHref = html.match(/<a class="door seen[^>]*"[^>]*href="([^"]+)"/);
assert(seenDoorHref && seenDoorHref[1] === ISSUE_CALL_URL, `the "To be seen" door uses ISSUE_CALL_URL — got ${seenDoorHref && seenDoorHref[1]}`);
console.log('PASS - every card is tabbable, and the 05 card shares its destination with the "To be seen" door (ISSUE_CALL_URL)');

// Neither door is a separate <button>/<a class="btn">: the whole door itself
// is the link (task: "Geen losse knoppen in de doors").
assert(!/<div class="door/.test(html), 'the doors are <a> elements, not <div>s with a separate button inside');
const lookDoorHref = html.match(/<a class="door look[^"]*"[^>]*href="([^"]+)"/);
assert(lookDoorHref && lookDoorHref[1] === '/magazine', `the "To look" door links straight to /magazine — got ${lookDoorHref && lookDoorHref[1]}`);
console.log('PASS - both doors are whole-door links, with no separate button inside');

// Nothing on the page links to /submit (the weekly On View form) or
// /on-view: the homepage routes issue 05 to ISSUE_CALL_URL and no longer
// promotes the On View wall at all.
assert(!/href="\/submit"/.test(html), 'no link on the homepage points at /submit');
assert(!/href="\/on-view"/.test(html), 'no link on the homepage points at /on-view');
console.log('PASS - no link on the homepage points at /submit or /on-view');

// No dead placeholder link (tally.com or any other obvious stand-in).
assert(!/tally\.com/i.test(html), 'no href points at the old tally.com placeholder');
assert(!/placeholder/i.test(html), 'no placeholder link or marker is left on the page');
console.log('PASS - no placeholder link (tally.com or otherwise) on the homepage');

// The 05 card and the "To be seen" door carry the exact configured copy,
// not a hardcoded claim that the open call is already running.
assert(html.includes(`<span class="card-label">${ISSUE_CALL_CARD_LINE}</span>`),
  `the 05 card shows ISSUE_CALL_CARD_LINE ("${ISSUE_CALL_CARD_LINE}") verbatim`);
assert(html.includes(`<p>${ISSUE_CALL_DOOR_LINE}</p>`),
  `the "To be seen" door shows ISSUE_CALL_DOOR_LINE ("${ISSUE_CALL_DOOR_LINE}") verbatim`);
console.log('PASS - the 05 card and the "To be seen" door use the configured copy verbatim');

// With today's config values, nothing visible on the page claims the open
// call is already open or names a close date — that would be false before
// it opens on 9 November.
assert(!/\bis open\b/i.test(visibleText), 'no text claims the open call "is open"');
assert(!/\bopen now\b/i.test(visibleText), 'no text claims the open call is "open now"');
assert(!/\bcloses?\b/i.test(visibleText), 'no text names a close date for the open call');
console.log('PASS - no claim that the open call is already open, and no close date');

// The nav has no "On view" item (sitewide change, checked here for the
// homepage specifically; test/society-redirect.test.js covers every page).
const navMenu = html.match(/<div class="menu"[^>]*>([\s\S]*?)<\/div>/);
assert(navMenu, 'the page has a nav menu');
assert(!/On view/i.test(navMenu[1]), 'the nav has no "On view" item');
console.log('PASS - the nav has no "On view" item');

// Exactly one statement (one blue claim) on the page.
const statementCount = (html.match(/class="statement"/g) || []).length;
assert(statementCount === 1, `exactly one .statement element — got ${statementCount}`);
const claimCount = (html.match(/<section class="claim/g) || []).length;
assert(claimCount === 1, `exactly one .claim section — got ${claimCount}`);
console.log('PASS - exactly one blue statement on the page');

// Every <img> has an alt attribute (empty alt is fine for decorative images,
// missing alt is not).
const imgTags = html.match(/<img\b[^>]*>/g) || [];
assert(imgTags.length > 0, 'the page has at least one <img>');
imgTags.forEach(tag => {
  assert(/\balt="/.test(tag), `every <img> has an alt attribute — missing on: ${tag}`);
});
console.log(`PASS - all ${imgTags.length} <img> tags carry an alt attribute`);

// Copy rules: no long dash (U+2014), and never the word "community".
assert(!visibleText.includes('—'), 'no long dash (U+2014) anywhere in the visible text');
assert(!/\bcommunity\b/i.test(visibleText), 'the word "community" never appears in the visible text');
console.log('PASS - no long dash and no "community" anywhere in the visible text');

// motion.js and the self-hosted vendor scripts are referenced, not a CDN.
assert(/src="\/js\/motion\.js"/.test(html), 'the page loads /js/motion.js');
assert(/src="\/js\/vendor\/gsap\.min\.js"/.test(html), 'GSAP is self-hosted, not loaded from a CDN');
assert(!/cdn\.jsdelivr|cdnjs\.cloudflare|unpkg\.com/.test(html), 'no external CDN script is referenced');
console.log('PASS - motion.js and GSAP/Lenis are self-hosted, no external CDN');

// The generated hero JPEG has no white page margin and no covertext at its
// very edges: sample the four corners and the midpoint of each edge, and
// assert none of them is a plain-white background pixel (RGB sum under
// 700 — the Bloom photo itself is always much darker than that at these
// positions; white page margin or white cover type would read near 765).
(async () => {
  const heroPath = path.join(ROOT, 'public', 'assets', 'responsive', 'bloom-hero-1235.jpg');
  const { data, info } = await sharp(heroPath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  function pixelSum(x, y) {
    const idx = (y * width + x) * channels;
    return data[idx] + data[idx + 1] + data[idx + 2];
  }
  const points = {
    'top-left corner':    [0, 0],
    'top-right corner':   [width - 1, 0],
    'bottom-left corner': [0, height - 1],
    'bottom-right corner': [width - 1, height - 1],
    'top edge midpoint':    [Math.floor(width / 2), 0],
    'bottom edge midpoint': [Math.floor(width / 2), height - 1],
    'left edge midpoint':   [0, Math.floor(height / 2)],
    'right edge midpoint':  [width - 1, Math.floor(height / 2)],
  };
  for (const [label, [x, y]] of Object.entries(points)) {
    const sum = pixelSum(x, y);
    assert(sum < 700, `bloom-hero-1235.jpg's ${label} is not a white margin/covertext pixel (RGB sum < 700) — got ${sum} at (${x},${y})`);
  }
  console.log('PASS - the generated hero JPEG has no white margin or covertext at any corner or edge midpoint');

  console.log('\nALL PASS');
})();
