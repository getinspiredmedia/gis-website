'use strict';
/*
 * Issue titles are always written in sentence case (e.g. "Bloom", "No
 * Algorithm", "Wonder"), never shouted in all caps, even where they sit
 * inside a small, all-caps-by-convention label like an eyebrow. A plain
 * HTML/CSS assertion can prove the source text is right, but CSS
 * text-transform:uppercase changes what actually renders without touching
 * that source text, so this checks the real rendered innerText (Chromium
 * applies CSS text-transform to innerText, unlike textContent) on every
 * page that can show an issue title: the homepage, /magazine, /submit,
 * /gallery and all four issue pages. innerText never includes an <img>'s
 * alt text or a background-image's pixels, so a cover image's own cover
 * typography (e.g. a "WONDER" wordmark baked into a future cover file) is
 * excluded by construction, not by any special-casing here.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const { ISSUES } = require('../build/data/issues');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.issue-title-casing-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.issue-title-casing-test-uploads');
const PORT = 3213;
const BASE = `http://127.0.0.1:${PORT}`;

// All-caps renderings of every issue title that must never appear.
const SHOUTED_TITLES = ['ORIGINS', 'NO ALGORITHM', 'CHASING LIGHT', 'BLOOM', 'WONDER'];

const PAGES = ['/', '/magazine', '/submit', '/gallery', ...ISSUES.map(i => `/magazine/${i.slug}`)];

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

async function checkPageHasNoShoutedTitle(browserType, route) {
  const page = await browserType.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + route, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const innerText = await page.evaluate(() => document.body.innerText);
  await page.close();

  const offenders = SHOUTED_TITLES.filter(t => innerText.includes(t));
  assert(offenders.length === 0, `${route}: rendered text must not shout an issue title in all caps — found ${JSON.stringify(offenders)}`);
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
      for (const route of PAGES) {
        await checkPageHasNoShoutedTitle(browser, route);
      }
    } finally {
      await browser.close();
    }

    console.log(`PASS - no issue title renders in all caps on any of: ${PAGES.join(', ')}`);
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
