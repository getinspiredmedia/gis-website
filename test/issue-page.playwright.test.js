'use strict';
/*
 * Playwright checks for the issue page (/magazine/<slug>) that a plain HTML
 * assertion can't cover: the Tile component's hover/focus colour change on
 * an artist row, that clicking a spread (an artist row or a "look inside"
 * item) actually opens the reader at that exact spread, the hero cover's
 * real (never cropped) rendered aspect ratio across breakpoints, and that
 * the home -> issue page -> reader -> back round trip raises no console
 * error (the cross-document View Transition opt-in bugfix).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const { ISSUES } = require('../build/data/issues');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.issue-page-playwright-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.issue-page-playwright-test-uploads');
const PORT = 3212;
const BASE = `http://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function cleanupFiles() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
}

function waitForServer(retries) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      fetch(BASE + '/').then(r => (r.ok ? resolve() : retry(n))).catch(() => retry(n));
    };
    const retry = (n) => {
      if (n <= 0) return reject(new Error('server did not come up'));
      setTimeout(() => attempt(n - 1), 300);
    };
    attempt(retries);
  });
}

async function checkTileHoverAndFocus(browserType) {
  const page = await browserType.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '/magazine/bloom', { waitUntil: 'load' });

  const firstRow = page.locator('.i-artist-row').first();
  const filterBefore = await firstRow.locator('.tile img').evaluate(el => getComputedStyle(el).filter);
  assert(/grayscale\(1\)/.test(filterBefore), `tile starts grayscale — got ${filterBefore}`);

  await firstRow.hover();
  await page.waitForTimeout(450); // CSS transition
  const filterHover = await firstRow.locator('.tile img').evaluate(el => getComputedStyle(el).filter);
  assert(!/grayscale\(1\)/.test(filterHover), `tile loses grayscale on hover — got ${filterHover}`);

  await page.mouse.move(0, 0); // leave, reset
  await page.waitForTimeout(450);
  const filterAfter = await firstRow.locator('.tile img').evaluate(el => getComputedStyle(el).filter);
  assert(/grayscale\(1\)/.test(filterAfter), `tile returns to grayscale after the pointer leaves — got ${filterAfter}`);

  await firstRow.focus();
  await page.waitForTimeout(450);
  const filterFocus = await firstRow.locator('.tile img').evaluate(el => getComputedStyle(el).filter);
  assert(!/grayscale\(1\)/.test(filterFocus), `tile loses grayscale on keyboard focus — got ${filterFocus}`);

  await page.close();
  console.log('PASS - tile hover/focus: grayscale on an artist row clears on hover and on focus, and returns once the pointer leaves');
}

async function checkSpreadClickOpensReader(browserType) {
  const page = await browserType.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '/magazine/bloom', { waitUntil: 'load' });

  const row = page.locator('.i-artist-row', { hasText: 'Kylli Sparre' });
  const href = await row.getAttribute('href');
  assert(href === '/magazine/bloom/read?spread=5', `Kylli Sparre's row links to spread 5 — got ${href}`);

  await row.click();
  await page.waitForURL('**/magazine/bloom/read/?spread=5', { timeout: 5000 });
  await page.waitForTimeout(200);
  const counter = await page.locator('#counter').textContent();
  assert(counter.trim() === 'Spread 05 / 17', `reader opens at spread 5 — counter reads "${counter.trim()}"`);

  await page.close();
  console.log('PASS - clicking an artist row opens the reader at that exact spread (Spread 05 / 17 for Kylli Sparre)');
}

async function checkLookInsideClickOpensReader(browserType) {
  const page = await browserType.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE + '/magazine/bloom', { waitUntil: 'load' });

  const item = page.locator('.i-look-item').nth(2); // Sara Fraysse, spread 8
  const href = await item.getAttribute('href');
  assert(href === '/magazine/bloom/read?spread=8', `third "look inside" item links to spread 8 — got ${href}`);

  await item.click();
  await page.waitForURL('**/magazine/bloom/read/?spread=8', { timeout: 5000 });
  await page.waitForTimeout(200);
  const counter = await page.locator('#counter').textContent();
  assert(counter.trim() === 'Spread 08 / 17', `reader opens at spread 8 — counter reads "${counter.trim()}"`);

  await page.close();
  console.log('PASS - clicking a "look inside" item opens the reader at that exact spread (Spread 08 / 17)');
}

// Criterion 1: the hero cover's rendered box ratio stays within 1% of the
// real source file's own ratio (from build/data/issues.js's heroCover
// width/height), at every required breakpoint, never cropped.
async function checkCoverRatioNeverCropped(browserType) {
  const SIZES = [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 },
  ];
  for (const issue of ISSUES) {
    const sourceRatio = issue.heroCover.width / issue.heroCover.height;
    for (const size of SIZES) {
      const page = await browserType.newPage({ viewport: size });
      await page.goto(`${BASE}/magazine/${issue.slug}`, { waitUntil: 'load' });
      const info = await page.evaluate(() => {
        const img = document.getElementById('issueCover');
        const r = img.getBoundingClientRect();
        return { w: r.width, h: r.height, objectFit: getComputedStyle(img).objectFit };
      });
      const boxRatio = info.w / info.h;
      const deviation = Math.abs(boxRatio - sourceRatio) / sourceRatio * 100;
      assert(deviation <= 1, `${issue.slug} at ${size.width}x${size.height}: hero cover box ratio (${boxRatio.toFixed(4)}) deviates ${deviation.toFixed(2)}% from the source ratio (${sourceRatio.toFixed(4)}), must be <=1%`);
      assert(info.objectFit !== 'cover', `${issue.slug} at ${size.width}x${size.height}: hero cover must not use object-fit:cover`);
      await page.close();
    }
  }
  console.log('PASS - hero cover box ratio stays within 1% of the real source ratio on every issue page, at 375x812/768x1024/1440x900/2560x1440, never object-fit:cover');
}

// Criterion 3: no console error or pageerror on the full home -> issue page
// -> reader -> back round trip, in Chromium (the ViewTransition opt-in bug).
async function checkNoConsoleErrorsRoundTrip(browserType) {
  const page = await browserType.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/502|Bad Gateway/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const bloomCard = page.locator('a.card[href="/magazine/bloom"]');
  await bloomCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await bloomCard.click();
  await page.waitForTimeout(1500);

  const readBtn = page.locator('a.btn', { hasText: 'Read the issue' });
  await readBtn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await readBtn.click();
  await page.waitForTimeout(1500);

  const magLink = page.locator('footer a[href="/magazine/bloom"]');
  await magLink.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await magLink.click();
  await page.waitForTimeout(1500);

  assert(page.url().includes('/magazine/bloom'), `round trip ends back on the issue page — got ${page.url()}`);
  assert(errors.length === 0, `no console errors on the round trip — got ${JSON.stringify(errors)}`);

  await page.close();
  console.log('PASS - home -> Bloom issue page -> reader -> back to the issue page: no console errors or pageerrors');
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT) },
      stdio: 'ignore',
    });
    await waitForServer(30);

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    try {
      await checkTileHoverAndFocus(browser);
      await checkSpreadClickOpensReader(browser);
      await checkLookInsideClickOpensReader(browser);
      await checkCoverRatioNeverCropped(browser);
      await checkNoConsoleErrorsRoundTrip(browser);
    } finally {
      await browser.close();
    }

    console.log('\nALL PASS');
  } finally {
    if (child) {
      child.kill();
      await new Promise(r => setTimeout(r, 300));
    }
    cleanupFiles();
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
  });
}

module.exports = { run };
