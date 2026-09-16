'use strict';
/*
 * Epic 2: every new submission requires approval before it goes live.
 * works.review_status (pending/approved/rejected) is separate from the
 * existing lifecycle status (current/previous/archived) — a submission can
 * be 'previous' + 'pending' at the same time. Covers: a /hand-in submission
 * starts pending and is invisible everywhere public (GET /api/works,
 * GET /api/works/:slug, GET /work/:slug — all three behave exactly like an
 * unknown slug); approving sets review_status=approved + records
 * approved_at and makes the work visible everywhere; rejecting sets
 * review_status=rejected and the work stays invisible; and a database that
 * predates this migration gets its existing rows grandfathered in as
 * approved (approved_at stays null, not reconstructable).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.review-status-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.review-status-test-uploads');
const LEGACY_DB_PATH = path.join(ROOT, 'test', '.review-status-legacy-test.db');
const LEGACY_UPLOAD_DIR = path.join(ROOT, 'test', '.review-status-legacy-test-uploads');
const PORT = 3196;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'test-admin-pwd';

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function cleanupFiles() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', LEGACY_DB_PATH, LEGACY_DB_PATH + '-wal', LEGACY_DB_PATH + '-shm']) {
    fs.rmSync(f, { force: true });
  }
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.rmSync(LEGACY_UPLOAD_DIR, { recursive: true, force: true });
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

function startServer(dbPath, uploadDir) {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH: dbPath, UPLOAD_DIR: uploadDir, PORT: String(PORT), ADMIN_PASSWORD },
    stdio: 'ignore',
  });
}

async function adminAuth() {
  const r = await fetch(`${BASE}/api/admin/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const { token } = await r.json();
  return token;
}

async function createHandInToken(adminToken, name, email) {
  const r = await fetch(`${BASE}/api/admin/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
    body: JSON.stringify({ artist_name: name, artist_email: email }),
  });
  const { token } = await r.json();
  return token;
}

async function submitHandIn(handInToken, title, imageBuf) {
  const form = new FormData();
  form.append('work_title', title);
  form.append('image', new Blob([imageBuf], { type: 'image/webp' }), 'test.webp');
  return fetch(`${BASE}/hand-in/${handInToken}`, { method: 'POST', body: form });
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    // ── Migration: rows predating the review step are grandfathered as approved ──
    {
      const legacyDb = new Database(LEGACY_DB_PATH);
      legacyDb.exec(`
        CREATE TABLE works (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          slug       TEXT UNIQUE NOT NULL,
          title      TEXT NOT NULL,
          artist     TEXT NOT NULL,
          email      TEXT NOT NULL DEFAULT '',
          portfolio  TEXT NOT NULL DEFAULT '#',
          image_url  TEXT NOT NULL,
          status     TEXT NOT NULL DEFAULT 'previous' CHECK(status IN ('current','previous','archived')),
          view_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      legacyDb.prepare(
        'INSERT INTO works (slug,title,artist,portfolio,image_url,status) VALUES (?,?,?,?,?,?)'
      ).run('legacy-pre-migration-work', 'Legacy Work', 'Legacy Artist', '#', '/uploads/legacy.webp', 'previous');
      legacyDb.close();
    }

    child = startServer(LEGACY_DB_PATH, LEGACY_UPLOAD_DIR);
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 500)); // let startup migrations land

    {
      const db = new Database(LEGACY_DB_PATH);
      const row = db.prepare('SELECT review_status, approved_at FROM works WHERE slug=?').get('legacy-pre-migration-work');
      db.close();
      assert(row.review_status === 'approved', `a pre-existing row (predating the review step) is grandfathered as approved — got ${row.review_status}`);
      assert(row.approved_at === null, 'a grandfathered row has no approved_at — got ' + row.approved_at);
    }
    console.log('PASS - migration: rows from before this feature get review_status=approved, approved_at stays null');

    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // ── Main flow ──────────────────────────────────────────────────────────
    child = startServer(DB_PATH, UPLOAD_DIR);
    await waitForServer(30);

    const adminToken = await adminAuth();
    assert(!!adminToken, 'admin auth succeeds');

    const imageBuf = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 100, g: 120, b: 200 } },
    }).webp().toBuffer();

    // A new /hand-in submission is pending
    const handInToken = await createHandInToken(adminToken, 'Pending Artist', 'pending-artist@example.com');
    const handInRes = await submitHandIn(handInToken, 'Pending Test Work', imageBuf);
    const handInJson = await handInRes.json();
    assert(handInRes.status === 200 && handInJson.ok, 'hand-in submission is accepted');

    let work;
    {
      const db = new Database(DB_PATH);
      work = db.prepare("SELECT * FROM works WHERE title='Pending Test Work'").get();
      db.close();
    }
    assert(!!work, 'the hand-in created a work row');
    assert(work.review_status === 'pending', `a new /hand-in submission is review_status=pending — got ${work.review_status}`);
    assert(work.approved_at === null, 'a pending submission has no approved_at yet');
    console.log('PASS - a new /hand-in submission gets review_status=pending');

    // Invisible everywhere public
    {
      const listRes = await fetch(`${BASE}/api/works`);
      const list = await listRes.json();
      assert(!list.some(w => w.slug === work.slug), 'pending work is absent from GET /api/works');

      const apiRes = await fetch(`${BASE}/api/works/${work.slug}`);
      assert(apiRes.status === 404, `GET /api/works/:slug returns 404 for a pending work — got ${apiRes.status}`);

      const pageRes = await fetch(`${BASE}/work/${work.slug}`);
      assert(pageRes.status === 200, 'GET /work/:slug still responds 200 (existing not-found shell)');
      const html = await pageRes.text();
      assert(html.includes('Work not found'), 'GET /work/:slug renders the existing "not found" state for a pending work');
    }
    console.log('PASS - a pending work is unreachable via GET /api/works, /api/works/:slug and /work/:slug — same as an unknown slug');

    // Approve it
    {
      const r = await fetch(`${BASE}/api/admin/works/${work.id}/approve`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + adminToken },
      });
      const j = await r.json();
      assert(r.status === 200 && j.ok, 'approve request succeeds');
    }
    {
      const db = new Database(DB_PATH);
      const row = db.prepare('SELECT review_status, approved_at FROM works WHERE id=?').get(work.id);
      db.close();
      assert(row.review_status === 'approved', `approve sets review_status=approved — got ${row.review_status}`);
      assert(!!row.approved_at, 'approve records approved_at');
    }
    console.log('PASS - approving a pending work sets review_status=approved and records approved_at');

    // Now visible everywhere
    {
      const listRes = await fetch(`${BASE}/api/works`);
      const list = await listRes.json();
      assert(list.some(w => w.slug === work.slug), 'approved work now appears in GET /api/works');

      const apiRes = await fetch(`${BASE}/api/works/${work.slug}`);
      assert(apiRes.status === 200, `GET /api/works/:slug now returns 200 for the approved work — got ${apiRes.status}`);

      const pageRes = await fetch(`${BASE}/work/${work.slug}`);
      const html = await pageRes.text();
      assert(html.includes('Pending Test Work by Pending Artist'), 'GET /work/:slug now renders the real title for the approved work');
    }
    console.log('PASS - an approved work appears in the wall listing and is reachable via /api/works/:slug and /work/:slug');

    // ── Reject path ──────────────────────────────────────────────────────
    const handInToken2 = await createHandInToken(adminToken, 'Rejected Artist', 'rejected-artist@example.com');
    await submitHandIn(handInToken2, 'Rejected Test Work', imageBuf);

    let rejected;
    {
      const db = new Database(DB_PATH);
      rejected = db.prepare("SELECT * FROM works WHERE title='Rejected Test Work'").get();
      db.close();
    }
    assert(!!rejected, 'the second hand-in created a work row');

    {
      const r = await fetch(`${BASE}/api/admin/works/${rejected.id}/reject`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + adminToken },
      });
      const j = await r.json();
      assert(r.status === 200 && j.ok, 'reject request succeeds');
    }
    {
      const db = new Database(DB_PATH);
      const row = db.prepare('SELECT review_status FROM works WHERE id=?').get(rejected.id);
      db.close();
      assert(row.review_status === 'rejected', `reject sets review_status=rejected — got ${row.review_status}`);
    }
    console.log('PASS - rejecting a pending work sets review_status=rejected');

    {
      const listRes = await fetch(`${BASE}/api/works`);
      const list = await listRes.json();
      assert(!list.some(w => w.slug === rejected.slug), 'rejected work never appears in GET /api/works');

      const apiRes = await fetch(`${BASE}/api/works/${rejected.slug}`);
      assert(apiRes.status === 404, `GET /api/works/:slug returns 404 for a rejected work — got ${apiRes.status}`);

      const pageRes = await fetch(`${BASE}/work/${rejected.slug}`);
      const html = await pageRes.text();
      assert(html.includes('Work not found'), 'GET /work/:slug renders "not found" for a rejected work');
    }
    console.log('PASS - a rejected work is never listed and stays unreachable, same as an unknown slug');

    // Admin API exposes review_status on every row (the panel groups by it)
    {
      const r = await fetch(`${BASE}/api/admin/works`, { headers: { Authorization: 'Bearer ' + adminToken } });
      const rows = await r.json();
      assert(rows.length > 0, 'admin API returns rows');
      assert(rows.every(w => ['pending', 'approved', 'rejected'].includes(w.review_status)), 'every admin row carries a valid review_status');
    }
    console.log('PASS - admin API exposes a valid review_status on every row');

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
