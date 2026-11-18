'use strict';
/*
 * Epic 2: every new submission requires approval before it goes live.
 * works.review_status (pending/approved/rejected) is separate from the
 * existing lifecycle status (current/previous/archived) — a submission can
 * be 'previous' + 'pending' at the same time. POST /api/submit (the only
 * path that used to create a pending row) is closed now that the On View
 * weekly open call has ended (see test/on-view-submit-closed.test.js), so
 * pending rows here are seeded directly in the database, standing in for
 * work submitted while the call was still open. Covers: a pending work is
 * invisible everywhere public (GET /api/works, GET /api/works/:slug,
 * GET /work/:slug — all three behave exactly like an unknown slug);
 * approving sets review_status=approved + records approved_at and makes
 * the work visible everywhere; rejecting sets review_status=rejected and
 * the work stays invisible; and a database that predates this migration
 * gets its existing rows grandfathered in as approved (approved_at stays
 * null, not reconstructable).
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.review-status-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.review-status-test-uploads');
const LEGACY_DB_PATH = path.join(ROOT, 'test', '.review-status-legacy-test.db');
const LEGACY_UPLOAD_DIR = path.join(ROOT, 'test', '.review-status-legacy-test-uploads');
const PORT = 3196;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'test-admin-pwd';
const SITE_URL = 'https://getinspiredsociety.test';

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

function startServer(dbPath, uploadDir, fixturePort) {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH: dbPath,
      UPLOAD_DIR: uploadDir,
      PORT: String(PORT),
      ADMIN_PASSWORD,
      SITE_URL,
      RESEND_API_KEY: 'test-key',
      RESEND_BASE_URL: `http://127.0.0.1:${fixturePort}`,
    },
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

// POST /api/submit is closed (the On View weekly open call has ended, see
// test/on-view-submit-closed.test.js), so a pending row is seeded directly,
// standing in for a work submitted while the call was still open.
function seedPending(dbPath, { name, email, title, portfolio = 'https://example.com' }) {
  const db = new Database(dbPath);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const id = db.prepare(
    "INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status) VALUES (?,?,?,?,?,?,?,?)"
  ).run(slug, title, name, email, portfolio, '/uploads/test.webp', 'previous', 'pending').lastInsertRowid;
  db.close();
  return id;
}


async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  // RESEND_BASE_URL redirected to a local fixture standing in for
  // api.resend.com — the real host is unreachable from this sandbox, same
  // pattern as test/archive-email.test.js.
  const emailRequests = [];
  const fixture = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/emails') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        emailRequests.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'test-email-id' }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixturePort = fixture.address().port;

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

    child = startServer(LEGACY_DB_PATH, LEGACY_UPLOAD_DIR, fixturePort);
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
    child = startServer(DB_PATH, UPLOAD_DIR, fixturePort);
    await waitForServer(30);

    const adminToken = await adminAuth();
    assert(!!adminToken, 'admin auth succeeds');

    // A pending work, seeded directly (the submission endpoint that used
    // to create one is closed, see test/on-view-submit-closed.test.js)
    const workId = seedPending(DB_PATH, { name: 'Pending Artist', email: 'pending-artist@example.com', title: 'Pending Test Work' });

    let work;
    {
      const db = new Database(DB_PATH);
      work = db.prepare('SELECT * FROM works WHERE id=?').get(workId);
      db.close();
    }
    assert(!!work, 'the seeded work row exists');
    assert(work.review_status === 'pending', `a pending work is review_status=pending, got ${work.review_status}`);
    assert(work.approved_at === null, 'a pending work has no approved_at yet');
    console.log('PASS - a pending work has review_status=pending and no approved_at');

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

    // The approval mail is switched off (see test:approve-email) — approving
    // still works, it just sends nothing.
    assert(!emailRequests.some(m => m.subject === 'Your work is on the wall, Get Inspired Society'), 'approving sends no mail');
    console.log('PASS - approving a work sends no mail');

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
    const rejectedId = seedPending(DB_PATH, { name: 'Rejected Artist', email: 'rejected-artist@example.com', title: 'Rejected Test Work' });

    let rejected;
    {
      const db = new Database(DB_PATH);
      rejected = db.prepare('SELECT * FROM works WHERE id=?').get(rejectedId);
      db.close();
    }
    assert(!!rejected, 'the second seeded work row exists');

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

    // Reject triggers an email to the maker with the agreed text — no reason given
    {
      const mail = emailRequests.find(m => m.subject === 'Your submission, Get Inspired Society');
      assert(!!mail, 'a reject email was sent — got subjects: ' + JSON.stringify(emailRequests.map(m => m.subject)));
      assert(mail.to === rejected.email || (Array.isArray(mail.to) && mail.to.includes(rejected.email)),
        'the reject email is addressed to the maker — got ' + JSON.stringify(mail.to));
      assert(mail.html.includes("Thanks for sharing your work. We're not able to feature it on On View this time. We'd love to see what you submit next."),
        'the reject email uses the agreed text exactly — got ' + mail.html);
      assert(mail.html.includes('Creative regards') && mail.html.includes('Get Inspired Society'),
        'the reject email closes with "Creative regards, Get Inspired Society" — got ' + mail.html);
      assert(mail.html.startsWith('<p>Hi Rejected Artist,</p>'), 'the reject email greets "Hi {artist}," — got ' + mail.html);
      assert(!mail.subject.includes('—') && !mail.subject.includes('–') && !mail.html.includes('—') && !mail.html.includes('–'),
        'the reject email (subject and body) contains no em dash or en dash — got subject: ' + mail.subject);
    }
    console.log('PASS - rejecting a work emails the maker with the agreed text and standard sign-off, no reason given');

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

    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // ── Wall window runs from approved_at, not created_at ───────────────────
    // Seeded directly (server down) so created_at/approved_at are exact and
    // predate archiveOldWorks()'s immediate run at the next startup.
    let recentlyApprovedId, longApprovedId;
    {
      const db = new Database(DB_PATH);
      recentlyApprovedId = db.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,created_at,approved_at) " +
        "VALUES (?,?,?,?,?,?,?,datetime('now','-10 days'),datetime('now','-2 days'))"
      ).run('review-delay-recent-approval', 'Review Delay Recent Approval', 'Test Artist', '#', '/uploads/test.webp', 'previous', 'approved').lastInsertRowid;
      longApprovedId = db.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,created_at,approved_at) " +
        "VALUES (?,?,?,?,?,?,?,datetime('now','-10 days'),datetime('now','-8 days'))"
      ).run('review-delay-long-approval', 'Review Delay Long Approval', 'Test Artist', '#', '/uploads/test.webp', 'previous', 'approved').lastInsertRowid;
      db.close();
    }

    child = startServer(DB_PATH, UPLOAD_DIR, fixturePort);
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1000)); // let the immediate archiveOldWorks() call land

    {
      const db = new Database(DB_PATH);
      const recent = db.prepare('SELECT status FROM works WHERE id=?').get(recentlyApprovedId);
      const long = db.prepare('SELECT status FROM works WHERE id=?').get(longApprovedId);
      db.close();
      assert(recent.status === 'previous',
        `a work approved only 2 days ago stays on the wall despite a 10-day-old created_at — got status "${recent.status}" (would have been wrongly archived if the window still ran from created_at)`);
      assert(long.status === 'archived',
        `a work approved 8 days ago is archived once its window (from approved_at) has passed — got status "${long.status}"`);
    }
    console.log('PASS - the 7-day wall window is measured from approved_at, not the original created_at: a review delay no longer eats into a work\'s visible run, and archiving still fires once approved_at is old enough');

    console.log('\nALL PASS');
  } finally {
    if (child) {
      child.kill();
      await new Promise(r => setTimeout(r, 300));
    }
    fixture.close();
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
