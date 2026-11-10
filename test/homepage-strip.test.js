'use strict';
/*
 * Bugfix regression test for the homepage issue strip's active-card
 * highlight on desktop (>860px): the card nearest the viewport's centre
 * must get .is-active, exactly one card at a time, in both scroll
 * directions, across a range of real desktop sizes and zoom levels, plus
 * hover/focus.
 *
 * Two bugs, found in that order:
 *  1. .is-active was only recomputed inside the pinned ScrollTrigger's own
 *     onUpdate, which GSAP stops firing once scroll leaves that trigger's
 *     start/end window, so it froze on whichever card was nearest centre
 *     at the last onUpdate call when scrolling back above the strip.
 *  2. At wide viewports (reported: "02 No Algorithm lights up and stays
 *     put", reproduced here at 1920px and up) the track's travel distance
 *     (track.scrollWidth - innerWidth) undershoots badly, because .card
 *     has a fixed max-width that stops scaling with the viewport past
 *     ~533px while the track's side padding keeps growing: content barely
 *     overflows the viewport at 1920px and not at all at 2560px+. Worse,
 *     because that travel animated from x:0 (never a card's true
 *     exact-centre point at any tested viewport width) only leftward,
 *     card 0 and sometimes card 1 could never become nearest-centre at
 *     all, however the nearest-centre rule was implemented or recomputed.
 *     An earlier version of this test used the exact same nearest-centre
 *     formula, duplicated, as its "expected" value, so it could not have
 *     caught either bug (bug 2 isn't a flaw in that formula, bug 1 was,
 *     but a duplicated formula is still a dependent, not independent,
 *     check). This version computes the expected answer itself, in Node,
 *     from raw card rects fetched out of the page, sharing no code with
 *     build/pages/index.html at all.
 *
 * Fix: build/pages/index.html now animates the track from startX() (card
 * 0's own exact-centre translateX) to endX() (the last card's), both
 * measured live from offsetLeft/offsetWidth; every card's own exact-centre
 * point necessarily falls somewhere in that range, in order, since the
 * cards are evenly spaced, on any viewport width. The active-card
 * recompute itself only runs (gsap.ticker) while the pin is active
 * (onEnter/onEnterBack/onLeave/onLeaveBack), not for the whole page.
 * Hover/focus overrides the scroll-driven card immediately and hands back
 * control on mouseleave/blur (skipped entirely without a real hover
 * capability, i.e. touch).
 *
 * Runs in Chromium at every size in "SIZES" below, always; Firefox and
 * WebKit too if their Playwright browser binaries are installed in this
 * environment (skipped, not failed, otherwise).
 *
 * Also covers a separate bugfix: the strip's covers used to crop via
 * object-fit:cover inside a hardcoded aspect-ratio:3/4 box, cutting off
 * the logo/issue-number footer on every cover (whose real ratio is
 * 500/707, not 3/4). checkStripCoversNeverCropped asserts every card's box
 * ratio stays within 1% of 500/707, and that no cover <img> still has
 * object-fit:cover, at 375x812 and 1440x900 (Chromium only).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.homepage-strip-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.homepage-strip-test-uploads');
const PORT = 3209;
const BASE = `http://127.0.0.1:${PORT}`;

// width, height, deviceScaleFactor, CSS zoom (1 = none). Matches the sizes
// and zoom levels named in the task brief; André's own report was on an
// ordinary desktop display, which the 1920x1080 entries cover.
const SIZES = [
  { width: 1280, height: 720, dsf: 1 },
  { width: 1366, height: 768, dsf: 1 },
  { width: 1536, height: 864, dsf: 1 },
  { width: 1920, height: 1080, dsf: 1 },
  { width: 1920, height: 1080, dsf: 2 },
  { width: 1920, height: 1080, dsf: 1, zoom: 0.9 },
  { width: 1920, height: 1080, dsf: 1, zoom: 1.1 },
  { width: 2560, height: 1440, dsf: 1 },
  { width: 2560, height: 1440, dsf: 2 },
];

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

// Raw rects straight out of the DOM, no distance math done in the page at
// all; the "nearest centre" computation below happens entirely in Node.
async function cardRects(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    rects: Array.from(document.querySelectorAll('.card')).map(c => {
      const r = c.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }),
    activeIdx: Array.from(document.querySelectorAll('.card')).map((c, i) => (c.classList.contains('is-active') ? i : null)).filter(x => x !== null),
  }));
}

// The independent ground truth: which card's centre is nearest
// innerWidth/2, computed here in the test process from raw numbers, never
// by calling back into any page-side function.
function nearestCenterIndex(innerWidthPx, rects) {
  const center = innerWidthPx / 2;
  let bestIdx = -1, bestDist = Infinity;
  rects.forEach((r, i) => {
    const d = Math.abs((r.left + r.right) / 2 - center);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  });
  return bestIdx;
}

async function checkOneStep(page, label, { aboveStart, belowEnd } = {}) {
  const { innerWidth, rects, activeIdx } = await cardRects(page);
  assert(activeIdx.length === 1, `${label}: exactly one .is-active card — got ${JSON.stringify(activeIdx)}`);
  if (aboveStart) {
    assert(activeIdx[0] === 0, `${label}: above the pin's own start, card 0 (Bloom) is active — got index ${activeIdx[0]}`);
  } else if (belowEnd) {
    assert(activeIdx[0] === rects.length - 1, `${label}: below the pin's own end, the last card is active — got index ${activeIdx[0]}`);
  } else {
    const expected = nearestCenterIndex(innerWidth, rects);
    assert(activeIdx[0] === expected, `${label}: the card nearest the viewport centre (computed independently in Node from raw rects) is active — expected index ${expected}, got ${activeIdx[0]}`);
  }
  return activeIdx[0];
}

async function stripBounds(page) {
  return page.evaluate(() => {
    const st = window.ScrollTrigger ? ScrollTrigger.getAll().find(s => s.vars && s.vars.pin) : null;
    return st ? { start: st.start, end: st.end } : null;
  });
}

async function checkSize(browserType, label, size) {
  const page = await browserType.newPage({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.dsf || 1,
  });
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    if (/502|Bad Gateway/.test(msg.text())) return; // unrelated sandbox network noise, not from this app
    consoleErrors.push('console.error: ' + msg.text());
  });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  if (size.zoom) await page.evaluate((z) => { document.documentElement.style.zoom = z; }, size.zoom);
  await page.waitForTimeout(400);

  const bounds = await stripBounds(page);
  assert(bounds, `${label}: the strip's pinned ScrollTrigger exists`);
  const span = bounds.end - bounds.start;

  // Down through the whole pin, fine-grained (a card's own "nearest"
  // window can be narrow at some sizes), then back up. The acceptance
  // criterion is a clean, strictly ordered 0,1,2,3,4 then 4,3,2,1,0, not
  // just "every step individually correct" (which a step that revisits an
  // earlier index could also satisfy) — both are checked.
  const steps = 60;
  const seenDown = [];
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(120);
  const topStart = await checkOneStep(page, `${label} down start (above pin)`, { aboveStart: true });
  seenDown.push(topStart);

  for (let i = 1; i <= steps; i++) {
    const y = bounds.start + span * (i / steps);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(40);
    const idx = await checkOneStep(page, `${label} down ${i}/${steps}`, {});
    if (seenDown[seenDown.length - 1] !== idx) seenDown.push(idx);
  }
  await page.evaluate((yy) => window.scrollTo(0, yy), bounds.end + 300);
  await page.waitForTimeout(120);
  const bottomIdx = await checkOneStep(page, `${label} past the end (below pin)`, { belowEnd: true });
  if (seenDown[seenDown.length - 1] !== bottomIdx) seenDown.push(bottomIdx);

  const expectedCardCount = (await page.evaluate(() => document.querySelectorAll('.card').length));
  const expectedDown = Array.from({ length: expectedCardCount }, (_, i) => i);
  assert(JSON.stringify(seenDown) === JSON.stringify(expectedDown), `${label}: scrolling down visits ${JSON.stringify(expectedDown)} in order with nothing skipped or repeated — got ${JSON.stringify(seenDown)}`);

  const seenUp = [];
  for (let i = steps; i >= 0; i--) {
    const y = bounds.start + span * (i / steps);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(40);
    const idx = await checkOneStep(page, `${label} up ${i}/${steps}`, {});
    if (seenUp[seenUp.length - 1] !== idx) seenUp.push(idx);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const topEnd = await checkOneStep(page, `${label} back at the very top`, { aboveStart: true });
  if (seenUp[seenUp.length - 1] !== topEnd) seenUp.push(topEnd);

  const expectedUp = expectedDown.slice().reverse();
  assert(JSON.stringify(seenUp) === JSON.stringify(expectedUp), `${label}: scrolling back up visits ${JSON.stringify(expectedUp)} in order, ending on Bloom — got ${JSON.stringify(seenUp)}`);

  // Hover and focus: scroll to roughly the middle of the pin first so the
  // scroll-driven state isn't already card 0, then confirm hover/focus on
  // a different card overrides it, and mouseleave/blur hands control back
  // to whatever the scroll position says right now (not a stale value).
  await page.evaluate((y) => window.scrollTo(0, y), bounds.start + span * 0.5);
  await page.waitForTimeout(150);
  const scrollDriven = (await cardRects(page)).activeIdx[0];
  const hoverTargetIdx = scrollDriven === 0 ? 1 : 0;
  const cardHandles = await page.$$('.card');
  await cardHandles[hoverTargetIdx].hover();
  await page.waitForTimeout(120);
  let hoverActive = (await cardRects(page)).activeIdx;
  assert(JSON.stringify(hoverActive) === JSON.stringify([hoverTargetIdx]), `${label}: hovering card ${hoverTargetIdx} lights it up immediately — got ${JSON.stringify(hoverActive)}`);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  let afterLeave = (await cardRects(page)).activeIdx;
  assert(JSON.stringify(afterLeave) === JSON.stringify([scrollDriven]), `${label}: mouseleave hands control back to the scroll position (expected ${scrollDriven}) — got ${JSON.stringify(afterLeave)}`);

  const focusTargetIdx = scrollDriven === cardHandles.length - 1 ? cardHandles.length - 2 : cardHandles.length - 1;
  await cardHandles[focusTargetIdx].focus();
  await page.waitForTimeout(120);
  let focusActive = (await cardRects(page)).activeIdx;
  assert(JSON.stringify(focusActive) === JSON.stringify([focusTargetIdx]), `${label}: focusing card ${focusTargetIdx} lights it up immediately — got ${JSON.stringify(focusActive)}`);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(120);
  let afterBlur = (await cardRects(page)).activeIdx;
  assert(JSON.stringify(afterBlur) === JSON.stringify([scrollDriven]), `${label}: blur hands control back to the scroll position (expected ${scrollDriven}) — got ${JSON.stringify(afterBlur)}`);

  assert(consoleErrors.length === 0, `${label}: no console errors — got ${JSON.stringify(consoleErrors)}`);

  await page.close();
  console.log(`PASS - ${label}: 0..${expectedCardCount - 1} in order both directions, hover/focus override and release correctly, no console errors`);
}

// Each strip cover's real file ratio is 500/707 (every <img> here carries
// width="500" height="707"); the box must take that same ratio (no
// object-fit:cover left to crop it), within 1%, at the two sizes named in
// the task brief. The empty issue-05 card shares .card's own aspect-ratio
// (no image of its own), so it's checked the same way via its box rect.
async function checkStripCoversNeverCropped(browserType) {
  const REAL_RATIO = 500 / 707;
  const SIZES = [{ width: 375, height: 812 }, { width: 1440, height: 900 }];
  for (const size of SIZES) {
    const page = await browserType.newPage({ viewport: size });
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => Array.from(document.querySelectorAll('.card')).map(c => {
      const r = c.getBoundingClientRect();
      const img = c.querySelector('img');
      return { w: r.width, h: r.height, objectFit: img ? getComputedStyle(img).objectFit : null, isEmpty: c.classList.contains('is-empty') };
    }));
    info.forEach((card, i) => {
      const boxRatio = card.w / card.h;
      const deviation = Math.abs(boxRatio - REAL_RATIO) / REAL_RATIO * 100;
      assert(deviation <= 1, `${size.width}x${size.height} card ${i}: box ratio (${boxRatio.toFixed(4)}) deviates ${deviation.toFixed(2)}% from the real cover ratio (${REAL_RATIO.toFixed(4)}), must be <=1%`);
      if (!card.isEmpty) assert(card.objectFit !== 'cover', `${size.width}x${size.height} card ${i}: cover <img> must not use object-fit:cover`);
    });
    await page.close();
  }
  console.log('PASS - every strip card (including the empty issue-05 card) takes the real 500/707 cover ratio within 1%, at 375x812 and 1440x900, no object-fit:cover left on a cover <img>');
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
    for (const size of SIZES) {
      const sizeLabel = `${label} ${size.width}x${size.height} dsf${size.dsf || 1}${size.zoom ? ' zoom' + Math.round(size.zoom * 100) + '%' : ''}`;
      await checkSize(launched, sizeLabel, size);
    }
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

    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    try {
      await checkStripCoversNeverCropped(browser);
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
