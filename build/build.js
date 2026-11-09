'use strict';
const fs = require('fs');
const path = require('path');
const { pages, ISSUE_CALL_URL, ISSUE_CALL_CARD_LINE, ISSUE_CALL_DOOR_LINE, TALLY_URL } = require('./pages.config');
const { CORRIDOR_ARTISTS } = require('./corridor-artists');

const ROOT = path.resolve(__dirname, '..');
const PARTIALS = path.join(__dirname, 'partials');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function injectNav(html, navConfig) {
  let partial = read(path.join(PARTIALS, 'nav.html'));
  const attr = navConfig.variant === 'light' ? ' data-variant="light"' : '';
  partial = partial.replace('{{NAV_ATTR}}', attr);
  if (navConfig.active) {
    partial = partial.replace(
      new RegExp(`data-nav="${navConfig.active}" href="[^"]*"`),
      `data-nav="${navConfig.active}" aria-current="page" href="#"`
    );
  }
  partial = partial.replace(/ data-nav="[^"]*"/g, '');
  return html.replace('<!-- @include: nav -->', partial);
}

function injectFooter(html, navConfig, footerConfig) {
  let partial = read(path.join(PARTIALS, 'footer.html'));
  const tagline = footerConfig?.tagline;
  partial = partial.replace(
    '<!-- FOOTER_TAGLINE -->',
    tagline ? `<p class="close rv">${tagline}</p>` : ''
  );
  if (navConfig.active) {
    partial = partial.replace(
      new RegExp(`data-footer="${navConfig.active}" href="[^"]*"`),
      `data-footer="${navConfig.active}" href="#"`
    );
  }
  partial = partial.replace(/ data-footer="[^"]*"/g, '');
  return html.replace('<!-- @include: footer -->', partial);
}

function injectWipe(html) {
  const partial = read(path.join(PARTIALS, 'wipe.html'));
  return html.replace('<!-- @include: wipe -->', partial);
}

function injectAnalytics(html) {
  const partial = read(path.join(PARTIALS, 'analytics.html'));
  return html.replace('<!-- @include: analytics -->', partial);
}

// The issue 05 open call's link and copy (see pages.config.js) — only the
// homepage references these tokens. All three are swapped together, in
// pages.config.js alone, once the real form exists.
function injectIssueCallUrl(html) {
  return html
    .split('{{ISSUE_CALL_URL}}').join(ISSUE_CALL_URL)
    .split('{{ISSUE_CALL_CARD_LINE}}').join(ISSUE_CALL_CARD_LINE)
    .split('{{ISSUE_CALL_DOOR_LINE}}').join(ISSUE_CALL_DOOR_LINE);
}

// The WONDER open call's Tally form link (see pages.config.js), used only
// by build/pages/submit.html. Aborting the build on a malformed value is
// cheaper than shipping a submit page whose three buttons silently go
// nowhere useful. Two checks, not one: the shape must be a real Tally
// form link (https://tally.so/r/<id>, not just any https://tally.so/...
// path), and it must not carry a leftover placeholder word, since a
// value that happens to match the shape (e.g. https://tally.so/r/REPLACE_ME)
// would otherwise pass the shape check alone.
const TALLY_URL_PATTERN = /^https:\/\/tally\.so\/r\/[A-Za-z0-9]+$/;
const TALLY_URL_PLACEHOLDER_WORDS = /REPLACE|TODO|TEMP|EXAMPLE|PLACEHOLDER/i;

function injectTallyUrl(html) {
  return html.split('{{TALLY_URL}}').join(TALLY_URL);
}

