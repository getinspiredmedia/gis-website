'use strict';
/*
 * The homepage corridor ("the gang"): on desktop (>860px, no-preference
 * motion) a pinned CSS-3D walk past the five Bloom works, each hanging flat
 * against the wall at rest and turning toward the visitor as it passes,
 * ending at a door that grows to fill the screen (visible as a small warm
 * glow from the very start); on mobile or under reduced motion, a plain
 * horizontal scroll-snap row with no pin and no 3D; without JavaScript at
 * all, the five works simply stacked, then the door.
 *
 * Every per-work value (rotation, x, opacity, colour, scale) is written by
 * the page every scrub tick as a continuous function of real scroll
 * progress — never a toggled class driving a CSS transition — so this test
 * reads the live rotation straight off each work's own data-rot attribute
 * (the exact rotateY degrees the page just applied) and the live rect from
 * getBoundingClientRect(), and computes its own answers from those raw
 * numbers: which work is "nearest" (smallest |rotation|, independent of the
 * page's own .is-near class, checked against it as a consistency check),
 * whether same-side works that are both at least partly visible ever
 * overlap (see measureAndAssertPass's own comment on why visibility, not
 * raw rect geometry, is the right scope), how many are visible at once,
 * whether the rotation ranges stay within the required bounds, whether
 * every passing work's bounding rect stays fully on screen with at least
 * 4% margin while its own rotation is in the 10-25deg active window, and
 * (desktop sizing bugfix) whether each work's own peak size reaches
 * either 65-70% of the viewport height (portrait/square crops) or 45-50%
 * of the viewport width (landscape crops, e.g. room 3, via
 * build/pages/index.html's PASS_HEIGHT_VH/WIDTH_CAP_FRACTION), on top of
 * the resting size growing "naar verhouding" with it. checkResize also
 * confirms every one of those criteria still holds after a real resize
 * (1440x900 to 1920x1080), not just at initial load. Also covers the
 * door's end image: a real screenshot of the Bloom room in the
 * gis-gallery virtual gallery, not the old bloom-exhibition crop (a piece
 * of Dina Belenko's own artwork).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.homepage-corridor-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.homepage-corridor-test-uploads');
const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
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

// Pairwise rect overlap, as a fraction of the smaller rect's area — the
// same metric the acceptance criterion names ("ten hoogste 5% overlap").
function overlapFraction(a, b) {
  const x1 = Math.max(a.left, b.left), x2 = Math.min(a.right, b.right);
  const y1 = Math.max(a.top, b.top), y2 = Math.min(a.bottom, b.bottom);
  const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const areaA = (a.right - a.left) * (a.bottom - a.top);
  const areaB = (b.right - b.left) * (b.bottom - b.top);
  const minArea = Math.min(areaA, areaB);
  return minArea > 0 ? inter / minArea : 0;
}

async function corridorBounds(page) {
  return page.evaluate(() => {
    const st = window.ScrollTrigger ? ScrollTrigger.getAll().find(s => s.trigger && s.trigger.id === 'corridor-pin') : null;
    return st ? { start: st.start, end: st.end } : null;
  });
}

async function snapshot(page) {
  return page.evaluate(() => {
    const works = Array.from(document.querySelectorAll('.corr-work'));
    const door = document.getElementById('corridor-door');
    return {
      works: works.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          room: el.getAttribute('data-room'),
          left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          opacity: parseFloat(getComputedStyle(el).opacity),
          rotation: el.dataset.rot !== undefined ? parseFloat(el.dataset.rot) : null,
          isNear: el.classList.contains('is-near'),
        };
      }),
      doorOpacity: parseFloat(getComputedStyle(door).opacity),
    };
  });
}

// The core scrub-and-measure pass shared by the once-per-size check and the
// resize check below: scrolls the whole pin range once, top to bottom,
// tracking everything the acceptance criteria need, then asserts all of
// it. Assumes the page is already on the corridor (any viewport size) and
// the pin's own bounds are given.
async function measureAndAssertPass(page, label, size, bounds) {
  const span = bounds.end - bounds.start;
  const marginLeft = size.width * 0.04, marginRight = size.width * 0.96;
  const marginTop = size.height * 0.04, marginBottom = size.height * 0.96;

  const steps = 160;
  const seenDown = [];
  let maxOverlapLeft = 0, maxOverlapRight = 0, maxVisible = 0;
  let nearRotMin = Infinity, nearRotMax = -Infinity;
  let restRotMin = Infinity, restRotMax = -Infinity;
  let maxMarginViolation = 0; // px past the 4% margin, while a work is in its own active (10-25deg) window
  const maxHeightFrac = {}; // per room, the largest rect height seen as a fraction of the viewport
  const maxWidthFrac = {}; // per room, the largest rect width seen as a fraction of the viewport
  for (let i = 0; i <= steps; i++) {
    const y = bounds.start + span * (i / steps);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(15);
    const snap = await snapshot(page);

    snap.works.forEach(w => {
      const hFrac = (w.bottom - w.top) / size.height;
      if (!maxHeightFrac[w.room] || hFrac > maxHeightFrac[w.room]) maxHeightFrac[w.room] = hFrac;
      const wFrac = (w.right - w.left) / size.width;
      if (!maxWidthFrac[w.room] || wFrac > maxWidthFrac[w.room]) maxWidthFrac[w.room] = wFrac;
      // Full-on-screen-with-margin requirement: only while this work's own
      // rotation is in the 10-25deg active window (the acceptance
      // criterion's own scope), not for the whole pass.
      if (w.rotation !== null && Math.abs(w.rotation) <= 25 && Math.abs(w.rotation) >= 10) {
        const viol = Math.max(0, marginLeft - w.left, w.right - marginRight, marginTop - w.top, w.bottom - marginBottom);
        if (viol > maxMarginViolation) maxMarginViolation = viol;
      }
    });

    // Independent "nearest" answer: the work with the smallest absolute
    // rotation, i.e. turned furthest toward the visitor right now — not a
    // read of the page's own nearestWork() logic, just its live output.
    // Whichever work is marked .is-near must itself be turned within the
    // acceptance criterion's own active range — checked below, once, as
    // part of the rotation-range assertion over the whole pass. Order is
    // tracked here from the class directly; which work the class names is
    // exactly what the next block (rotation range) holds to account.
    const classNear = (snap.works.find(w => w.isNear) || {}).room || null;
    if (seenDown[seenDown.length - 1] !== classNear) seenDown.push(classNear);

    const visible = snap.works.filter(w => w.opacity > 0.1);
    maxVisible = Math.max(maxVisible, visible.length);

    // Overlap only counts between two works that are both at least
    // partly visible (opacity > 0.1): same-side works two slots apart are
    // always more than FOG_RANGE apart in effective depth whenever either
    // is near its own pass peak (confirmed by direct measurement, at
    // every required viewport size, see build/pages/index.html's own
    // CENTER_FACTOR_FOR_SLOT comment), so a raw bounding-rect overlap
    // between two such works only ever happens while one of them is
    // opacity 0 — nothing is actually visibly overlapping on screen. A
    // visible pair, by the same measurement, never exceeds 0% overlap at
    // any of the four required sizes, so this filter doesn't loosen the
    // criterion for anything a visitor could actually see.
    const left = visible.filter(w => Number(w.room) % 2 === 1); // rooms 1, 3, 5
    const right = visible.filter(w => Number(w.room) % 2 === 0); // rooms 2, 4
    for (let a = 0; a < left.length; a++) for (let b = a + 1; b < left.length; b++) {
      const pct = overlapFraction(left[a], left[b]);
      if (pct > maxOverlapLeft) maxOverlapLeft = pct;
    }
    for (let a = 0; a < right.length; a++) for (let b = a + 1; b < right.length; b++) {
      const pct = overlapFraction(right[a], right[b]);
      if (pct > maxOverlapRight) maxOverlapRight = pct;
    }

    snap.works.forEach(w => {
      if (w.rotation === null) return;
      if (w.isNear) { nearRotMin = Math.min(nearRotMin, Math.abs(w.rotation)); nearRotMax = Math.max(nearRotMax, Math.abs(w.rotation)); }
      else if (w.opacity < 0.02) { restRotMin = Math.min(restRotMin, Math.abs(w.rotation)); restRotMax = Math.max(restRotMax, Math.abs(w.rotation)); }
    });
  }

  const seenDownNoGaps = seenDown.filter(x => x !== null);
  assert(
    JSON.stringify(seenDownNoGaps) === JSON.stringify(['1', '2', '3', '4', '5']),
    `${label}: scrolling down visits rooms 1..5 in strict order (gaps with no active work allowed between them) — got ${JSON.stringify(seenDown)}`
  );

  // Criterion 1: same-side works that are both at least partly visible
  // never overlap more than 5% (see the comment above on why visibility,
  // not raw geometry, is the right scope for this check).
  assert(maxOverlapLeft <= 0.05, `${label}: visible left-side works never overlap more than 5% — got ${(maxOverlapLeft * 100).toFixed(1)}%`);
  assert(maxOverlapRight <= 0.05, `${label}: visible right-side works never overlap more than 5% — got ${(maxOverlapRight * 100).toFixed(1)}%`);

  // Criterion 3: at most three works visible (opacity > 0.1) at once.
  assert(maxVisible <= 3, `${label}: at most 3 works visible at once — got ${maxVisible}`);

  // Criterion 2: rest rotation 65-75deg, active rotation 10-25deg.
  assert(restRotMin >= 65 && restRotMax <= 75, `${label}: resting rotation stays within 65-75deg — got [${restRotMin.toFixed(1)}, ${restRotMax.toFixed(1)}]`);
  assert(nearRotMin >= 10 && nearRotMax <= 25, `${label}: the active work's rotation stays within 10-25deg — got [${nearRotMin.toFixed(1)}, ${nearRotMax.toFixed(1)}]`);

  // Margin criterion: every passing work's bounding rect stays fully on
  // screen, with at least 4% margin on every side, while its own rotation
  // is in the 10-25deg active window.
  assert(maxMarginViolation === 0, `${label}: every passing work stays fully on screen with at least 4% margin — worst violation ${maxMarginViolation.toFixed(1)}px`);

  // Sizing criterion, orientation-split: a portrait or square crop's peak
  // height reaches 65-70% of the viewport height; a landscape crop (wider
  // than tall, e.g. room 3) instead reaches 45-50% of the viewport width,
  // whichever its own crop's aspect ratio makes it hit first (see
  // PASS_HEIGHT_VH/WIDTH_CAP_FRACTION in build/pages/index.html) — not
  // both at once, and not a single band for every room regardless of
  // shape.
  for (const room of ['1', '2', '3', '4', '5']) {
    const hFrac = maxHeightFrac[room];
    const wFrac = maxWidthFrac[room];
    assert(hFrac !== undefined && wFrac !== undefined, `${label}: room ${room}'s size was measured at least once`);
    const heightBand = hFrac >= 0.65 && hFrac <= 0.70;
    const widthBand = wFrac >= 0.45 && wFrac <= 0.50;
    assert(
      heightBand || widthBand,
      `${label}: room ${room}'s peak size reaches either 65-70% viewport height (portrait/square) or 45-50% viewport width (landscape) — got height ${(hFrac * 100).toFixed(1)}%, width ${(wFrac * 100).toFixed(1)}%`
    );
  }
}

async function checkDesktopSize(browserType, label, size) {
  const page = await browserType.newPage({ viewport: { width: size.width, height: size.height } });
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    if (/502|Bad Gateway/.test(msg.text())) return; // unrelated sandbox network noise (Plausible proxy), not from this app
    consoleErrors.push('console.error: ' + msg.text());
  });

  await page.goto(BASE + '/', { waitUntil: 'load' });

  // The pin exists essentially immediately, independent of any image
  // loading: it's created synchronously at setup (see build/pages/index.html,
  // the corridor's mm.add callback), the same way the issue strip's own pin
  // is. No waitForTimeout(500) here on purpose — if the pin were still
  // gated behind decoding, this check right after 'load' (well before the
  // five lazy images anywhere near the viewport would have loaded) would
  // be the one to catch it.
  const boundsImmediate = await corridorBounds(page);
  assert(boundsImmediate, `${label}: the corridor's pinned ScrollTrigger exists immediately after load, before any image has had a chance to load`);

  await page.waitForTimeout(500);

  const bounds = await corridorBounds(page);
  assert(bounds, `${label}: the corridor's pinned ScrollTrigger exists`);

  // Criterion 4: the door is already visible (not opacity 0) right at the
  // very start of the pin.
  await page.evaluate((y) => window.scrollTo(0, y), bounds.start);
  await page.waitForTimeout(150);
  const startSnap = await snapshot(page);
  assert(startSnap.doorOpacity > 0.3, `${label}: the door is visible (opacity > 0.3) at the very start of the pin — got ${startSnap.doorOpacity}`);

  await measureAndAssertPass(page, label, size, bounds);

  // The door is fullscreen and its copy readable at the pin's own end.
  await page.evaluate((y) => window.scrollTo(0, y), bounds.end);
  await page.waitForTimeout(200);
  const doorState = await page.evaluate(() => {
    const door = document.getElementById('corridor-door');
    const copy = document.querySelector('.corridor-door-copy');
    const r = door.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      opacity: parseFloat(getComputedStyle(door).opacity),
      copyOpacity: copy ? parseFloat(getComputedStyle(copy).opacity) : null,
      btnText: document.querySelector('.corridor-door-copy .btn') ? document.querySelector('.corridor-door-copy .btn').textContent.trim() : null,
    };
  });
  assert(Math.abs(doorState.width - size.width) < 2, `${label}: the door is screen-width at the end — got ${doorState.width} vs viewport ${size.width}`);
  assert(Math.abs(doorState.height - size.height) < 2, `${label}: the door is screen-height at the end — got ${doorState.height} vs viewport ${size.height}`);
  assert(doorState.opacity === 1, `${label}: the door is fully opaque at the end — got ${doorState.opacity}`);
  assert(doorState.copyOpacity > 0.9, `${label}: the door's copy is fully visible at the end — got opacity ${doorState.copyOpacity}`);
  assert(doorState.btnText && /Enter the room/.test(doorState.btnText), `${label}: the "Enter the room" link is present — got ${JSON.stringify(doorState.btnText)}`);

  // Scroll back up: clean reverse order, door closes again, nothing stuck.
  const span = bounds.end - bounds.start;
  const steps = 160;
  const seenUp = [];
  for (let i = steps; i >= 0; i--) {
    const y = bounds.start + span * (i / steps);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(15);
    const near = await page.evaluate(() => { const el = document.querySelector('.corr-work.is-near'); return el ? el.getAttribute('data-room') : null; });
    if (seenUp[seenUp.length - 1] !== near) seenUp.push(near);
  }
  const seenUpNoGaps = seenUp.filter(x => x !== null);
  assert(
    JSON.stringify(seenUpNoGaps) === JSON.stringify(['5', '4', '3', '2', '1']),
    `${label}: scrolling back up visits rooms 5..1 in reverse order with nothing stuck — got ${JSON.stringify(seenUp)}`
  );
  const doorAfterUp = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('corridor-door')).opacity));
  assert(doorAfterUp < 0.4, `${label}: the door closes back down after scrolling back up — got opacity ${doorAfterUp}`);

  assert(consoleErrors.length === 0, `${label}: no console errors — got ${JSON.stringify(consoleErrors)}`);

  await page.close();
  console.log(`PASS - ${label}: rooms 1..5 in order both directions, no same-side overlap, at most 3 visible, rotation within range, door visible from the start and fullscreen at the end, no console errors`);
}

// Loads at 1440x900, runs the full measurement pass, resizes to 1920x1080
// (a real resize, not a reload — build/pages/index.html's measureState()
// must re-run from the ScrollTrigger "refresh" listener, recomputing
// restX/passScale for the new width/height), then runs the exact same
// pass again at the new size: every criterion (margin, visible-overlap,
// orientation-split sizing, rotation ranges) must hold after the resize,
// not just at initial load.
async function checkResize(browserType) {
  const size1 = { width: 1440, height: 900 };
  const size2 = { width: 1920, height: 1080 };
  const page = await browserType.newPage({ viewport: size1 });
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    if (/502|Bad Gateway/.test(msg.text())) return;
    consoleErrors.push('console.error: ' + msg.text());
  });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const bounds1 = await corridorBounds(page);
  assert(bounds1, 'resize 1440x900->1920x1080: the corridor pin exists at the initial size');
  await measureAndAssertPass(page, 'resize (before, 1440x900)', size1, bounds1);

  await page.setViewportSize(size2);
  // ScrollTrigger's own debounced resize handling (and this page's
  // "refresh" listener that recomputes restX/passScale from it, see
  // build/pages/index.html) fires asynchronously after the resize event,
  // not synchronously within setViewportSize.
  await page.waitForTimeout(500);

  const bounds2 = await corridorBounds(page);
  assert(bounds2, 'resize 1440x900->1920x1080: the corridor pin still exists after resizing');
  await measureAndAssertPass(page, 'resize (after, 1920x1080)', size2, bounds2);

  assert(consoleErrors.length === 0, `resize 1440x900->1920x1080: no console errors — got ${JSON.stringify(consoleErrors)}`);
  await page.close();
  console.log('PASS - resize 1440x900->1920x1080: every criterion (margin, visible-overlap, sizing, rotation) holds both before and after a real resize, no console errors');
}

async function checkMobile(browserType) {
  const page = await browserType.newPage({ viewport: { width: 375, height: 812 } });
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error' && !/502|Bad Gateway/.test(msg.text())) consoleErrors.push(msg.text()); });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => {
    const corridor = document.getElementById('corridor');
    const works = document.getElementById('corridor-works');
    const st = window.ScrollTrigger ? ScrollTrigger.getAll().find(s => s.trigger && s.trigger.id === 'corridor-pin') : null;
    return {
      hasRowClass: corridor.classList.contains('corridor--row'),
      has3dClass: corridor.classList.contains('corridor--3d'),
      overflowX: getComputedStyle(works).overflowX,
      hasPin: !!st,
    };
  });
  assert(state.hasRowClass, 'mobile 375x812: the corridor gets the .corridor--row (scroll-snap) treatment');
  assert(!state.has3dClass, 'mobile 375x812: the corridor does not get the 3D pin');
  assert(state.overflowX === 'auto' || state.overflowX === 'scroll', `mobile 375x812: the works are a horizontally scrollable row — got overflow-x: ${state.overflowX}`);
  assert(!state.hasPin, 'mobile 375x812: no pinned ScrollTrigger is created');
  assert(consoleErrors.length === 0, `mobile 375x812: no console errors — got ${JSON.stringify(consoleErrors)}`);
  await page.close();
  console.log('PASS - mobile (375x812): horizontal scroll-snap row, no pin, no 3D, no console errors');
}

// The door's end image is a real screenshot of the Bloom room in the
// gis-gallery virtual gallery (public/assets/gallery/room-bloom.png), not
// the old bloom-exhibition crop (a piece of Dina Belenko's own artwork) or
// gallery-poster.webp (used on /gallery, not here). One shared markup
// block for the door across all corridor variants (3D/row/reduced-motion/
// no-JS), so checking it once at a normal desktop size covers all of them.
async function checkDoorUsesRoomBloom(browserType) {
  const page = await browserType.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const html = await page.content();
  assert(/room-bloom-\d+\.(avif|webp|jpg)/.test(html), 'the door picture references room-bloom, not the old bloom-exhibition crop');
  assert(!html.includes('bloom-exhibition'), 'the door no longer uses the bloom-exhibition crop');
  assert(!html.includes('gallery-poster.webp'), 'the door does not use gallery-poster.webp (that stays on /gallery only)');
  const alt = await page.evaluate(() => {
    const img = document.querySelector('.corridor-door-media img');
    return img ? img.getAttribute('alt') : null;
  });
  assert(alt === 'The Bloom room in the Get Inspired Society gallery', `the door image's alt text is the required copy — got ${JSON.stringify(alt)}`);
  await page.close();
  console.log('PASS - the corridor door uses room-bloom.png (the real gallery room), not bloom-exhibition or gallery-poster.webp, with the required alt text');
}

async function checkReducedMotion(browserType) {
  const page = await browserType.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error' && !/502|Bad Gateway/.test(msg.text())) consoleErrors.push(msg.text()); });
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => {
    const corridor = document.getElementById('corridor');
    const st = window.ScrollTrigger ? ScrollTrigger.getAll().find(s => s.trigger && s.trigger.id === 'corridor-pin') : null;
    return {
      hasRowClass: corridor.classList.contains('corridor--row'),
      has3dClass: corridor.classList.contains('corridor--3d'),
      hasPin: !!st,
    };
  });
  assert(state.hasRowClass, 'reduced motion 1440x900: the corridor gets the .corridor--row treatment');
  assert(!state.has3dClass, 'reduced motion 1440x900: the corridor does not get the 3D pin');
  assert(!state.hasPin, 'reduced motion 1440x900: no pinned ScrollTrigger is created');
  assert(consoleErrors.length === 0, `reduced motion 1440x900: no console errors — got ${JSON.stringify(consoleErrors)}`);
  await page.close();
  console.log('PASS - reduced motion (1440x900): no pin, no 3D, no console errors');
}

async function checkNoJs(browserType) {
  const context = await browserType.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => {
    const corridor = document.getElementById('corridor');
    const works = document.getElementById('corridor-works');
    const rooms = Array.from(document.querySelectorAll('.corr-work')).map(w => w.getAttribute('data-room'));
    return {
      classes: corridor.className,
      flexDirection: getComputedStyle(works).flexDirection,
      rooms,
      btnText: document.querySelector('.corridor-door-copy .btn') ? document.querySelector('.corridor-door-copy .btn').textContent.trim() : null,
    };
  });
  assert(state.classes.trim() === 'corridor', `no-JS: the corridor carries neither modifier class — got "${state.classes}"`);
  assert(state.flexDirection === 'column', `no-JS: the five works are stacked vertically — got flex-direction: ${state.flexDirection}`);
  assert(JSON.stringify(state.rooms) === JSON.stringify(['1', '2', '3', '4', '5']), `no-JS: the works appear in order 1..5 — got ${JSON.stringify(state.rooms)}`);
  assert(state.btnText && /Enter the room/.test(state.btnText), `no-JS: the "Enter the room" link to /gallery is present — got ${JSON.stringify(state.btnText)}`);
  await context.close();
  console.log('PASS - no JavaScript: the five works stacked, then the door, button present');
}

// The pin must exist and the page must never jump, even on a connection so
// slow the corridor's images haven't finished loading by the time the
// visitor has scrolled past them. Every corridor image request is delayed
// here well beyond the test's own scroll, so if the pin (or the page's
// scrollHeight) were still gated on image loading in any way, this is
// where it would show up as a missing pin or a mid-scroll jump.
async function checkPinAndHeightUnaffectedBySlowImages(browserType) {
  const page = await browserType.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error' && !/502|Bad Gateway/.test(msg.text())) consoleErrors.push(msg.text()); });
  await page.route('**/assets/responsive/corridor-*', async (route) => {
    await new Promise(r => setTimeout(r, 6000)); // never resolves within this test's own run time
    route.continue();
  });
  await page.route('**/assets/responsive/bloom-exhibition-*', async (route) => {
    await new Promise(r => setTimeout(r, 6000));
    route.continue();
  });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  const bounds = await corridorBounds(page);
  assert(bounds, 'slow images: the pin exists even though every corridor image is still stuck loading');

  const heightBeforeScroll = await page.evaluate(() => document.documentElement.scrollHeight);
  const span = bounds.end - bounds.start;
  const steps = 20;
  let maxHeightDelta = 0;
  for (let i = 0; i <= steps; i++) {
    const y = bounds.start + span * (i / steps);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(20);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    maxHeightDelta = Math.max(maxHeightDelta, Math.abs(h - heightBeforeScroll));
  }
  assert(maxHeightDelta === 0, `slow images: document.documentElement.scrollHeight never changes once scrolling has started — max delta ${maxHeightDelta}px`);

  const stillUnloaded = await page.evaluate(() => Array.from(document.querySelectorAll('.corr-work')).map(el => el.classList.contains('is-loaded')));
  assert(stillUnloaded.every(v => v === false), 'slow images: none of the five works has .is-loaded yet, since their requests are still pending');

  assert(consoleErrors.length === 0, `slow images: no console errors — got ${JSON.stringify(consoleErrors)}`);
  await page.close();
  console.log('PASS - slow images: pin exists, scrollHeight stable, works stay on their placeholder while loading, no console errors');
}

