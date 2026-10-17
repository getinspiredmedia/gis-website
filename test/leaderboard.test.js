'use strict';
/*
 * Public leaderboard (GET /api/on-view/leaderboard): { round_number, status,
 * winner, works } or null. The round is the running one, otherwise the most
 * recently closed one (by ends_at, no time limit), otherwise none. Up to 10
 * approved works, shuffled server-side, never a view_count or rank. A running
 * round selects on the live view_count, a closed round on the frozen
 * COALESCE(view_count_at_archive, view_count). The announced winner of the
 * round is included when there is one.
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

function insertWork(db, { slug, title, artist, roundNumber, reviewStatus = 'approved', viewCount, status = 'previous', viewCountAtArchive = null }) {
  return db.prepare(
    "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,view_count,view_count_at_archive,approved_at) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='approved' THEN datetime('now') ELSE NULL END)"
  ).run(slug, title, artist, '#', `/uploads/${slug}.webp`, status, reviewStatus, roundNumber, viewCount, viewCountAtArchive, reviewStatus).lastInsertRowid;
}

async function leaderboard() {
  const r = await fetch(`${BASE}/api/on-view/leaderboard`);
  assert(r.status === 200, `GET /api/on-view/leaderboard responds 200, got ${r.status}`);
  return r.json();
}

function assertNoNumbers(data) {
  assert(JSON.stringify(Object.keys(data).sort()) === JSON.stringify(['round_number', 'status', 'winner', 'works']),
    'the response has exactly round_number, status, winner and works, got ' + JSON.stringify(Object.keys(data)));
  for (const w of data.works) {
    assert(!('view_count' in w) && !('view_count_at_archive' in w) && !('rank' in w), 'a work carries no count or rank, got keys ' + Object.keys(w));
    assert(JSON.stringify(Object.keys(w).sort()) === JSON.stringify(['artist', 'image', 'slug', 'title']), 'a work exposes only slug/title/artist/image, got ' + JSON.stringify(Object.keys(w)));
  }
  if (data.winner) {
    assert(JSON.stringify(Object.keys(data.winner).sort()) === JSON.stringify(['artist', 'slug', 'title']), 'the winner exposes only slug/title/artist, got ' + JSON.stringify(Object.keys(data.winner)));
  }
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = startServer();
    await waitForServer(30);

    // ── No rounds at all: null, not a 404 ───────────────────────────────
    {
      const data = await leaderboard();
      assert(data === null, 'without any round the response is null, got ' + JSON.stringify(data));
    }
    console.log('PASS - without any round the response is null (not a 404)');

    const db = new Database(DB_PATH);

    // ── Only a future round: still null ─────────────────────────────────
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (7, datetime('now','+3 days'), datetime('now','+10 days'))").run();
    {
      const data = await leaderboard();
      assert(data === null, 'a round that has not started is no round to show, got ' + JSON.stringify(data));
    }
    console.log('PASS - with only a future round the response is still null');

    // ── Closed rounds: the most recent end wins, not the highest number ──
    // Round 9 ended 20 days ago, round 4 ended 2 days ago.
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (9, datetime('now','-27 days'), datetime('now','-20 days'))").run();
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (4, datetime('now','-9 days'), datetime('now','-2 days'))").run();
    insertWork(db, { slug: 'r9-work', title: 'Round Nine', artist: 'Artist Nine', roundNumber: 9, viewCount: 500, status: 'archived', viewCountAtArchive: 500 });

    // Round 4: eleven archived works with frozen counts 10..20, one archived work
    // whose live count (1000) rose far above its frozen count (0), plus works
    // that must never appear.
    for (let i = 0; i <= 10; i++) {
      insertWork(db, { slug: `r4-w${i}`, title: `R4 Work ${i}`, artist: `Artist ${i}`, roundNumber: 4, viewCount: 10 + i + 5, status: 'archived', viewCountAtArchive: 10 + i });
    }
    const lateGainerId = insertWork(db, { slug: 'r4-late-gainer', title: 'Late Gainer', artist: 'Artist Late', roundNumber: 4, viewCount: 1000, status: 'archived', viewCountAtArchive: 0 });
    insertWork(db, { slug: 'r4-pending', title: 'Pending', artist: 'Artist Pending', roundNumber: 4, reviewStatus: 'pending', viewCount: 999 });
    insertWork(db, { slug: 'r4-rejected', title: 'Rejected', artist: 'Artist Rejected', roundNumber: 4, reviewStatus: 'rejected', viewCount: 999 });
    insertWork(db, { slug: 'no-round', title: 'No Round', artist: 'Artist None', roundNumber: null, viewCount: 999 });

    {
      const data = await leaderboard();
      assert(data && data.status === 'closed' && data.round_number === 4, `with no running round the most recently ended round (4, not 9) is shown as closed, got ${JSON.stringify(data && { r: data.round_number, s: data.status })}`);
      assertNoNumbers(data);
      assert(data.works.length === 10, `a closed round shows 10 works even though they are all archived, got ${data.works.length}`);
      assert(data.winner === null, 'without an announced winner, winner is null, got ' + JSON.stringify(data.winner));
      const slugs = new Set(data.works.map(w => w.slug));
      for (const bad of ['r9-work', 'r4-pending', 'r4-rejected', 'no-round']) assert(!slugs.has(bad), `${bad} is not in the closed round's list`);
      assert(!slugs.has('r4-late-gainer'), 'a work whose views grew after archiving does not climb: its frozen count of 0 keeps it out of the top 10');
      assert(!slugs.has('r4-w0'), 'the lowest frozen count (10) of eleven candidates drops out, leaving the ten highest frozen counts');
    }
    console.log('PASS - without a running round the most recently ended round is shown (by ends_at), as closed, with archived works');
    console.log('PASS - a closed round selects on the frozen view_count_at_archive, so late views do not change the top 10');

    // ── Winner ──────────────────────────────────────────────────────────
    {
      // announced but the chosen work is unapproved: no winner shown
      const pendingId = db.prepare("SELECT id FROM works WHERE slug='r4-pending'").get().id;
      db.prepare("UPDATE rounds SET winner_work_id=?, announced_at=datetime('now') WHERE round_number=4").run(pendingId);
      let data = await leaderboard();
      assert(data.winner === null, 'a winner whose work is not approved is not shown, got ' + JSON.stringify(data.winner));

      // chosen but not announced: no winner shown
      const w3 = db.prepare("SELECT id FROM works WHERE slug='r4-w3'").get().id;
      db.prepare("UPDATE rounds SET winner_work_id=?, announced_at=NULL WHERE round_number=4").run(w3);
      data = await leaderboard();
      assert(data.winner === null, 'a chosen but not yet announced winner is not shown, got ' + JSON.stringify(data.winner));

      db.prepare("UPDATE rounds SET announced_at=datetime('now') WHERE round_number=4").run();
      data = await leaderboard();
      assertNoNumbers(data);
      assert(data.winner && data.winner.slug === 'r4-w3' && data.winner.title === 'R4 Work 3' && data.winner.artist === 'Artist 3', 'an announced winner is returned as slug/title/artist, got ' + JSON.stringify(data.winner));
    }
    console.log('PASS - the announced winner of the round is included; unannounced or unapproved winners are not');

    // ── Shuffle on a closed round ───────────────────────────────────────
    {
      let sawDifferentOrder = false;
      const first = JSON.stringify((await leaderboard()).works.map(w => w.slug));
      for (let i = 0; i < 30 && !sawDifferentOrder; i++) {
        sawDifferentOrder = JSON.stringify((await leaderboard()).works.map(w => w.slug)) !== first;
      }
      assert(sawDifferentOrder, 'across 31 requests the order of a closed round changes, shuffling is happening');
    }
    console.log('PASS - the order of a closed round varies between requests');

    // ── Running round takes over from the closed one ────────────────────
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (1, datetime('now','-2 days'), datetime('now','+5 days'))").run();
    insertWork(db, { slug: 'r1-approved-high', title: 'High', artist: 'Artist High', roundNumber: 1, viewCount: 50 });
    insertWork(db, { slug: 'r1-approved-mid', title: 'Mid', artist: 'Artist Mid', roundNumber: 1, viewCount: 30 });
    insertWork(db, { slug: 'r1-approved-low', title: 'Low', artist: 'Artist Low', roundNumber: 1, viewCount: 10 });
    insertWork(db, { slug: 'r1-pending', title: 'Pending', artist: 'Artist Pending', roundNumber: 1, reviewStatus: 'pending', viewCount: 999 });
    insertWork(db, { slug: 'r1-rejected', title: 'Rejected', artist: 'Artist Rejected', roundNumber: 1, reviewStatus: 'rejected', viewCount: 999 });

    {
      const data = await leaderboard();
      assert(data.status === 'running' && data.round_number === 1, `a running round is shown as running and wins over the closed ones, got ${data.status} ${data.round_number}`);
      assertNoNumbers(data);
      const slugs = data.works.map(w => w.slug).sort();
      assert(JSON.stringify(slugs) === JSON.stringify(['r1-approved-high', 'r1-approved-low', 'r1-approved-mid']),
        'only the 3 approved works of the running round appear, got ' + JSON.stringify(slugs));
      assert(data.works.length === 3, 'fewer than 10 works: no padding');
      assert(data.winner === null, 'a running round has no winner');
    }
    console.log('PASS - a running round is shown as running with only its approved works, no padding, no winner');

    {
      const sortedDesc = JSON.stringify(['r1-approved-high', 'r1-approved-mid', 'r1-approved-low']);
      let sawDifferentOrder = false;
      for (let i = 0; i < 30; i++) {
        const order = JSON.stringify((await leaderboard()).works.map(w => w.slug));
        if (order !== sortedDesc) { sawDifferentOrder = true; break; }
      }
      assert(sawDifferentOrder, 'across 30 requests at least one order differs from the view_count-descending order');
    }
    console.log('PASS - the order of a running round varies, never consistently sorted by view_count');

    for (let i = 0; i < 12; i++) {
      insertWork(db, { slug: `r1-extra-${i}`, title: `Extra ${i}`, artist: `Artist ${i}`, roundNumber: 1, viewCount: i });
    }
    {
      const data = await leaderboard();
      assert(data.works.length === 10, `at most 10 works are returned, got ${data.works.length}`);
      const slugs = new Set(data.works.map(w => w.slug));
      for (const excluded of ['r1-extra-0', 'r1-extra-1', 'r1-extra-2', 'r1-extra-3', 'r1-extra-4']) {
        assert(!slugs.has(excluded), `the lowest-viewed works are not among the top 10, found ${excluded}`);
      }
    }
    console.log('PASS - a running round with more than 10 approved works is cut to the top 10 by live view_count');

    db.close();
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
