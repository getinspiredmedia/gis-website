'use strict';
/*
 * Every page on the site must have exactly one <main> landmark and must load
 * Archivo from our own domain (/assets/fonts/Archivo-Variable.woff2, preloaded,
 * font-display: swap in its own @font-face), never from fonts.googleapis.com
 * or fonts.gstatic.com (see CLAUDE.md / docs/gis-design-system.md). This is a
 * static check against the built public/ tree (built-system pages) plus the
 * hand-maintained pages, not a live-server test — npm run build must have run
 * first.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PAGES = [
  'public/index.html',
  'public/magazine/index.html',
  'public/magazine/bloom/index.html',
  'public/magazine/chasing-light/index.html',
  'public/magazine/no-algorithm/index.html',
  'public/magazine/origins/index.html',
  'public/gallery/index.html',
  'public/about/index.html',
  'public/contact/index.html',
  'public/support/index.html',
  'public/privacy/index.html',
  'public/submit/index.html',
  'public/on-view/index.html',
  'public/on-view/submit/index.html',
  'public/work/index.html',
  'public/magazine/bloom/read/index.html',
  'public/magazine/chasing-light/read/index.html',
  'public/magazine/no-algorithm/read/index.html',
  'public/magazine/origins/read/index.html',
];

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function headOf(html) {
  const match = html.match(/<head>[\s\S]*?<\/head>/);
  return match ? match[0] : html;
}

function countMainTags(html) {
  const matches = html.match(/<main[\s>]/g) || [];
  return matches.length;
}

function hasGoogleFontsReference(html) {
  return /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html);
}

function hasSelfHostedFontPattern(html, head) {
  const hasPreload = /<link rel="preload" as="font" type="font\/woff2" href="\/assets\/fonts\/Archivo-Variable\.woff2" crossorigin>/.test(head);
  const hasFontFace = /@font-face\s*\{?\s*font-family:\s*'Archivo';[\s\S]{0,200}?font-display:\s*swap;?[\s\S]{0,200}?src:\s*url\('\/assets\/fonts\/Archivo-Variable\.woff2'\) format\('woff2'\)/.test(html);
  return hasPreload && hasFontFace;
}

function run() {
  let checked = 0;
  for (const rel of PAGES) {
    const full = path.join(ROOT, rel);
    assert(fs.existsSync(full), `${rel} does not exist — run npm run build first`);
    const html = fs.readFileSync(full, 'utf8');
    const head = headOf(html);

    const mainCount = countMainTags(html);
    assert(mainCount === 1, `${rel}: expected exactly one <main>, found ${mainCount}`);

    assert(!hasGoogleFontsReference(html), `${rel}: still references fonts.googleapis.com or fonts.gstatic.com`);
    assert(hasSelfHostedFontPattern(html, head), `${rel}: missing the self-hosted Archivo font pattern (preload as font + @font-face with font-display: swap)`);

    checked++;
    console.log(`PASS - ${rel}: exactly one <main>, Archivo self-hosted with font-display: swap`);
  }
  console.log(`\nALL PASS (${checked} pages)`);
}

if (require.main === module) {
  try {
    run();
    process.exit(0);
  } catch (e) {
    console.error('FAIL —', e.message);
    process.exit(1);
  }
}

module.exports = { run };
