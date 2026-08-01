'use strict';
/*
 * /work/:slug increments a raw view_count hit counter — no dedup by IP,
 * session or time window (deliberately simple, per the brief). Verifies the
 * counter increments exactly once per visit to an existing slug, that an
 * unknown slug never creates a row or errors, and that the admin API
 * surfaces the same number the database holds.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.view-count-test.db');
const PORT = 3197;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'test-admin-pwd';

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function waitForServer(retries) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      fetch(BASE + '/').then(r => {
        if (r.ok) resolve();
        else retry(n);
      }).catch(() => retry(n));
    };
    const retry = (n) => {
      if (n <= 0) return reject(new Error('server did not come up'));
      setTimeout(() => attempt(n - 1), 300);
    };
    attempt(retries);
  });
}

async function run() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    fs.rmSync(f, { force: true });
  }

  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, PORT: String(PORT), ADMIN_PASSWORD },
    stdio: 'ignore',
  });

  try {
    await waitForServer(30);

    const db = new Database(DB_PATH);
    db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
    ).run('view-count-test-work', 'View Count Test Work', 'Test Artist', '#', '/uploads/test.webp', 'current');
    db.close();

    // Column exists with the right default for a work that hasn't been visited
    {
      const db2 = new Database(DB_PATH);
      const row = db2.prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-test-work');
      assert(row.view_count === 0, 'view_count defaults to 0 before any visit — got ' + row.view_count);
      db2.close();
    }

    // Five visits to the same slug increment the counter by exactly five
    const VISITS = 5;
    for (let i = 0; i < VISITS; i++) {
      const r = await fetch(`${BASE}/work/view-count-test-work`);
      assert(r.status === 200, `visit ${i + 1}: /work/:slug responds 200`);
    }
    {
      const db2 = new Database(DB_PATH);
      const row = db2.prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-test-work');
      assert(row.view_count === VISITS, `view_count is exactly ${VISITS} after ${VISITS} visits — got ${row.view_count}`);
      db2.close();
    }
    console.log(`PASS - ${VISITS} visits increment view_count by exactly ${VISITS}`);

    // A different, untouched slug stays at 0 — proves the increment is scoped to the visited slug only
    {
      const db2 = new Database(DB_PATH);
      db2.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
      ).run('view-count-untouched-work', 'Untouched Work', 'Other Artist', '#', '/uploads/other.webp', 'previous');
      db2.close();
    }
    {
      const db2 = new Database(DB_PATH);
      const row = db2.prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-untouched-work');
      assert(row.view_count === 0, 'an unvisited work stays at 0 while another is visited — got ' + row.view_count);
      db2.close();
    }
    console.log('PASS - increment is scoped to the visited slug, not global');

    // Unknown slug: no error, no row created, existing counters untouched
    {
      const before = new Database(DB_PATH).prepare('SELECT COUNT(*) as n FROM works').get().n;
      const r = await fetch(`${BASE}/work/this-slug-does-not-exist-at-all`);
      assert(r.status === 200, 'unknown slug still responds 200 (client renders "not found")');
      const db2 = new Database(DB_PATH);
      const after = db2.prepare('SELECT COUNT(*) as n FROM works').get().n;
      assert(after === before, `unknown slug creates no row — row count unchanged (${before} -> ${after})`);
      const stillFive = db2.prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-test-work').view_count;
      assert(stillFive === VISITS, 'unknown-slug visit does not touch other works\' counters — got ' + stillFive);
      db2.close();
    }
    console.log('PASS - unknown slug: no error, no row created, other counters untouched');

    // Admin API surfaces the same number the database holds
    {
      const authRes = await fetch(`${BASE}/api/admin/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD }),
      });
      const { token } = await authRes.json();
      assert(!!token, 'admin auth succeeds with the configured password');

      const worksRes = await fetch(`${BASE}/api/admin/works`, { headers: { Authorization: 'Bearer ' + token } });
      const rows = await worksRes.json();
      const row = rows.find(w => w.slug === 'view-count-test-work');
      assert(!!row, 'admin API includes the test work');
      assert(row.view_count === VISITS, `admin API view_count matches the database value (${VISITS}) — got ${row.view_count}`);
    }
    console.log('PASS - admin API view_count matches the database value');

    // Known OG-preview scrapers must not inflate the counter, but must still
    // get a normal 200 response (the page/OG-tags rendering itself is untouched).
    {
      const db2 = new Database(DB_PATH);
      db2.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
      ).run('view-count-scraper-work', 'Scraper Test Work', 'Test Artist', '#', '/uploads/test.webp', 'current');
      db2.close();
    }

    const SCRAPER_UAS = [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'WhatsApp/2.23.20.0',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Discordbot/2.0 (+https://discordapp.com)',
      'TelegramBot (like TwitterBot)',
      'FACEBOOKEXTERNALHIT/1.1', // case-insensitivity check
    ];
    for (const ua of SCRAPER_UAS) {
      const before = new Database(DB_PATH).prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-scraper-work').view_count;
      const r = await fetch(`${BASE}/work/view-count-scraper-work`, { headers: { 'User-Agent': ua } });
      assert(r.status === 200, `scraper UA "${ua}": page still responds 200`);
      const html = await r.text();
      assert(html.includes('og:title'), `scraper UA "${ua}": OG tags still render normally`);
      const after = new Database(DB_PATH).prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-scraper-work').view_count;
      assert(after === before, `scraper UA "${ua}" does not increment view_count (${before} -> ${after})`);
    }
    console.log(`PASS - all ${SCRAPER_UAS.length} known scraper user-agents excluded from the count, page still renders normally`);

    // A normal browser User-Agent still counts, right after the scraper requests above
    {
      const before = new Database(DB_PATH).prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-scraper-work').view_count;
      const r = await fetch(`${BASE}/work/view-count-scraper-work`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
      });
      assert(r.status === 200, 'normal browser UA: 200 response');
      const after = new Database(DB_PATH).prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-scraper-work').view_count;
      assert(after === before + 1, `normal browser UA increments the count by 1 (${before} -> ${after})`);
    }
    console.log('PASS - a normal browser User-Agent still counts as a view');

    // Missing/unknown User-Agent must fail OPEN — still counts as a view
    {
      const before = new Database(DB_PATH).prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-scraper-work').view_count;
      const r = await fetch(`${BASE}/work/view-count-scraper-work`, { headers: { 'User-Agent': '' } });
      assert(r.status === 200, 'empty UA: 200 response');
      const afterEmpty = new Database(DB_PATH).prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-scraper-work').view_count;
      assert(afterEmpty === before + 1, `empty User-Agent fails open and still counts (${before} -> ${afterEmpty})`);

      const before2 = afterEmpty;
      const r2 = await fetch(`${BASE}/work/view-count-scraper-work`, { headers: { 'User-Agent': 'SomeRandomUnknownClient/9.9' } });
      assert(r2.status === 200, 'unknown UA: 200 response');
      const after2 = new Database(DB_PATH).prepare('SELECT view_count FROM works WHERE slug=?').get('view-count-scraper-work').view_count;
      assert(after2 === before2 + 1, `unrecognized User-Agent fails open and still counts (${before2} -> ${after2})`);
    }
    console.log('PASS - missing/unknown User-Agent fails open (still counts), not closed');

    console.log('\nALL PASS');
  } finally {
    child.kill();
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
      fs.rmSync(f, { force: true });
    }
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
  });
}

module.exports = { run };
