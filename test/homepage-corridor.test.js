'use strict';
/*
 * The homepage corridor ("the gang"): on desktop (>860px, no-preference
 * motion) a pinned CSS-3D walk past the five Bloom works, ending at a door
 * that grows to fill the screen; on mobile or under reduced motion, a plain
 * horizontal scroll-snap row with no pin and no 3D; without JavaScript at
 * all, the five works simply stacked, then the door.
 *
 * This test computes its own, independent "which work is nearest" answer
 * from raw getBoundingClientRect() widths fetched out of the page (the
 * work with projected width closest to a target derived the same way the
 * page itself derives it: ~2.1x each work's own unscaled width) — it does
 * not call back into the page's own nearestWork() function, only its CSS 3D
 * projection output.
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

async function workRects(page) {
  return page.evaluate(() => {
    const works = Array.from(document.querySelectorAll('.corr-work'));
    return {
      rooms: works.map(w => w.getAttribute('data-room')),
      widths: works.map(w => w.getBoundingClientRect().width),
      nearRoom: (document.querySelector('.corr-work.is-near') || {}).getAttribute
        ? document.querySelector('.corr-work.is-near').getAttribute('data-room')
        : null,
    };
  });
}

// Independent ground truth: the work whose current projected width is
// closest to ~2.1x its own base (unscaled) width — same principle the page
// itself uses, computed here from raw numbers only.
function nearestRoomIndependently(baseWidths, widths) {
  const target = baseWidths[0] * 2.1;
  let bestIdx = -1, bestDiff = Infinity;
  widths.forEach((w, i) => {
    const diff = Math.abs(w - target);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  });
  return bestIdx;
}

async function corridorBounds(page) {
  return page.evaluate(() => {
    const st = window.ScrollTrigger ? ScrollTrigger.getAll().find(s => s.trigger && s.trigger.id === 'corridor-pin') : null;
    return st ? { start: st.start, end: st.end } : null;
  });
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
  await page.waitForTimeout(400);

  const bounds = await corridorBounds(page);
  assert(bounds, `${label}: the corridor's pinned ScrollTrigger exists`);
  const span = bounds.end - bounds.start;

  const base = await workRects(page);
  assert(base.rooms.length === 5, `${label}: exactly 5 works — got ${base.rooms.length}`);
  const baseWidths = base.widths;

  const steps = 80;
  const seenDown = [];
  for (let i = 0; i <= steps; i++) {
    const y = bounds.start + span * (i / steps);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(25);
    const { rooms, widths, nearRoom } = await workRects(page);
    const expectedIdx = nearestRoomIndependently(baseWidths, widths);
    const expectedRoom = rooms[expectedIdx];
    assert(nearRoom === expectedRoom, `${label}: step ${i}/${steps} — expected nearest room ${expectedRoom}, got ${nearRoom}`);
    if (seenDown[seenDown.length - 1] !== nearRoom) seenDown.push(nearRoom);
  }
  assert(
    JSON.stringify(seenDown) === JSON.stringify(['1', '2', '3', '4', '5']),
    `${label}: scrolling down visits rooms 1..5 in strict order with nothing skipped or repeated — got ${JSON.stringify(seenDown)}`
  );

  // The door is fullscreen and its copy readable at the pin's own end.
  await page.evaluate((y) => window.scrollTo(0, y), bounds.end);
  await page.waitForTimeout(200);
  const doorState = await page.evaluate(() => {
    const door = document.getElementById('corridor-door');
    const copy = document.querySelector('.corridor-door-copy');
    const r = door.getBoundingClientRect();
    return {
      isOpen: door.classList.contains('is-open'),
      width: r.width,
      height: r.height,
      copyOpacity: copy ? getComputedStyle(copy).opacity : null,
      btnText: document.querySelector('.corridor-door-copy .btn') ? document.querySelector('.corridor-door-copy .btn').textContent.trim() : null,
    };
  });
  assert(doorState.isOpen, `${label}: the door is open at the pin's end`);
  assert(Math.abs(doorState.width - size.width) < 2, `${label}: the door is screen-width at the end — got ${doorState.width} vs viewport ${size.width}`);
  assert(Math.abs(doorState.height - size.height) < 2, `${label}: the door is screen-height at the end — got ${doorState.height} vs viewport ${size.height}`);
  assert(doorState.copyOpacity === '1', `${label}: the door's copy is fully visible at the end — got opacity ${doorState.copyOpacity}`);
  assert(doorState.btnText && /Enter the room/.test(doorState.btnText), `${label}: the "Enter the room" link is present — got ${JSON.stringify(doorState.btnText)}`);

  // Scroll back up: clean reverse order, door closes again, nothing stuck.
  const seenUp = [];
  for (let i = steps; i >= 0; i--) {
    const y = bounds.start + span * (i / steps);
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(25);
    const { nearRoom } = await workRects(page);
    if (seenUp[seenUp.length - 1] !== nearRoom) seenUp.push(nearRoom);
  }
  assert(
    JSON.stringify(seenUp) === JSON.stringify(['5', '4', '3', '2', '1']),
    `${label}: scrolling back up visits rooms 5..1 in reverse order with nothing stuck — got ${JSON.stringify(seenUp)}`
  );
  const doorAfterUp = await page.evaluate(() => document.getElementById('corridor-door').classList.contains('is-open'));
  assert(!doorAfterUp, `${label}: the door is closed again after scrolling back up`);

  assert(consoleErrors.length === 0, `${label}: no console errors — got ${JSON.stringify(consoleErrors)}`);

  await page.close();
  console.log(`PASS - ${label}: rooms 1..5 in order both directions, door opens fullscreen at the end and closes again on the way back, no console errors`);
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
      await checkMobile(browser);
      await checkReducedMotion(browser);
      await checkNoJs(browser);
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
