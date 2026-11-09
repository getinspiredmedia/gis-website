'use strict';
const fs = require('fs');
const path = require('path');
const { pages, ISSUE_CALL_URL, ISSUE_CALL_CARD_LINE, ISSUE_CALL_DOOR_LINE, TALLY_URL } = require('./pages.config');

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
// by build/pages/submit.html. Aborting the build on a
// malformed value (not a real https://tally.so/ link) is cheaper than
// shipping a submit page whose three buttons silently go nowhere useful.
function injectTallyUrl(html) {
  return html.split('{{TALLY_URL}}').join(TALLY_URL);
}

if (!TALLY_URL.startsWith('https://tally.so/')) {
  console.error(`[build] Aborting — TALLY_URL in build/pages.config.js must start with https://tally.so/, got: ${TALLY_URL}`);
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
