'use strict';
/*
 * GET /api/on-view/closing feeds the homepage "closing" hero: the round that
 * closed most recently, for 7 days after it ended and only while no round is
 * active. { round_number, ends_at, show_until } (ISO 8601, UTC), otherwise null.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.on-view-closing-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.on-view-closing-test-uploads');
const PORT = 3204;
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

async function getClosing() {
  const r = await fetch(`${BASE}/api/on-view/closing`);
  assert(r.status === 200, `GET /api/on-view/closing responds 200 — got ${r.status}`);
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
    const reset = () => db.prepare('DELETE FROM rounds').run();
    const add = (n, startsMod, endsMod) => db.prepare(
      "INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (?, datetime('now', ?), datetime('now', ?))"
    ).run(n, startsMod, endsMod);

    // No rounds at all: null (not a 404)
    assert((await getClosing()) === null, 'no rounds returns null');
    console.log('PASS - no rounds returns null, not a 404');

    // An active round: null, even when an earlier round closed a day ago
    add(1, '-9 days', '-1 day');
    add(2, '-1 day', '+6 days');
    assert((await getClosing()) === null, 'an active round returns null');
    console.log('PASS - while a round is active the answer is null, whatever closed before it');

    // Only future rounds: null
    reset();
    add(3, '+2 days', '+9 days');
    assert((await getClosing()) === null, 'only future rounds returns null');
    console.log('PASS - only future rounds returns null');

    // Closed 3 days ago, nothing active: the round, with the three fields only
    reset();
    add(4, '-10 days', '-3 days');
    {
      const row = db.prepare('SELECT ends_at FROM rounds WHERE round_number=4').get();
      const iso = t => t.replace(' ', 'T') + 'Z';
      const expectedUntil = new Date(new Date(iso(row.ends_at)).getTime() + 7 * 24 * 3600 * 1000).toISOString().replace('.000Z', 'Z');
      const got = await getClosing();
      assert(got && got.round_number === 4, `a round closed 3 days ago is returned — got ${JSON.stringify(got)}`);
      assert(got.ends_at === iso(row.ends_at), `ends_at is ISO 8601 UTC — got ${got.ends_at}`);
      assert(got.show_until === expectedUntil, `show_until is ends_at plus 7 days — got ${got.show_until}, expected ${expectedUntil}`);
      assert(JSON.stringify(Object.keys(got).sort()) === JSON.stringify(['ends_at', 'round_number', 'show_until']), `only round_number, ends_at and show_until — got ${Object.keys(got)}`);
    }
    console.log('PASS - a round that closed 3 days ago is returned with round_number, ends_at and show_until (ends_at + 7 days) and nothing else');

    // Just inside, exactly on and past the 7 days
    reset();
    add(5, '-20 days', '-6 days');
    db.prepare("UPDATE rounds SET ends_at = datetime('now', '-6 days', '-23 hours') WHERE round_number=5").run();
    assert((await getClosing()) !== null, 'closed 6 days 23 hours ago is still inside the window');
    db.prepare("UPDATE rounds SET ends_at = datetime('now', '-7 days') WHERE round_number=5").run();
    assert((await getClosing()) === null, 'closed exactly 7 days ago is outside the window');
    db.prepare("UPDATE rounds SET ends_at = datetime('now', '-8 days') WHERE round_number=5").run();
    assert((await getClosing()) === null, 'closed 8 days ago is outside the window');
    console.log('PASS - 6 days 23 hours after closing: object; exactly 7 days and 8 days after: null');

    // Several closed rounds: the one with the latest ends_at, not the highest number
    reset();
    add(9, '-30 days', '-12 days');
    add(2, '-9 days', '-2 days');
    add(7, '-20 days', '-10 days');
    {
      const got = await getClosing();
      assert(got && got.round_number === 2, `the most recently closed round wins — got ${JSON.stringify(got)}`);
    }
    console.log('PASS - with several closed rounds the most recently closed one is returned');

    // An older closed round never shows once the latest one is out of its window
    reset();
    add(1, '-30 days', '-20 days');
    add(2, '-19 days', '-9 days');
    assert((await getClosing()) === null, 'the latest closed round is out of the window, an older one does not take its place');
    console.log('PASS - when the latest closed round is outside the window, an older one does not take its place');

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
