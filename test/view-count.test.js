'use strict';
/*
 * On View is closed. GET /work/:slug no longer writes anything about a
 * visitor: work_views gets no new rows and works.view_count is never
 * incremented — a visit just renders the page with whatever view_count
 * already holds. work_views itself still exists (so the admin wipe can
 * still clear out any rows left from before this change) and the daily
 * cleanup task still drains rows older than 30 days.
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

function cleanupFiles() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    fs.rmSync(f, { force: true });
  }
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

function startServer() {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, PORT: String(PORT), ADMIN_PASSWORD },
    stdio: 'ignore',
  });
}

function viewCount(slug) {
  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT view_count FROM works WHERE slug=?').get(slug);
  db.close();
  return row.view_count;
}

function workViewsCount() {
  const db = new Database(DB_PATH);
  const n = db.prepare('SELECT COUNT(*) AS n FROM work_views').get().n;
  db.close();
  return n;
}

async function run() {
  cleanupFiles();

  let child = startServer();

  try {
    await waitForServer(30);

    const db = new Database(DB_PATH);
    db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
    ).run('view-count-test-work', 'View Count Test Work', 'Test Artist', '#', '/uploads/test.webp', 'current');
    db.close();

    assert(viewCount('view-count-test-work') === 0, 'view_count defaults to 0 before any visit');
    assert(workViewsCount() === 0, 'work_views is empty before any visit');

    // Ten visits, mixing user-agents (a normal browser, known OG-scraper
    // UAs, missing/unknown UA) — none of it matters any more: view_count
    // and work_views stay exactly as they were.
    const USER_AGENTS = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'WhatsApp/2.23.20.0',
      '',
      'SomeRandomUnknownClient/9.9',
    ];
    for (let i = 0; i < 10; i++) {
      const ua = USER_AGENTS[i % USER_AGENTS.length];
      const r = await fetch(`${BASE}/work/view-count-test-work`, { headers: { 'User-Agent': ua } });
      assert(r.status === 200, `visit ${i + 1} (UA "${ua}"): /work/:slug responds 200`);
      const html = await r.text();
      assert(html.includes('og:title'), `visit ${i + 1}: OG tags still render normally`);
    }
    assert(viewCount('view-count-test-work') === 0, `10 visits leave view_count at 0 — got ${viewCount('view-count-test-work')}`);
    assert(workViewsCount() === 0, `10 visits leave work_views empty — got ${workViewsCount()} row(s)`);
    console.log('PASS - 10 visits (mixed user-agents) leave view_count and work_views completely unchanged');

    // Unknown slug: no error, no row created anywhere, existing counters untouched.
    {
      const before = new Database(DB_PATH).prepare('SELECT COUNT(*) as n FROM works').get().n;
      const r = await fetch(`${BASE}/work/this-slug-does-not-exist-at-all`);
      assert(r.status === 200, 'unknown slug still responds 200 (client renders "not found")');
      const after = new Database(DB_PATH).prepare('SELECT COUNT(*) as n FROM works').get().n;
      assert(after === before, `unknown slug creates no row — row count unchanged (${before} -> ${after})`);
    }
    console.log('PASS - unknown slug: no error, no row created');

    // Admin API still surfaces view_count and raw_views (both frozen at
    // whatever the database already holds — 0 here, since nothing writes
    // to either any more).
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
      assert(row.view_count === 0, `admin API view_count stays 0 — got ${row.view_count}`);
      assert(row.raw_views === 0, `admin API raw_views stays 0 — got ${row.raw_views}`);
    }
    console.log('PASS - admin API shows view_count and raw_views unchanged by any visit');

    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // ── Cleanup task ─────────────────────────────────────────────────────
    // work_views rows older than 30 days are still deleted on a restart
    // (any rows left from before this change, or seeded directly as here);
    // younger rows are kept. cleanupOldViews() runs once immediately at
    // startup (same pattern as archiveOldWorks()).
    let workId;
    {
      const db2 = new Database(DB_PATH);
      workId = db2.prepare('SELECT id FROM works WHERE slug=?').get('view-count-test-work').id;
      db2.close();
    }

    let oldRowId, recentRowId;
    {
      const db2 = new Database(DB_PATH);
      oldRowId = db2.prepare(
        "INSERT INTO work_views (work_id, visitor_hash, viewed_at) VALUES (?,?,datetime('now','-31 days'))"
      ).run(workId, 'cleanup-test-old-hash').lastInsertRowid;
      recentRowId = db2.prepare(
        "INSERT INTO work_views (work_id, visitor_hash, viewed_at) VALUES (?,?,datetime('now','-2 days'))"
      ).run(workId, 'cleanup-test-recent-hash').lastInsertRowid;
      db2.close();
    }

    child = startServer();
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 500)); // let the immediate cleanupOldViews() land

    {
      const db2 = new Database(DB_PATH);
      const oldRow = db2.prepare('SELECT id FROM work_views WHERE id=?').get(oldRowId);
      const recentRow = db2.prepare('SELECT id FROM work_views WHERE id=?').get(recentRowId);
      db2.close();
      assert(!oldRow, 'a work_views row older than 30 days is deleted by the cleanup task');
      assert(!!recentRow, 'a work_views row within 30 days is kept by the cleanup task');
    }
    console.log('PASS - the daily cleanup task still deletes work_views rows older than 30 days and keeps younger ones');

    console.log('\nALL PASS');
  } finally {
    if (child) {
      child.kill();
      // Give Windows a moment to release the DB file handle before deleting it.
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
