'use strict';
/*
 * /work/:slug increments works.view_count at most once per visitor
 * (salted hash of IP+user-agent) per work per 24h — no readable IP is ever
 * stored, only the hash, in work_views. On top of that, a per-IP rate
 * limiter caps how many requests can affect the count at all, so a script
 * that dodges the 24h dedup by varying its User-Agent still can't inflate
 * the count without bound. Known OG-preview scrapers stay excluded, exactly
 * as before. A daily cleanup task deletes work_views rows older than 30
 * days.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.view-count-test.db');
const PORT = 3197;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'test-admin-pwd';
const VISITOR_HASH_SALT = 'test-salt-do-not-use-in-prod';

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

function startServer(extraEnv) {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, PORT: String(PORT), ADMIN_PASSWORD, VISITOR_HASH_SALT, ...extraEnv },
    stdio: 'ignore',
  });
}

function viewCount(slug) {
  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT view_count FROM works WHERE slug=?').get(slug);
  db.close();
  return row.view_count;
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

    // Column exists with the right default for a work that hasn't been visited
    assert(viewCount('view-count-test-work') === 0, 'view_count defaults to 0 before any visit');

    // Five visits from the SAME visitor (same IP + same User-Agent) within 24h
    // increment the counter exactly once, not five times.
    const SAME_VISITOR_UA = 'Mozilla/5.0 (same-visitor-test) Chrome/128.0.0.0';
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${BASE}/work/view-count-test-work`, { headers: { 'User-Agent': SAME_VISITOR_UA } });
      assert(r.status === 200, `visit ${i + 1}: /work/:slug responds 200`);
    }
    assert(viewCount('view-count-test-work') === 1, `5 visits from the same visitor within 24h increment view_count exactly once — got ${viewCount('view-count-test-work')}`);
    console.log('PASS - 5 visits from the same visitor within 24h increment view_count exactly once');

    // A second, different visitor (different User-Agent, same IP) is a
    // distinct visitor_hash — increments the counter a second time.
    const OTHER_VISITOR_UA = 'Mozilla/5.0 (other-visitor-test) Chrome/128.0.0.0';
    {
      const r = await fetch(`${BASE}/work/view-count-test-work`, { headers: { 'User-Agent': OTHER_VISITOR_UA } });
      assert(r.status === 200, 'different visitor: 200 response');
      assert(viewCount('view-count-test-work') === 2, `a different visitor increments view_count a second time — got ${viewCount('view-count-test-work')}`);
    }
    console.log('PASS - a different visitor (different visitor_hash) increments view_count again');

    // No readable IP is ever stored — only the salted hash.
    {
      const db2 = new Database(DB_PATH);
      const rows = db2.prepare('SELECT visitor_hash FROM work_views').all();
      db2.close();
      assert(rows.length >= 2, 'work_views has rows for both visitors');
      for (const row of rows) {
        assert(!row.visitor_hash.includes('127.0.0.1') && !row.visitor_hash.includes('::1'),
          'visitor_hash never contains a readable loopback IP — got ' + row.visitor_hash);
        assert(/^[0-9a-f]{64}$/.test(row.visitor_hash), 'visitor_hash is a hex sha256 digest, not raw input — got ' + row.visitor_hash);
      }
    }
    console.log('PASS - work_views stores only a salted hash, never a readable IP');

    // A different, untouched slug stays at 0 — proves the increment is scoped to the visited slug only
    {
      const db2 = new Database(DB_PATH);
      db2.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
      ).run('view-count-untouched-work', 'Untouched Work', 'Other Artist', '#', '/uploads/other.webp', 'previous');
      db2.close();
    }
    assert(viewCount('view-count-untouched-work') === 0, 'an unvisited work stays at 0 while another is visited');
    console.log('PASS - increment is scoped to the visited slug, not global');

    // Unknown slug: no error, no row created, existing counters untouched
    {
      const before = new Database(DB_PATH).prepare('SELECT COUNT(*) as n FROM works').get().n;
      const r = await fetch(`${BASE}/work/this-slug-does-not-exist-at-all`);
      assert(r.status === 200, 'unknown slug still responds 200 (client renders "not found")');
      const after = new Database(DB_PATH).prepare('SELECT COUNT(*) as n FROM works').get().n;
      assert(after === before, `unknown slug creates no row — row count unchanged (${before} -> ${after})`);
      assert(viewCount('view-count-test-work') === 2, 'unknown-slug visit does not touch other works\' counters');
    }
    console.log('PASS - unknown slug: no error, no row created, other counters untouched');

    // Admin API surfaces the deduplicated view_count AND the raw hit count
    // (rows in work_views) — the two visitors above give 2 and 2.
    let adminToken;
    {
      const authRes = await fetch(`${BASE}/api/admin/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PASSWORD }),
      });
      const { token } = await authRes.json();
      assert(!!token, 'admin auth succeeds with the configured password');
      adminToken = token;

      const worksRes = await fetch(`${BASE}/api/admin/works`, { headers: { Authorization: 'Bearer ' + token } });
      const rows = await worksRes.json();
      const row = rows.find(w => w.slug === 'view-count-test-work');
      assert(!!row, 'admin API includes the test work');
      assert(row.view_count === 2, `admin API view_count matches the deduplicated database value (2) — got ${row.view_count}`);
      assert(row.raw_views === 2, `admin API raw_views matches the work_views row count (2) — got ${row.raw_views}`);
    }
    console.log('PASS - admin API surfaces both the deduplicated view_count and the raw work_views count');

    // Known OG-preview scrapers must not inflate the counter, and must not
    // even count against the rate limiter (still a normal 200 response).
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
      const before = viewCount('view-count-scraper-work');
      const r = await fetch(`${BASE}/work/view-count-scraper-work`, { headers: { 'User-Agent': ua } });
      assert(r.status === 200, `scraper UA "${ua}": page still responds 200`);
      const html = await r.text();
      assert(html.includes('og:title'), `scraper UA "${ua}": OG tags still render normally`);
      assert(viewCount('view-count-scraper-work') === before, `scraper UA "${ua}" does not increment view_count (${before} -> ${viewCount('view-count-scraper-work')})`);
    }
    console.log(`PASS - all ${SCRAPER_UAS.length} known scraper user-agents excluded from the count, page still renders normally`);

    // A normal browser User-Agent still counts, right after the scraper requests above
    {
      const before = viewCount('view-count-scraper-work');
      const r = await fetch(`${BASE}/work/view-count-scraper-work`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' },
      });
      assert(r.status === 200, 'normal browser UA: 200 response');
      assert(viewCount('view-count-scraper-work') === before + 1, `normal browser UA increments the count by 1 (${before} -> ${viewCount('view-count-scraper-work')})`);
    }
    console.log('PASS - a normal browser User-Agent still counts as a view');

    // Missing/unknown User-Agent must fail OPEN — still counts as a view
    {
      const before = viewCount('view-count-scraper-work');
      const r = await fetch(`${BASE}/work/view-count-scraper-work`, { headers: { 'User-Agent': '' } });
      assert(r.status === 200, 'empty UA: 200 response');
      const afterEmpty = viewCount('view-count-scraper-work');
      assert(afterEmpty === before + 1, `empty User-Agent fails open and still counts (${before} -> ${afterEmpty})`);

      const before2 = afterEmpty;
      const r2 = await fetch(`${BASE}/work/view-count-scraper-work`, { headers: { 'User-Agent': 'SomeRandomUnknownClient/9.9' } });
      assert(r2.status === 200, 'unknown UA: 200 response');
      const after2 = viewCount('view-count-scraper-work');
      assert(after2 === before2 + 1, `unrecognized User-Agent fails open and still counts (${before2} -> ${after2})`);
    }
    console.log('PASS - missing/unknown User-Agent fails open (still counts), not closed');

    // ── Rate limiter ──────────────────────────────────────────────────────
    // Fast repeated requests from one IP, each with a fresh User-Agent (so
    // the 24h visitor-hash dedup alone would let every single one through),
    // must still be capped — proving the IP-based limiter is a separate,
    // additional guard, not just a restatement of the dedup.
    {
      const db2 = new Database(DB_PATH);
      db2.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
      ).run('view-count-rate-limit-work', 'Rate Limit Test Work', 'Test Artist', '#', '/uploads/test.webp', 'current');
      db2.close();
    }

    const BURST = 30; // comfortably above the 20/60s per-IP limit
    for (let i = 0; i < BURST; i++) {
      const r = await fetch(`${BASE}/work/view-count-rate-limit-work`, { headers: { 'User-Agent': `burst-visitor-${i}` } });
      assert(r.status === 200, `burst request ${i + 1}: still gets a normal 200 (rate limiter never blocks the page itself)`);
    }
    const afterBurst = viewCount('view-count-rate-limit-work');
    assert(afterBurst < BURST, `rate limiter caps how many of ${BURST} rapid distinct-visitor requests from one IP can increment the count — got ${afterBurst}`);
    assert(afterBurst > 0, 'rate limiter still allows some requests through, it does not block everything');
    console.log(`PASS - rate limiter caps a burst of ${BURST} rapid requests from one IP to ${afterBurst} counted views, without ever blocking the page`);

    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // ── 24h dedup boundary ───────────────────────────────────────────────
    // A work_views row older than 24h for the same visitor_hash must NOT
    // block a new increment; a row within 24h must. Seeded directly (via a
    // fresh work_id + a controlled visitor_hash) while the server is down,
    // so the rate limiter above (still warm in the killed process, but a
    // fresh process starts with an empty one) can't interfere.
    function hashVisitor(ip, ua) {
      return crypto.createHash('sha256').update(VISITOR_HASH_SALT + '|' + ip + '|' + ua).digest('hex');
    }

    let workId;
    {
      const db2 = new Database(DB_PATH);
      db2.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
      ).run('view-count-boundary-work', 'Boundary Test Work', 'Test Artist', '#', '/uploads/test.webp', 'current');
      workId = db2.prepare('SELECT id FROM works WHERE slug=?').get('view-count-boundary-work').id;
      db2.close();
    }

    child = startServer();
    await waitForServer(30);

    // The server sees this request from 127.0.0.1 (IPv4 loopback, since PORT
    // is bound without an explicit host and Node listens on all interfaces —
    // fetch() to 127.0.0.1 above resolves as IPv4 both here and server-side).
    const BOUNDARY_UA = 'boundary-test-visitor';
    const boundaryHash = hashVisitor('127.0.0.1', BOUNDARY_UA);

    // Seed a row for this exact visitor_hash 25 hours ago — outside the 24h window.
    {
      const db2 = new Database(DB_PATH);
      db2.prepare(
        "INSERT INTO work_views (work_id, visitor_hash, viewed_at) VALUES (?,?,datetime('now','-25 hours'))"
      ).run(workId, boundaryHash);
      db2.close();
    }
    {
      const r = await fetch(`${BASE}/work/view-count-boundary-work`, { headers: { 'User-Agent': BOUNDARY_UA } });
      assert(r.status === 200, 'boundary visit: 200 response');
      assert(viewCount('view-count-boundary-work') === 1, `a visitor_hash last seen 25h ago counts as a new view — got ${viewCount('view-count-boundary-work')}`);
    }
    console.log('PASS - a work_views row older than 24h does not block a new increment');

    // Now the most recent row for that same visitor_hash is fresh (just
    // written above) — a second visit within 24h must not increment again.
    {
      const before = viewCount('view-count-boundary-work');
      const r = await fetch(`${BASE}/work/view-count-boundary-work`, { headers: { 'User-Agent': BOUNDARY_UA } });
      assert(r.status === 200, 'second boundary visit: 200 response');
      assert(viewCount('view-count-boundary-work') === before, `a visitor_hash seen within the last 24h does not increment again — got ${viewCount('view-count-boundary-work')}`);
    }
    console.log('PASS - a work_views row within 24h blocks a repeat increment for that visitor_hash');

    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // ── Cleanup task ─────────────────────────────────────────────────────
    // work_views rows older than 30 days are deleted; younger rows are kept.
    // cleanupOldViews() runs once immediately at startup (same pattern as
    // archiveOldWorks()), so seed both an old and a recent row while the
    // server is down, then restart to trigger it.
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
    console.log('PASS - the daily cleanup task deletes work_views rows older than 30 days and keeps younger ones');

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
