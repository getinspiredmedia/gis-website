'use strict';
/*
 * The homepage (build/pages/index.html -> public/index.html) is a static
 * showcase for the issues, the gallery and the issue 05 open call: a Bloom
 * cold-open hero, a five-card issue strip, one blue statement, an exhibition
 * band and the doors. This checks the generated public/index.html directly
 * (no DOM runner in this repo): the five issue cards and their hrefs, that
 * there is exactly one statement element, that every <img> has an alt
 * attribute, and the copy rules from docs/gis-design-system.md (no long
 * dash, never the word "community").
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

// Five issue cards, in order, each a link to the right destination.
const cardRe = /<a class="card[^"]*"[^>]*href="([^"]+)"[^>]*>/g;
const hrefs = [];
let m;
while ((m = cardRe.exec(html))) hrefs.push(m[1]);
assert(hrefs.length === 5, `exactly five issue cards — got ${hrefs.length}`);
assert(
  JSON.stringify(hrefs) === JSON.stringify(['/magazine/bloom', '/magazine/chasing-light', '/magazine/no-algorithm', '/magazine/origins', '/submit']),
  `cards are in order 04 Bloom, 03 Chasing Light, 02 No Algorithm, 01 Origins, 05 (open call) with valid hrefs — got ${JSON.stringify(hrefs)}`
);
console.log('PASS - five issue cards, in order, each with a valid href');

// Every card is reachable by Tab (a plain <a href>, no tabindex="-1") and the
// 05 card points at the same destination as the "To be seen" door and as the
// existing open-call CTA (both /submit).
assert(!/<a class="card[^"]*"[^>]*tabindex="-1"/.test(html), 'no issue card is removed from the tab order');
const seenDoorHref = html.match(/<div class="door seen[^>]*>[\s\S]*?<a class="btn" href="([^"]+)"/);
assert(seenDoorHref && seenDoorHref[1] === '/submit', 'the "To be seen" door and the 05 card share the same destination (/submit)');
console.log('PASS - every card is tabbable, and the 05 card shares its destination with the "To be seen" door');

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
// Checked against the visible text: <style>/<script> content and HTML
// comments stripped first (the shared nav partial has a code comment with a
// dash in it, which isn't copy on the page), then tags stripped.
const visibleText = html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<[^>]*>/g, ' ');
assert(!visibleText.includes('—'), 'no long dash (U+2014) anywhere in the visible text');
assert(!/\bcommunity\b/i.test(visibleText), 'the word "community" never appears in the visible text');
console.log('PASS - no long dash and no "community" anywhere in the visible text');

// motion.js and the self-hosted vendor scripts are referenced, not a CDN.
assert(/src="\/js\/motion\.js"/.test(html), 'the page loads /js/motion.js');
assert(/src="\/js\/vendor\/gsap\.min\.js"/.test(html), 'GSAP is self-hosted, not loaded from a CDN');
assert(!/cdn\.jsdelivr|cdnjs\.cloudflare|unpkg\.com/.test(html), 'no external CDN script is referenced');
console.log('PASS - motion.js and GSAP/Lenis are self-hosted, no external CDN');

console.log('\nALL PASS');
