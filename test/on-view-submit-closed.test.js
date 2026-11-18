'use strict';
/*
 * The On View weekly open call has ended. POST /api/submit refuses every
 * new submission (410, before the upload middleware even runs, so no file
 * is written and no row is created), regardless of honeypot/rate limit —
 * those no longer matter since nothing gets past the closed check.
 * /on-view/submit and /submit/:token both redirect to the current open
 * call at /submit. /on-view and /work/:slug are untouched.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.on-view-submit-closed-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.on-view-submit-closed-test-uploads');
const PORT = 3214;
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
      fetch(BASE + '/').then(r => (r.ok ? resolve() : retry(n))).catch(() => retry(n));
    };
    const retry = (n) => {
      if (n <= 0) return reject(new Error('server did not come up'));
      setTimeout(() => attempt(n - 1), 300);
    };
    attempt(retries);
  });
}

function workCount() {
  const db = new Database(DB_PATH);
  const n = db.prepare('SELECT COUNT(*) AS n FROM works').get().n;
  db.close();
  return n;
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

    const before = workCount();

    // A well-formed submission attempt, no honeypot — still refused.
    {
      const form = new FormData();
      form.append('name', 'Closed Call Artist');
      form.append('email', 'closed-call@example.com');
      form.append('portfolio', 'https://example.com');
      form.append('work_title', 'Closed Call Work');
      form.append('hp', '');
      form.append('image', new Blob([Buffer.from([0])], { type: 'image/webp' }), 'test.webp');
      const r = await fetch(`${BASE}/api/submit`, { method: 'POST', body: form });
      const j = await r.json();
      assert(r.status === 410, `POST /api/submit is refused with 410 — got ${r.status}`);
      assert(!!j.error, 'the response carries an error message');
    }
    assert(workCount() === before, 'no work row was created by the refused submission');
    console.log('PASS - POST /api/submit refuses every submission with 410 and creates no row');

    // An honeypot-filled request is refused the same way, before any of
    // that gating logic ever runs.
    {
      const form = new FormData();
      form.append('name', 'Bot');
      form.append('email', 'bot@example.com');
      form.append('portfolio', 'https://example.com');
      form.append('work_title', 'Bot Work');
      form.append('hp', 'filled-in');
      const r = await fetch(`${BASE}/api/submit`, { method: 'POST', body: form });
      assert(r.status === 410, `a honeypot-filled request is still refused with 410, not silently accepted — got ${r.status}`);
    }
    assert(workCount() === before, 'still no work row after the second refused attempt');
    console.log('PASS - the closed check runs before the honeypot gate, not after');

    for (const p of ['/on-view/submit', '/on-view/submit/']) {
      const r = await fetch(`${BASE}${p}`, { redirect: 'manual' });
      assert(r.status === 301 && r.headers.get('location') === '/submit', `GET ${p} redirects 301 to /submit — got ${r.status} ${r.headers.get('location')}`);
    }
    console.log('PASS - /on-view/submit and /on-view/submit/ redirect 301 to /submit');

    {
      const r = await fetch(`${BASE}/submit/some-old-token`, { redirect: 'manual' });
      assert(r.status === 301 && r.headers.get('location') === '/submit', `GET /submit/:token still redirects 301 to /submit — got ${r.status} ${r.headers.get('location')}`);
    }
    console.log('PASS - /submit/:token still redirects to /submit');

    // /on-view itself is untouched.
    {
      const r = await fetch(`${BASE}/on-view`);
      assert(r.status === 200, `/on-view still responds 200 — got ${r.status}`);
    }
    console.log('PASS - /on-view is unaffected');

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
