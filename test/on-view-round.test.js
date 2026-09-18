'use strict';
/*
 * GET /api/on-view/round feeds the Submissions cell of the homepage open-call
 * hero: the active round's number and window (ISO 8601, UTC), or null when no
 * round is active. It must expose nothing else (no view counts, no winner).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.on-view-round-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.on-view-round-test-uploads');
const PORT = 3192;
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

async function getRound() {
  const r = await fetch(`${BASE}/api/on-view/round`);
  assert(r.status === 200, `GET /api/on-view/round responds 200 — got ${r.status}`);
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

    // No active round: null (not a 404)
    assert((await getRound()) === null, 'no active round returns null');
    console.log('PASS - no active round returns null, not a 404');

    // An ended round and a future round are not active either
    {
      const db = new Database(DB_PATH);
      db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (1, datetime('now','-20 days'), datetime('now','-10 days'))").run();
      db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (3, datetime('now','+10 days'), datetime('now','+17 days'))").run();
      db.close();
    }
    assert((await getRound()) === null, 'only past and future rounds: still null');
    console.log('PASS - past and future rounds do not count as active');

    // Active round: number and window, ISO 8601 UTC
    {
      const db = new Database(DB_PATH);
      db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (2, '2026-09-18 11:46:29', '2099-09-25 11:46:29')").run();
      db.close();
    }
    {
      const j = await getRound();
      assert(j && j.round_number === 2, `the active round's number is returned — got ${JSON.stringify(j)}`);
      assert(j.starts_at === '2026-09-18T11:46:29Z', `starts_at is ISO 8601 UTC — got ${j.starts_at}`);
      assert(j.ends_at === '2099-09-25T11:46:29Z', `ends_at is ISO 8601 UTC — got ${j.ends_at}`);
    }
    console.log('PASS - the active round returns its number and its window as ISO 8601 UTC');

    // Nothing else leaks: only those three fields, no view counts or winner data
    {
      const db = new Database(DB_PATH);
      db.prepare("UPDATE rounds SET winner_work_id=1, announced_at=datetime('now') WHERE round_number=2").run();
      db.close();
      const j = await getRound();
      assert(JSON.stringify(Object.keys(j).sort()) === JSON.stringify(['ends_at', 'round_number', 'starts_at']),
        `the response has exactly round_number, starts_at, ends_at — got ${Object.keys(j)}`);
      assert(!/view|winner|announced/i.test(JSON.stringify(j)), 'the response contains no view counts or winner data');
    }
    console.log('PASS - the response exposes only round_number, starts_at and ends_at, no view counts');

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