// The homepage corridor's five artist works, rendered server-side from the
// shared build/corridor-artists.js so the plain-HTML fallback (no JS, see
// CLAUDE.md's corridor entry) needs no client-side rendering at all — the
// same markup is simply repositioned/animated by the page's own inline
// script when JS and motion are available.
function injectCorridorWorks(html) {
  const room = n => String(n).padStart(2, '0');
  const figures = CORRIDOR_ARTISTS.map(a => {
    const base = `/assets/responsive/corridor-${a.slug}`;
    const sizes = '(min-width:861px) 26vw, 68vw';
    return `    <figure class="corr-work" data-room="${a.room}">
      <span class="spot" aria-hidden="true"></span>
      <span class="floor" aria-hidden="true"></span>
      <picture>
        <source type="image/avif" srcset="${base}-450.avif 450w, ${base}-900.avif 900w" sizes="${sizes}">
        <source type="image/webp" srcset="${base}-450.webp 450w, ${base}-900.webp 900w" sizes="${sizes}">
        <img src="${base}-900.jpg" srcset="${base}-450.jpg 450w, ${base}-900.jpg 900w" sizes="${sizes}" alt="Work by ${a.name}, Room ${room(a.room)}" loading="eager" decoding="async" width="${a.width}" height="${a.height}">
      </picture>
      <figcaption class="plaque"><b>${a.name}</b><span>Room ${room(a.room)}</span></figcaption>
    </figure>`;
  }).join('\n');
  return html.replace('    <!-- {{CORRIDOR_WORKS}} -->', figures);
}

if (!TALLY_URL_PATTERN.test(TALLY_URL)) {
  console.error(`[build] Aborting — TALLY_URL in build/pages.config.js must match https://tally.so/r/<id>, got: ${TALLY_URL}`);
  process.exit(1);
}
if (TALLY_URL_PLACEHOLDER_WORDS.test(TALLY_URL)) {
  console.error(`[build] Aborting — TALLY_URL in build/pages.config.js still looks like a placeholder, got: ${TALLY_URL}`);
  process.exit(1);
}

const { checkNavDrift } = require('./check-nav-drift');
const navDriftErrors = checkNavDrift();
if (navDriftErrors.length) {
  console.error('[build] Aborting — a hand-maintained nav copy has drifted from build/partials/nav.html:');
  navDriftErrors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}

const { checkAnalyticsDrift } = require('./check-analytics-drift');
const analyticsDriftErrors = checkAnalyticsDrift();
if (analyticsDriftErrors.length) {
  console.error('[build] Aborting — a hand-maintained analytics copy has drifted from build/partials/analytics.html:');
  analyticsDriftErrors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}

const { checkReaderDrift } = require('./check-reader-drift');
const readerDriftErrors = checkReaderDrift();
if (readerDriftErrors.length) {
  console.error('[build] Aborting — a magazine reader has drifted outside its issue markers:');
  readerDriftErrors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}

pages.forEach(config => {
  const inputPath = path.join(ROOT, config.input);
  if (!fs.existsSync(inputPath)) {
    console.warn(`Skipped (not yet created): ${config.input}`);
    return;
  }
  let html = read(inputPath);
  html = injectNav(html, config.nav);
  html = injectFooter(html, config.nav, config.footer);
  if (config.wipe !== false) html = injectWipe(html);
  html = injectAnalytics(html);
  html = injectIssueCallUrl(html);
  html = injectTallyUrl(html);
  if (config.input === 'build/pages/index.html') html = injectCorridorWorks(html);
  const outPath = path.join(ROOT, config.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Built: ${config.output}`);
});

// Responsive image variants (AVIF/WebP/JPEG) for the homepage — idempotent,
// only encodes a size that isn't already on disk.
require('./generate-responsive-images').run().then(() => {
  // Self-hosted GSAP + Lenis: copied from node_modules into public/js/vendor
  // so the homepage never loads them from a third-party CDN. Copied, not
  // symlinked, so public/ stays a plain static tree Railway can serve as-is.
  const VENDOR_FILES = [
    ['gsap/dist/gsap.min.js', 'gsap.min.js'],
    ['gsap/dist/ScrollTrigger.min.js', 'ScrollTrigger.min.js'],
    ['lenis/dist/lenis.min.js', 'lenis.min.js'],
  ];
  const vendorDir = path.join(ROOT, 'public', 'js', 'vendor');
  fs.mkdirSync(vendorDir, { recursive: true });
  VENDOR_FILES.forEach(([from, to]) => {
    fs.copyFileSync(path.join(ROOT, 'node_modules', from), path.join(vendorDir, to));
    console.log(`Vendored: public/js/vendor/${to}`);
  });
}).catch(e => {
  console.error('[build] Aborting — could not generate responsive images or vendor files:', e.message);
  process.exit(1);
});
