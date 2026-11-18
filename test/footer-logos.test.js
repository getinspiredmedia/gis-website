'use strict';
/*
 * The footer's two brush logos (society-logo, magazine-logo) are served as
 * cropped, downsized responsive variants (build/generate-responsive-images.js),
 * not the original 2000x2000 uploads, so the browser never has to fetch a
 * ~250-440KB file for an 80px-tall element. This checks the variants
 * actually on disk: real dimensions (height matches the job's own `heights`
 * entry, within 1px for rounding), transparency preserved, and that what a
 * 1x-density visitor's browser actually loads (the two 160px webp files, the
 * <picture>'s first/default srcset candidate) stays under the task's 40KB
 * budget combined. Also checks every hand-maintained reader copy references
 * the same responsive paths as the partial (belt-and-suspenders alongside
 * check-footer-drift.js, which compares byte-for-byte).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const RESPONSIVE = path.join(ROOT, 'public', 'assets', 'responsive');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

async function checkVariant(base, height) {
  for (const ext of ['webp', 'png']) {
    const p = path.join(RESPONSIVE, `${base}-${height}.${ext}`);
    assert(fs.existsSync(p), `${base}-${height}.${ext} exists in public/assets/responsive`);
    const meta = await sharp(p).metadata();
    assert(Math.abs(meta.height - height) <= 1, `${base}-${height}.${ext} is ${height}px tall — got ${meta.height}`);
    assert(meta.hasAlpha, `${base}-${height}.${ext} keeps its transparent background`);
  }
}

async function checkCombinedBudget() {
  const society160 = fs.statSync(path.join(RESPONSIVE, 'society-logo-160.webp')).size;
  const magazine160 = fs.statSync(path.join(RESPONSIVE, 'magazine-logo-160.webp')).size;
  const combined = society160 + magazine160;
  assert(combined < 40 * 1024, `the two 1x footer logos together are under 40KB — got ${(combined / 1024).toFixed(1)}KB`);
}

function checkReaderCopiesReferenceResponsivePaths() {
  const { listReaderPages } = require('../build/readers');
  for (const rel of listReaderPages()) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert(html.includes('/assets/responsive/society-logo-160.webp'), `${rel} references the society-logo responsive variant`);
    assert(html.includes('/assets/responsive/magazine-logo-160.webp'), `${rel} references the magazine-logo responsive variant`);
  }
}

function checkPartialUsesPictureWithSrcset() {
  const html = fs.readFileSync(path.join(ROOT, 'build', 'partials', 'footer.html'), 'utf8');
  assert((html.match(/<picture>/g) || []).length === 2, 'footer partial has exactly two <picture> elements (one per logo)');
  assert(html.includes('society-logo-160.webp 1x, /assets/responsive/society-logo-240.webp 1.5x'), 'society logo srcset offers 1x/1.5x candidates');
  assert(html.includes('magazine-logo-160.webp 1x, /assets/responsive/magazine-logo-240.webp 1.5x'), 'magazine logo srcset offers 1x/1.5x candidates');
}

async function run() {
  await checkVariant('society-logo', 160);
  await checkVariant('society-logo', 240);
  await checkVariant('magazine-logo', 160);
  await checkVariant('magazine-logo', 240);
  await checkCombinedBudget();
  checkReaderCopiesReferenceResponsivePaths();
  checkPartialUsesPictureWithSrcset();
  console.log('PASS - footer logos: 160px/240px webp+png variants exist, correct height, transparent, combined 1x under 40KB, readers and partial both reference the responsive paths');
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
  });
}

module.exports = { run };