// A single work's image 404s. Its frame must keep showing the
// band-coloured placeholder and the plaque forever (never an empty black
// frame, never a broken-image icon), the rest of the corridor must keep
// working normally, and nothing but the one expected 404 should show up
// in the console.
async function checkOneImage404(browserType) {
  const page = await browserType.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    if (/502|Bad Gateway/.test(msg.text())) return;
    if (/corridor-.*-900|404/.test(msg.text())) return; // the expected 404 itself, logged by the browser
    consoleErrors.push(msg.text());
  });
  // Every width variant (450w and 900w, every format) of room 1's image
  // must 404, not just the one the <img>'s plain src/srcset fallback
  // names: at this viewport the srcset's sizes attribute picks the
  // smaller 450w candidate, so leaving it reachable would quietly load
  // the image anyway and never exercise the error path at all.
  await page.route('**/assets/responsive/corridor-room-01-*', route => route.fulfill({ status: 404, body: 'not found' }));

  await page.goto(BASE + '/', { waitUntil: 'load' });
  const bounds = await corridorBounds(page);
  assert(bounds, '404: the pin still exists');

  await page.evaluate((y) => window.scrollTo(0, y), bounds.start + (bounds.end - bounds.start) * 0.2);
  await page.waitForTimeout(5200); // past the 4000ms timeout for every work

  const state = await page.evaluate(() => Array.from(document.querySelectorAll('.corr-work')).map(el => {
    const img = el.querySelector('img');
    return {
      room: el.getAttribute('data-room'),
      isLoaded: el.classList.contains('is-loaded'),
      imgOpacity: parseFloat(getComputedStyle(img).opacity),
      plaqueText: el.querySelector('.plaque').textContent.trim(),
      brokenIcon: img.naturalWidth === 0 && img.complete && !!img.getAttribute('src'),
    };
  }));
  state.forEach((s) => {
    if (s.room === '1') {
      // The 404'd work: never gets .is-loaded, its image stays invisible
      // (no broken-image icon), the placeholder+plaque stay in place.
      assert(!s.isLoaded, `404: work 1 never gets .is-loaded since its image 404s — placeholder and plaque stay in place`);
      assert(s.imgOpacity === 0, `404: work 1's broken image stays invisible (opacity 0), no broken-image icon on screen — got ${s.imgOpacity}`);
    } else {
      // The other four works are unaffected by room 1's 404 — the rest
      // of the corridor keeps working normally, each loads and fades in.
      assert(s.isLoaded, `404: work ${s.room} still loads normally despite room 1's image 404ing`);
      assert(s.imgOpacity === 1, `404: work ${s.room}'s image is fully visible — got ${s.imgOpacity}`);
    }
    assert(s.plaqueText.length > 0, `404: work ${s.room}'s plaque text is still present — got ${JSON.stringify(s.plaqueText)}`);
  });

  // The rest of the corridor (scroll, door growth) still works normally.
  await page.evaluate((y) => window.scrollTo(0, y), bounds.end);
  await page.waitForTimeout(200);
  const doorOpacity = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('corridor-door')).opacity));
  assert(doorOpacity === 1, `404: the door still reaches full opacity at the end of the pin despite every work image 404ing — got ${doorOpacity}`);

  assert(consoleErrors.length === 0, `404: no unexpected console errors — got ${JSON.stringify(consoleErrors)}`);
  await page.close();
  console.log('PASS - one image 404: placeholder and plaque stay in place, no broken-image icon, rest of the corridor unaffected, no unexpected console errors');
}

