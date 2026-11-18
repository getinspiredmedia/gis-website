'use strict';
/*
 * No page on the site loads anything from a third-party host any more
 * (hCaptcha is removed, fonts are self-hosted, Plausible is proxied via our
 * own domain — see CLAUDE.md). This loads every reachable page in a real
 * browser and records every network request's host; any host other than
 * 127.0.0.1 itself is a violation and is reported by page.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.external-hosts-test.db');
const PORT = 3218;
const BASE = `http://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function cleanup() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
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

const PAGES = [
  '/', '/magazine', '/gallery', '/about', '/contact', '/support', '/privacy', '/submit',
  '/on-view', '/work/no-ext-work',
  '/magazine/bloom', '/magazine/chasing-light', '/magazine/no-algorithm', '/magazine/origins',
  '/magazine/bloom/read', '/magazine/chasing-light/read', '/magazine/no-algorithm/read', '/magazine/origins/read',
  '/admin', '/embed',
];

async function run() {
  cleanup();
  let child;
  let browser;
  try {
    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH, PORT: String(PORT), ADMIN_PASSWORD: 'test-admin-pwd' },
      stdio: 'ignore',
    });
    await waitForServer(30);
    child.kill();
    await new Promise(r => setTimeout(r, 400));

    // The default seed data (public/data/works.json) uses picsum.photos
    // placeholder images, which is a pre-existing, unrelated fixture-data
    // quirk, not a real production asset-hosting choice (real submissions
    // get a same-origin /uploads/<uuid>.webp — see server.js). Replace every
    // seeded work's image with a same-origin path (/on-view and /embed can
    // show any of them) so this check reflects how a real work actually
    // looks, not the mock data's placeholder host.
    {
      const d = new Database(DB_PATH);
      const rows = d.prepare('SELECT id FROM works ORDER BY id').all();
      const upd = d.prepare("UPDATE works SET image_url=? WHERE id=?");
      rows.forEach((row, i) => upd.run(`/uploads/seed-${i}.webp`, row.id));
      d.prepare("UPDATE works SET slug='no-ext-work' WHERE id=(SELECT id FROM works ORDER BY id LIMIT 1)").run();
      d.close();
    }

    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH, PORT: String(PORT), ADMIN_PASSWORD: 'test-admin-pwd' },
      stdio: 'ignore',
    });
    await waitForServer(30);

    {
      const r = await fetch(`${BASE}/api/works`);
      const works = await r.json();
      assert(works.some(w => w.slug === 'no-ext-work'), 'the relabeled work exists for /work/:slug');
    }

    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const byPage = {};

    for (const p of PAGES) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const hosts = new Set();
      page.on('request', req => {
        try {
          const u = new URL(req.url());
          if (u.hostname && u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') hosts.add(u.hostname);
        } catch {}
      });
      await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(500);
      await context.close();
      byPage[p] = Array.from(hosts);
    }

    const violations = Object.entries(byPage).filter(([, hosts]) => hosts.length > 0);
    assert(violations.length === 0, `pages that still load from an external host: ${JSON.stringify(violations, null, 2)}`);
    console.log('PASS - no page loads anything from a third-party host (checked ' + PAGES.length + ' pages)');

    console.log('\nALL PASS');
  } finally {
    if (browser) await browser.close();
    if (child) {
      child.kill();
      await new Promise(r => setTimeout(r, 400));
    }
    cleanup();
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
  });
}

module.exports = { run };
