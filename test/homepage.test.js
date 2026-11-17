'use strict';
/*
 * The homepage (build/pages/index.html -> public/index.html) is a simplified
 * showcase: the magazine itself (current issue + archive, shared verbatim
 * with /magazine via build/partials/magazine-block.html), the blue
 * statement, a static gallery end-image section linking to /gallery, and the
 * footer. The former hero/issue-strip/corridor/doors are gone (see
 * CLAUDE.md). This checks the generated public/index.html directly (no DOM
 * runner in this repo): page order, exactly one <main>/<h1>, exactly one
 * statement, the gallery-end section and its image/copy/link, every <img>
 * has an alt attribute, the copy rules from docs/gis-design-system.md (no
 * long dash, never the word "community"), and that no trace of the removed
 * hero/strip/corridor/doors machinery (markup, CSS, scripts, images) is left
 * on the page.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

// Visible text only: <style>/<script> content and HTML comments stripped
// first, then tags stripped. Used for every check below that reads what a
// visitor would actually see.
const visibleText = html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<[^>]*>/g, ' ');

// Page order: <main> opens, the magazine block (.current then .archive),
// then the statement (.claim), then the gallery end-image (.gallery-end),
// then </main>, then the footer.
const mainOpen = html.indexOf('<main id="main">');
const currentIdx = html.indexOf('<section class="current">');
const archiveIdx = html.indexOf('<section class="archive">');
const claimIdx = html.indexOf('<section class="claim');
const galleryEndIdx = html.indexOf('<section class="gallery-end">');
const mainClose = html.indexOf('</main>');
const footerIdx = html.indexOf('<footer>');
assert(
  mainOpen >= 0 && mainOpen < currentIdx && currentIdx < archiveIdx && archiveIdx < claimIdx && claimIdx < galleryEndIdx && galleryEndIdx < mainClose && mainClose < footerIdx,
  `sections appear in order: <main>, .current, .archive, .claim, .gallery-end, </main>, <footer> — got offsets ${JSON.stringify({ mainOpen, currentIdx, archiveIdx, claimIdx, galleryEndIdx, mainClose, footerIdx })}`
);
console.log('PASS - the homepage shows the magazine block, then the statement, then the gallery end-image, then the footer, in that order');

// Exactly one <main> and exactly one <h1>, and the <h1> is the magazine
// block's own current-issue title (the first heading on the page).
assert((html.match(/<main[\s>]/g) || []).length === 1, 'exactly one <main>');
const h1Matches = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/g) || [];
assert(h1Matches.length === 1, `exactly one <h1> — got ${h1Matches.length}`);
assert(h1Matches[0].includes('Bloom'), `the single <h1> is the current issue's own title — got ${h1Matches[0]}`);
const firstHeadingIdx = html.search(/<h[1-6][\s>]/);
assert(firstHeadingIdx === html.indexOf('<h1>'), 'the <h1> is the first heading on the page');
console.log('PASS - exactly one <main> and exactly one <h1>, and it is the first heading on the page');

// A skip-link to #main (added to build/partials/nav.html, sitewide).
assert(/<a class="skip-link" href="#main">Skip to content<\/a>/.test(html), 'the skip-link to #main is present');
console.log('PASS - the skip-link is present');

// Exactly one blue statement ("No algorithm decides what's here.").
const statementCount = (html.match(/class="statement"/g) || []).length;
assert(statementCount === 1, `exactly one .statement element — got ${statementCount}`);
const claimCount = (html.match(/<section class="claim/g) || []).length;
assert(claimCount === 1, `exactly one .claim section — got ${claimCount}`);
assert(/No algorithm<br>decides<br>what's here\./.test(html), 'the statement text is "No algorithm decides what\'s here."');
console.log('PASS - exactly one blue statement on the page, with the expected text');

// The gallery end-image section: room-bloom (existing responsive variants),
// object-fit cover, object-position center 45%, the required alt text, the
// existing copy, lazy-loaded, and a link to /gallery.
const galleryEndSection = html.slice(galleryEndIdx, mainClose);
assert(/room-bloom-1904\.jpg/.test(galleryEndSection), 'the gallery end-image uses the existing room-bloom responsive variants');
assert(/alt="The Bloom room in the Get Inspired Society gallery"/.test(galleryEndSection), 'the gallery end-image has the required alt text');
assert(/loading="lazy"/.test(galleryEndSection), 'the gallery end-image is lazy-loaded');
assert(/object-fit:cover;object-position:center 45%/.test(html), 'the gallery end-image uses object-fit:cover, object-position:center 45%');
assert(/Exhibition no\. 4/.test(galleryEndSection), 'the gallery end-image copy includes "Exhibition no. 4"');
assert(/Walk through<br>Bloom\./.test(galleryEndSection), 'the gallery end-image copy includes "Walk through Bloom."');
assert(/The fourth issue, hung in a room you can move through\./.test(galleryEndSection), 'the gallery end-image copy includes the room description');
assert(/<a class="btn" href="\/gallery">Enter the room/.test(galleryEndSection), 'the gallery end-image has a button linking to /gallery');
console.log('PASS - the gallery end-image section has the real room-bloom image, required alt text, existing copy, and a link to /gallery');

// No trace of the removed hero / issue strip / corridor / doors: markup
// classes, their images, their now-unused build data, and the GSAP/Lenis
// vendor scripts they alone depended on.
const removedMarkers = [
  'class="hero"', 'id="hero"', 'hero-media', 'hero-copy',
  'class="strip"', 'strip-track', 'strip-pin', 'card-label', 'is-empty',
  'class="corridor"', 'corridor-works', 'corridor-door', 'corr-work',
  'class="doors"', 'door look', 'door seen',
  'bloom-hero-desktop', 'bloom-hero-mobile', 'corridor-room-',
  '/js/vendor/gsap', '/js/vendor/ScrollTrigger', '/js/vendor/lenis',
];
removedMarkers.forEach(marker => {
  assert(!html.includes(marker), `no trace of the removed hero/strip/corridor/doors is left on the page — found "${marker}"`);
});
console.log('PASS - no trace of the removed hero, issue strip, corridor or doors (markup, images or vendor scripts)');

// motion.js is still loaded (reveal, nav scroll-shrink, block wipe); GSAP,
// ScrollTrigger and Lenis are not, since nothing on the page pins anymore.
assert(/src="\/js\/motion\.js"/.test(html), 'the page loads /js/motion.js');
assert(!/gsap|ScrollTrigger|Lenis/.test(html), 'GSAP/ScrollTrigger/Lenis are not referenced anywhere on the page');
assert(!/cdn\.jsdelivr|cdnjs\.cloudflare|unpkg\.com/.test(html), 'no external CDN script is referenced');
console.log('PASS - motion.js is still loaded; GSAP/ScrollTrigger/Lenis are gone');

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

// The nav has no "On view" item (sitewide change, checked here for the
// homepage specifically; test/society-redirect.test.js covers every page).
const navMenu = html.match(/<div class="menu"[^>]*>([\s\S]*?)<\/div>/);
assert(navMenu, 'the page has a nav menu');
assert(!/On view/i.test(navMenu[1]), 'the nav has no "On view" item');
console.log('PASS - the nav has no "On view" item');

console.log('\nALL PASS');
