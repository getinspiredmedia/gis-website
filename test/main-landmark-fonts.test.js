'use strict';
/*
 * Every page on the site must have exactly one <main> landmark and must not
 * load its Google Fonts stylesheet render-blocking (see CLAUDE.md /
 * docs/gis-design-system.md). This is a static check against the built
 * public/ tree (built-system pages) plus the hand-maintained pages, not a
 * live-server test — npm run build must have run first.
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

function hasRenderBlockingFontStylesheet(head) {
  // A plain <link rel="stylesheet" href="...fonts.googleapis.com..."> (or
  // href-before-rel, same thing) with no media="print" swap is render-blocking.
  // The <noscript> fallback intentionally repeats that same blocking link for
  // the no-JS case, so it's excluded here, not a violation.
  const headWithoutNoscript = head.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  const linkTags = headWithoutNoscript.match(/<link\b[^>]*>/g) || [];
  return linkTags.some(tag => {
    if (!/fonts\.googleapis\.com/.test(tag)) return false;
    if (!/rel="stylesheet"/.test(tag)) return false;
    return !/media="print"/.test(tag);
  });
}

function hasNonBlockingFontPattern(head) {
  const hasPreload = /<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com[^"]*">/.test(head);
  const hasSwap = /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*" media="print" onload="this\.media='all'">/.test(head);
  const hasNoscript = /<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*"><\/noscript>/.test(head);
  return hasPreload && hasSwap && hasNoscript;
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

    assert(!hasRenderBlockingFontStylesheet(head), `${rel}: has a render-blocking Google Fonts <link rel="stylesheet"> in <head>`);
    assert(hasNonBlockingFontPattern(head), `${rel}: missing the non-blocking font-load pattern (preload + media="print" swap + noscript fallback) in <head>`);

    checked++;
    console.log(`PASS - ${rel}: exactly one <main>, fonts load non-blocking`);
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
