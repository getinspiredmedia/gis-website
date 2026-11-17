'use strict';
/*
 * /submit's hero statement used `max-width: 16ch`, and Chromium doesn't
 * always recompute a ch-unit length when the non-blocking Archivo load
 * swaps the font in, so the line breaks could land on one of a few
 * different widths depending purely on timing (reproducible: 10 reloads of
 * the unmodified page land on two different outcomes). build/pages/submit.html
 * now uses a fixed `11.518em` instead (the same width, measured in Archivo),
 * which doesn't depend on which font is active when layout runs. This loads
 * the real page from a real server 10 times at two viewports and asserts
 * every reload produces the exact same line-wrapping.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.submit-wrap-stability-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.submit-wrap-stability-test-uploads');
const PORT = 3213;
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

async function measureWrap(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(BASE + '/submit', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const result = await page.evaluate(() => {
    const el = document.querySelector('.hero .statement');
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].map(r => Math.round(r.width));
  });
  await page.close();
  return result;
}

async function checkStableAcrossReloads(browser, width, height) {
  const runs = [];
  for (let i = 0; i < 10; i++) runs.push(await measureWrap(browser, width, height));
  const serialized = runs.map(r => JSON.stringify(r));
  const unique = new Set(serialized);
  assert(unique.size === 1, `${width}x${height}: all 10 reloads produce the same line wrap — got ${[...unique].join(' | ')}`);
  assert(runs[0].length === 3, `${width}x${height}: the statement wraps to exactly 3 lines — got ${runs[0].length}`);
  console.log(`PASS - ${width}x${height}: 10/10 reloads wrap identically (${JSON.stringify(runs[0])})`);
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
      await checkStableAcrossReloads(browser, 1440, 900);
      await checkStableAcrossReloads(browser, 375, 812);
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
