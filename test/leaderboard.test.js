'use strict';
/*
 * Public top-10 leaderboard for the active round (GET /api/on-view/leaderboard),
 * the last piece before anything about the contest is visible publicly. Shows
 * up to 10 approved works from whichever round's [starts_at, ends_at) window
 * covers now, in a server-shuffled order so the response never reveals the
 * view_count ranking behind it — the response also omits view_count entirely,
 * belt-and-braces against a curious visitor reading the network tab. No active
 * round: [] (not a 404), so the page can render a quiet empty state.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.leaderboard-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.leaderboard-test-uploads');
const PORT = 3194;
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
    env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT) },
    stdio: 'ignore',
  });
}

function insertWork(db, { slug, title, artist, roundNumber, reviewStatus, viewCount }) {
  db.prepare(
    "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,view_count,approved_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,CASE WHEN ?='approved' THEN datetime('now') ELSE NULL END)"
  ).run(slug, title, artist, '#', `/uploads/${slug}.webp`, 'previous', reviewStatus, roundNumber, viewCount, reviewStatus);
}

async function leaderboard() {
  const r = await fetch(`${BASE}/api/on-view/leaderboard`);
  assert(r.status === 200, `GET /api/on-view/leaderboard responds 200 — got ${r.status}`);
  return r.json();
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = startServer();
    await waitForServer(30);

    // ── No active round: empty state, not a 404 ─────────────────────────
    {
      const rows = await leaderboard();
      assert(Array.isArray(rows) && rows.length === 0, `no active round returns an empty array — got ${JSON.stringify(rows)}`);
    }
    console.log('PASS - no active round returns an empty array (quiet empty state), not a 404');

    // ── Seed round 1 (active now) plus a past round and a future round ──
    const db = new Database(DB_PATH);
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (1, datetime('now','-2 days'), datetime('now','+5 days'))").run();
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (0, datetime('now','-20 days'), datetime('now','-10 days'))").run();

    insertWork(db, { slug: 'r1-approved-high', title: 'High', artist: 'Artist High', roundNumber: 1, reviewStatus: 'approved', viewCount: 50 });
    insertWork(db, { slug: 'r1-approved-mid', title: 'Mid', artist: 'Artist Mid', roundNumber: 1, reviewStatus: 'approved', viewCount: 30 });
    insertWork(db, { slug: 'r1-approved-low', title: 'Low', artist: 'Artist Low', roundNumber: 1, reviewStatus: 'approved', viewCount: 10 });
    insertWork(db, { slug: 'r1-pending', title: 'Pending', artist: 'Artist Pending', roundNumber: 1, reviewStatus: 'pending', viewCount: 999 });
    insertWork(db, { slug: 'r1-rejected', title: 'Rejected', artist: 'Artist Rejected', roundNumber: 1, reviewStatus: 'rejected', viewCount: 999 });
    insertWork(db, { slug: 'r0-approved', title: 'Old Round', artist: 'Artist Old', roundNumber: 0, reviewStatus: 'approved', viewCount: 999 });
    db.close();

    // ── Only approved works from the active round appear ────────────────
    {
      const rows = await leaderboard();
      const slugs = rows.map(w => w.slug).sort();
      assert(
        JSON.stringify(slugs) === JSON.stringify(['r1-approved-high', 'r1-approved-low', 'r1-approved-mid']),
        `only the 3 approved works from the active round appear, no pending/rejected/other-round work — got ${JSON.stringify(slugs)}`
      );
    }
    console.log('PASS - only approved works from the active round appear; pending, rejected, and other-round works are excluded');

    // ── Response never carries a number (view_count or rank) ────────────
    {
      const rows = await leaderboard();
      for (const w of rows) {
        assert(!('view_count' in w), `response item has no view_count field — got keys ${Object.keys(w)}`);
        assert(!('rank' in w), `response item has no rank field — got keys ${Object.keys(w)}`);
        const values = Object.keys(w).sort();
        assert(JSON.stringify(values) === JSON.stringify(['artist', 'image', 'slug', 'title']), `response item exposes only slug/title/artist/image — got ${JSON.stringify(values)}`);
      }
    }
    console.log('PASS - nothing in the response reveals view_count or a rank number');

    // ── Order is shuffled, not a stable view_count-descending sort ───────
    {
      const sortedDesc = JSON.stringify(['r1-approved-high', 'r1-approved-mid', 'r1-approved-low']);
      let sawDifferentOrder = false;
      for (let i = 0; i < 30; i++) {
        const rows = await leaderboard();
        const order = JSON.stringify(rows.map(w => w.slug));
        if (order !== sortedDesc) { sawDifferentOrder = true; break; }
      }
      assert(sawDifferentOrder, 'across 30 requests, at least one response order differs from the view_count-descending order — shuffling is not happening');
    }
    console.log('PASS - the order varies across requests, never consistently sorted by view_count');

    // ── Fewer than 10 approved works: no padding ─────────────────────────
    {
      const rows = await leaderboard();
      assert(rows.length === 3, `with 3 approved works in the round, exactly 3 are returned, no padding — got ${rows.length}`);
    }
    console.log('PASS - fewer than 10 approved works in the round: exactly that many are returned, no padding');

    // ── More than 10 approved works: capped at the top 10 by view_count ──
    {
      const db2 = new Database(DB_PATH);
      for (let i = 0; i < 12; i++) {
        insertWork(db2, { slug: `r1-extra-${i}`, title: `Extra ${i}`, artist: `Artist ${i}`, roundNumber: 1, reviewStatus: 'approved', viewCount: i });
      }
      db2.close();
    }
    {
      const rows = await leaderboard();
      assert(rows.length === 10, `at most 10 works are returned even with 15 approved works in the round — got ${rows.length}`);
      const slugs = new Set(rows.map(w => w.slug));
      // The 15 approved works have view_count 50,30,10,0..11 — the top 10 are
      // 50,30,11,10,10,9,8,7,6,5 by count, i.e. everything except extras 0-4.
      for (const excluded of ['r1-extra-0', 'r1-extra-1', 'r1-extra-2', 'r1-extra-3', 'r1-extra-4']) {
        assert(!slugs.has(excluded), `the lowest-viewed works are not among the top 10 — unexpectedly found ${excluded}`);
      }
    }
    console.log('PASS - with more than 10 approved works, only the top 10 by view_count are eligible (order still shuffled)');

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
