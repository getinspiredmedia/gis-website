'use strict';
/*
 * GET /api/on-view/previous-winner feeds the homepage hero: the most recently
 * announced round winner (highest round number with a winner), public fields
 * only, or null when no winner has been announced yet.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.previous-winner-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.previous-winner-test-uploads');
const PORT = 3200;
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

async function getWinner() {
  const r = await fetch(`${BASE}/api/on-view/previous-winner`);
  assert(r.status === 200, `GET /api/on-view/previous-winner responds 200 — got ${r.status}`);
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

    const db = new Database(DB_PATH);
    const addWork = (slug, reviewStatus, views) => db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,view_count) VALUES (?,?,?,?,?,?,?,?)"
    ).run(slug, 'Title ' + slug, 'Artist ' + slug, '#', `/uploads/${slug}.webp`, 'archived', reviewStatus, views).lastInsertRowid;

    // No winner announced: null (not a 404), also with rounds that have none yet
    assert((await getWinner()) === null, 'no rounds at all returns null');
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (1, datetime('now','-20 days'), datetime('now','-10 days'))").run();
    assert((await getWinner()) === null, 'a round without an announced winner returns null');
    console.log('PASS - no announced winner returns null, not a 404');

    // A winner chosen but not announced yet does not count
    const w1 = addWork('winner-one', 'approved', 42);
    db.prepare('UPDATE rounds SET winner_work_id=? WHERE round_number=1').run(w1);
    assert((await getWinner()) === null, 'winner_work_id without announced_at returns null');

    // One announced winner: correct fields, no view counts
    db.prepare("UPDATE rounds SET announced_at=datetime('now') WHERE round_number=1").run();
    {
      const j = await getWinner();
      assert(j && j.round_number === 1 && j.slug === 'winner-one' && j.title === 'Title winner-one' &&
        j.artist === 'Artist winner-one' && j.image_url === '/uploads/winner-one.webp',
        `one announced winner returns its round and work fields — got ${JSON.stringify(j)}`);
      assert(JSON.stringify(Object.keys(j).sort()) === JSON.stringify(['artist', 'image_url', 'round_number', 'slug', 'title']),
        `only public fields are exposed — got ${Object.keys(j)}`);
    }
    console.log('PASS - one announced winner returns round_number, slug, title, artist, image_url and nothing else');

    // Two rounds with winners: the highest round number wins, even when it was announced first
    const w3 = addWork('winner-three', 'approved', 1);
    const w2 = addWork('winner-two', 'approved', 999);
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at, winner_work_id, announced_at) VALUES (3, datetime('now','-9 days'), datetime('now','-2 days'), ?, datetime('now','-3 days'))").run(w3);
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at, winner_work_id, announced_at) VALUES (2, datetime('now','-10 days'), datetime('now','-9 days'), ?, datetime('now'))").run(w2);
    {
      const j = await getWinner();
      assert(j.round_number === 3 && j.slug === 'winner-three', `the highest round with a winner is returned, not the latest announced — got ${JSON.stringify(j)}`);
    }
    console.log('PASS - two rounds with winners return the winner of the highest round number');

    // A winner whose work is no longer approved is skipped, falling back to the next round
    db.prepare("UPDATE works SET review_status='rejected' WHERE id=?").run(w3);
    assert((await getWinner()).round_number === 2, 'a winner that is no longer approved is skipped');
    db.prepare('DELETE FROM works WHERE id=?').run(w2);
    assert((await getWinner()).round_number === 1, 'a winner whose work was deleted is skipped');
    console.log('PASS - a non-approved or deleted winner work is skipped');

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