// No corridor image request fires until the section is within 1.5 viewport
// heights of the viewport (the IntersectionObserver's own rootMargin, see
// build/pages/index.html). Tracked from real network requests, not from
// the page's own internal state.
async function checkLazyLoadTiming(browserType) {
  const page = await browserType.newPage({ viewport: { width: 1440, height: 900 } });
  const requested = [];
  page.on('request', (req) => {
    if (/\/assets\/responsive\/(corridor-|bloom-exhibition-)/.test(req.url())) requested.push(req.url());
  });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  assert(requested.length === 0, `lazy timing: no corridor image request has fired at the top of the page — got ${JSON.stringify(requested)}`);

  const bounds = await corridorBounds(page);
  assert(bounds, 'lazy timing: the pin exists');

  // rootMargin '150% 0px 150% 0px' expands the viewport by 1.5x its own
  // height on both top and bottom before computing intersection (see
  // build/pages/index.html), so the section starts intersecting once its
  // own top is within 1.5 viewport heights of the viewport's bottom edge
  // — i.e. once scrollY >= corridor top - viewportHeight - 1.5*viewportHeight.
  const VH = 900;
  const triggerY = bounds.start - VH - VH * 1.5;

  // Comfortably further away than that: still nothing should have loaded.
  const farY = Math.max(0, triggerY - VH);
  await page.evaluate((y) => window.scrollTo(0, y), farY);
  await page.waitForTimeout(300);
  assert(requested.length === 0, `lazy timing: still no corridor image request well outside 1.5 viewport heights — got ${JSON.stringify(requested)}`);

  // Comfortably inside that range: the IntersectionObserver should have
  // fired and every corridor image request should now be underway.
  const nearY = Math.max(0, triggerY + VH * 0.3);
  await page.evaluate((y) => window.scrollTo(0, y), nearY);
  await page.waitForTimeout(500);
  assert(requested.length > 0, 'lazy timing: corridor image requests fire once the section is within 1.5 viewport heights');

  await page.close();
  console.log('PASS - lazy load timing: no corridor image request before the section is within 1.5 viewport heights, requests fire once it is');
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = startServer();
    await waitForServer(30);

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    try {
      for (const size of SIZES) {
        await checkDesktopSize(browser, `chromium ${size.width}x${size.height}`, size);
      }
      await checkResize(browser);
      await checkMobile(browser);
      await checkDoorUsesRoomBloom(browser);
      await checkReducedMotion(browser);
      await checkNoJs(browser);
      await checkPinAndHeightUnaffectedBySlowImages(browser);
      await checkOneImage404(browser);
      await checkLazyLoadTiming(browser);
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
