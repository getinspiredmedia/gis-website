'use strict';
/*
 * The On View open call is closed (see CLAUDE.md). Admin can export every
 * On View table as JSON for André's own archive, then wipe the personal
 * data it collected — work emails, the tokens table and work_views'
 * visitor hashes — while /work/:slug keeps working off what's kept (title,
 * artist, image, portfolio). The wipe refuses without an export in this
 * session (a fresh server process, no export) and without the literal
 * confirmation "DELETE".
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.on-view-data-wipe-test.db');
const PORT = 3217;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'test-admin-pwd';

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function cleanup() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
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

function startServer() {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, PORT: String(PORT), ADMIN_PASSWORD, RESEND_API_KEY: '' },
    stdio: 'ignore',
  });
}

async function run() {
  cleanup();
  let child;
  try {
    // Start once just to create the schema, then seed with the server stopped.
    child = startServer();
    await waitForServer(30);
    child.kill();
    await new Promise(r => setTimeout(r, 400));

    const db = new Database(DB_PATH);
    db.prepare(
      "INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status,approved_at) " +
      "VALUES ('wipe-me','Wipe Me','Artist Name','artist@example.com','https://artist.example.com','/uploads/wipe-me.webp','previous','approved',datetime('now'))"
    ).run();
    const workId = db.prepare("SELECT id FROM works WHERE slug='wipe-me'").get().id;
    db.prepare("INSERT INTO work_views (work_id, visitor_hash) VALUES (?, 'some-visitor-hash')").run(workId);
    db.prepare("INSERT INTO tokens (token, artist_name, artist_email) VALUES ('tok-1', 'Legacy Artist', 'legacy@example.com')").run();
    db.close();

    child = startServer();
    await waitForServer(30);
    const token = (await (await fetch(`${BASE}/api/admin/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PASSWORD }),
    })).json()).token;
    assert(!!token, 'admin auth succeeds');
    const auth = { Authorization: 'Bearer ' + token };

    // Wipe without an export is refused.
    {
      const r = await fetch(`${BASE}/api/admin/on-view/wipe`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const j = await r.json();
      assert(r.status === 400 && !!j.error, `wipe without a prior export is refused — got ${r.status} ${JSON.stringify(j)}`);
    }
    console.log('PASS - wipe is refused without an export in this session');

    // Export: contains the personal data, and marks the session as exported.
    const exportBody = await (await fetch(`${BASE}/api/admin/on-view/export`, { headers: auth })).json();
    assert(Array.isArray(exportBody.works) && exportBody.works.some(w => w.slug === 'wipe-me' && w.email === 'artist@example.com'), 'export includes the work with its email');
    assert(Array.isArray(exportBody.work_views) && exportBody.work_views.some(v => v.visitor_hash === 'some-visitor-hash'), 'export includes work_views with the visitor hash');
    assert(Array.isArray(exportBody.tokens) && exportBody.tokens.some(t => t.artist_email === 'legacy@example.com'), 'export includes tokens with artist_email');
    console.log('PASS - export returns works, work_views and tokens with their personal data');

    // Wipe without the exact confirmation word is refused.
    {
      const r = await fetch(`${BASE}/api/admin/on-view/wipe`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'delete' }),
      });
      assert(r.status === 400, `wipe with the wrong confirmation text is refused — got ${r.status}`);
    }
    console.log('PASS - wipe is refused without the exact confirmation "DELETE"');

    // Wipe for real.
    const wipeBody = await (await fetch(`${BASE}/api/admin/on-view/wipe`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }),
    })).json();
    assert(wipeBody.ok === true, `wipe succeeds after a prior export — got ${JSON.stringify(wipeBody)}`);
    assert(wipeBody.wiped.work_emails >= 1, 'reports how many work emails were wiped');
    assert(wipeBody.wiped.token_rows >= 1, 'reports how many token rows were wiped');
    assert(wipeBody.wiped.work_view_rows >= 1, 'reports how many work_view rows were wiped');
    console.log('PASS - wipe succeeds and reports the number of rows/fields touched');

    // No email, IP or visitor hash remains anywhere in the database.
    {
      const d = new Database(DB_PATH);
      const emails = d.prepare("SELECT email FROM works WHERE email != ''").all();
      assert(emails.length === 0, `no work email remains — got ${JSON.stringify(emails)}`);
      const tokenRows = d.prepare('SELECT * FROM tokens').all();
      assert(tokenRows.length === 0, `no token rows remain — got ${JSON.stringify(tokenRows)}`);
      const viewRows = d.prepare('SELECT * FROM work_views').all();
      assert(viewRows.length === 0, `no work_views rows remain — got ${JSON.stringify(viewRows)}`);
      d.close();
    }
    console.log('PASS - no email, token or visitor hash remains in the database after the wipe');

    // /work/:slug still resolves: title, artist, image and portfolio kept.
    {
      const r = await fetch(`${BASE}/work/wipe-me`);
      const html = await r.text();
      assert(r.status === 200, `/work/wipe-me still returns 200 after the wipe — got ${r.status}`);
      assert(html.includes('Wipe Me'), '/work/wipe-me still shows the title');
      assert(html.includes('Artist Name'), '/work/wipe-me still shows the artist name');
    }
    console.log('PASS - /work/:slug still works after the wipe (title, artist, image, portfolio kept)');

    // A second wipe is refused again (the export flag is consumed).
    {
      const r = await fetch(`${BASE}/api/admin/on-view/wipe`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }),
      });
      assert(r.status === 400, `a second wipe without a fresh export is refused — got ${r.status}`);
    }
    console.log('PASS - a second wipe needs a fresh export (the export flag is consumed by a wipe)');

    // Both routes require admin auth.
    {
      const r1 = await fetch(`${BASE}/api/admin/on-view/export`);
      const r2 = await fetch(`${BASE}/api/admin/on-view/wipe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
      assert(r1.status === 401 && r2.status === 401, `export and wipe both require admin auth — got ${r1.status}/${r2.status}`);
    }
    console.log('PASS - export and wipe both require admin auth');

    console.log('\nALL PASS');
  } finally {
    if (child) {
      child.kill();
      await new Promise(r => setTimeout(r, 400));
    }
    cleanup();
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
  });
}

module.exports = { run };
