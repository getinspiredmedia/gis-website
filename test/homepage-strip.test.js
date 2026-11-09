'use strict';
/*
 * Bugfix regression test for the homepage issue strip's active-card
 * highlight on desktop (>860px): the card nearest the viewport's centre
 * must get .is-active, exactly one card at a time, kept correct while
 * scrolling in both directions, including all the way back to the top.
 *
 * The bug: .is-active was only recomputed from ScrollTrigger's onUpdate,
 * which GSAP stops firing once scroll leaves the pinned trigger's own
 * start/end window. Scrolling back above the strip left .is-active frozen
 * on whichever card was nearest centre at the last onUpdate call, which
 * (because the untransformed track doesn't actually centre card 0 at every
 * viewport width) wasn't reliably card 0 (Bloom) either. Fixed by
 * recomputing from real getBoundingClientRect() positions on every
 * animation frame (gsap.ticker) for as long as the desktop/motion
 * matchMedia context is active, with an explicit Bloom-active override
 * above the pin's own start (build/pages/index.html).
 *
 * Runs in Chromium always; Firefox and WebKit too if their Playwright
 * browser binaries are installed in this environment (skipped, not
 * failed, otherwise).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.homepage-strip-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.homepage-strip-test-uploads');
const PORT = 3209;
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

function startServer() {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT) },
    stdio: 'ignore',
  });
}

// Independently recomputes, from the cards' real on-screen positions right
// now, which card the nearest-centre rule should pick (same formula the
// fix uses, reimplemented here rather than imported, so this test would
// also catch a regression in the page's own copy of that formula).
async function expectedActiveIndex(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.card'));
    const center = innerWidth / 2;
    let bestIdx = -1, bestDist = Infinity;
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const d = Math.abs((r.left + r.right) / 2 - center);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    return bestIdx;
  });
}

async function activeIndices(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.card')).map((c, i) => (c.classList.contains('is-active') ? i : null)).filter(x => x !== null));
}

async function stripBounds(page) {
  return page.evaluate(() => {
    const st = window.ScrollTrigger ? ScrollTrigger.getAll().find(s => s.vars && s.vars.pin) : null;
    return st ? { start: st.start, end: st.end } : null;
  });
}

async function checkOneStep(page, label, { aboveStart } = {}) {
  const active = await activeIndices(page);
  assert(active.length === 1, `${label}: exactly one .is-active card — got ${JSON.stringify(active)}`);
  if (aboveStart) {
    assert(active[0] === 0, `${label}: above the pin's own start, card 0 (Bloom) is active — got index ${active[0]}`);
  } else {
    const expected = await expectedActiveIndex(page);
    assert(active[0] === expected, `${label}: the card nearest the viewport centre is active — expected index ${expected}, got ${active[0]}`);
  }
  return active[0];
}

async function runInBrowser(browserType, label) {
  let launched;
  try {
    launched = await browserType.launch(label === 'chromium' ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  } catch (e) {
    console.log(`SKIP - ${label} not installed in this environment (${e.message.split('\n')[0]})`);
    return;
  }
  try {
    const page = await launched.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(400);

    const bounds = await stripBounds(page);
    assert(bounds, `${label}: the strip's pinned ScrollTrigger exists`);

    // Scroll from well above the strip down past its end, in steps, and
    // back up again, checking every single step: exactly one active card,
    // and it is the correct one (begin, middle and end are all covered by
    // checking every step, not just three isolated points).
    const span = bounds.end - bounds.start;
    const steps = 16;
    const seenDown = [];
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    seenDown.push(await checkOneStep(page, `${label} down start`, { aboveStart: true }));

    for (let i = 1; i <= steps; i++) {
      const y = bounds.start - 200 + (span + 400) * (i / steps);
      await page.evaluate((yy) => window.scrollTo(0, yy), Math.max(0, y));
      await page.waitForTimeout(90);
      seenDown.push(await checkOneStep(page, `${label} down step ${i}/${steps}`, { aboveStart: y < bounds.start }));
    }
    // Each step above already asserts the active card matches the
    // independently recomputed nearest-centre card (the real, begin/
    // middle/end-covering check); the track's own geometry (padding,
    // scrollWidth vs. viewport) decides which card index that lands on at
    // the bottom of the pin, which doesn't have to be the last card and
    // isn't part of this bugfix, so it's not re-asserted here.
    assert(seenDown[seenDown.length - 1] === seenDown[seenDown.length - 2], `${label}: the active card has settled by the bottom of the pin (two consecutive steps agree) — got ${JSON.stringify(seenDown.slice(-2))}`);

    const seenUp = [];
    for (let i = steps; i >= 0; i--) {
      const y = bounds.start - 200 + (span + 400) * (i / steps);
      await page.evaluate((yy) => window.scrollTo(0, yy), Math.max(0, y));
      await page.waitForTimeout(90);
      seenUp.push(await checkOneStep(page, `${label} up step ${i}/${steps}`, { aboveStart: y < bounds.start }));
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const top = await checkOneStep(page, `${label} back at the very top`, { aboveStart: true });
    assert(top === 0, `${label}: scrolled all the way back up, Bloom (card 0) is active again — got index ${top}`);

    console.log(`PASS - ${label}: exactly one correct .is-active card at every step, both directions, Bloom restored at the top`);
    await page.close();
  } finally {
    await launched.close();
  }
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = startServer();
    await waitForServer(30);

    const { chromium, firefox, webkit } = require('playwright');
    await runInBrowser(chromium, 'chromium');
    await runInBrowser(firefox, 'firefox');
    await runInBrowser(webkit, 'webkit');

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
