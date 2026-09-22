'use strict';
/*
 * Shuffled selection of up to 4 works for the homepage "Currently on view"
 * tiles (GET /api/on-view/tiles). A fixed "newest first" order would
 * structurally favour those works with more views — unfair now that views
 * decide the round winner — so the set (and its order) is reshuffled
 * server-side on every request, from every approved, non-archived work.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.on-view-tiles-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.on-view-tiles-test-uploads');
const PORT = 3191;
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

function insertWork(db, { slug, reviewStatus, status }) {
  db.prepare(
    "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,approved_at) " +
    "VALUES (?,?,?,?,?,?,?,CASE WHEN ?='approved' THEN datetime('now') ELSE NULL END)"
  ).run(slug, 'Title ' + slug, 'Artist ' + slug, '#', `/uploads/${slug}.webp`, status, reviewStatus, reviewStatus);
}

async function tiles() {
  const r = await fetch(`${BASE}/api/on-view/tiles`);
  assert(r.status === 200, `GET /api/on-view/tiles responds 200 — got ${r.status}`);
  return r.json();
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

    // The server seeds public/data/works.json into a fresh DB at startup
    // (approved mock works) — neutralize those first so this test controls
    // exactly what's eligible, same as archiveOldWorks() would once they age out.
    {
      const seedDb = new Database(DB_PATH);
      seedDb.prepare("UPDATE works SET status='archived'").run();
      seedDb.close();
    }

    // 0 works: empty array, not a 404
    {
      const rows = await tiles();
      assert(Array.isArray(rows) && rows.length === 0, `no works at all returns an empty array — got ${JSON.stringify(rows)}`);
    }
    console.log('PASS - 0 available works returns an empty array');

    // 1 work: exactly that one, no padding
    const db = new Database(DB_PATH);
    insertWork(db, { slug: 'solo', reviewStatus: 'approved', status: 'previous' });
    insertWork(db, { slug: 'still-pending', reviewStatus: 'pending', status: 'previous' });
    insertWork(db, { slug: 'was-rejected', reviewStatus: 'rejected', status: 'previous' });
    insertWork(db, { slug: 'long-gone', reviewStatus: 'approved', status: 'archived' });
    db.close();
    {
      const rows = await tiles();
      assert(rows.length === 1 && rows[0].slug === 'solo', `with 1 eligible work, exactly that one is returned — got ${JSON.stringify(rows)}`);
    }
    console.log('PASS - 1 available work returns exactly that one, no padding; pending/rejected/archived are excluded');

    // 4 works: all 4, no duplicates
    const db2 = new Database(DB_PATH);
    for (const slug of ['w2', 'w3', 'w4']) insertWork(db2, { slug, reviewStatus: 'approved', status: 'previous' });
    db2.close();
    {
      const rows = await tiles();
      const slugs = rows.map(w => w.slug).sort();
      assert(JSON.stringify(slugs) === JSON.stringify(['solo', 'w2', 'w3', 'w4']), `with exactly 4 eligible works, all 4 are returned — got ${JSON.stringify(slugs)}`);
      assert(new Set(slugs).size === slugs.length, 'no duplicate work in the response');
    }
    console.log('PASS - 4 available works returns all 4, no duplicates');

    // More than 4: capped at 4, still no duplicates, and the set/order is not
    // always identical across requests (the actual randomness check).
    const db3 = new Database(DB_PATH);
    for (const slug of ['w5', 'w6', 'w7', 'w8']) insertWork(db3, { slug, reviewStatus: 'approved', status: 'previous' });
    db3.close();
    {
      const seen = [];
      for (let i = 0; i < 20; i++) {
        const rows = await tiles();
        assert(rows.length === 4, `with 8 eligible works, exactly 4 are returned each time — got ${rows.length}`);
        const slugs = rows.map(w => w.slug);
        assert(new Set(slugs).size === 4, `no duplicate work within one response — got ${JSON.stringify(slugs)}`);
        seen.push(JSON.stringify(slugs));
      }
      assert(new Set(seen).size > 1, 'across 20 requests, at least two different sets/orders of 4 appeared — the selection is not fixed');
    }
    console.log('PASS - with more than 4 eligible works, each response has exactly 4 distinct works, and the set/order varies across requests');

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
