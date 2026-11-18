'use strict';
/*
 * The approval mail to the maker is switched off (the On View open call has
 * closed, see CLAUDE.md and test/on-view-submit-closed.test.js); approving a
 * pending work still sets review_status=approved and approved_at, it just no
 * longer mails anyone. Resend is redirected to a local fixture
 * (RESEND_BASE_URL), same pattern as test/archive-email.test.js, so this can
 * assert no request ever reaches it.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.approve-email-test.db');
const PORT = 3205;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE_URL = 'https://getinspiredsociety.test';
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

function startServer(fixturePort) {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH,
      PORT: String(PORT),
      SITE_URL,
      ADMIN_PASSWORD,
      RESEND_API_KEY: 'test-key',
      RESEND_BASE_URL: `http://127.0.0.1:${fixturePort}`,
    },
    stdio: 'ignore',
  });
}

async function run() {
  cleanup();

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
    // Create the schema first, then seed with the server stopped.
    child = startServer(fixturePort);
    await waitForServer(30);
    child.kill();
    await new Promise(r => setTimeout(r, 400));

    const db = new Database(DB_PATH);
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (5, datetime('now','-1 day'), datetime('now','+6 days'))").run();
    const add = (slug, round, email) => db.prepare(
      "INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status,round_number) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(slug, 'Title ' + slug, 'Artist ' + slug, email, '#', `/uploads/${slug}.webp`, 'previous', 'pending', round);
    add('no-round', null, 'none@example.com');
    add('active-round', 5, 'active@example.com');
    const ids = Object.fromEntries(db.prepare('SELECT slug, id FROM works').all().map(r => [r.slug, r.id]));
    db.close();

    child = startServer(fixturePort);
    await waitForServer(30);
    const token = (await (await fetch(`${BASE}/api/admin/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PASSWORD }),
    })).json()).token;
    assert(!!token, 'admin auth succeeds');

    for (const slug of ['no-round', 'active-round']) {
      const r = await fetch(`${BASE}/api/admin/works/${ids[slug]}/approve`, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
      assert(r.status === 200, `approving ${slug} succeeds — got ${r.status}`);
      const row = (() => {
        const d = new Database(DB_PATH);
        const row = d.prepare('SELECT review_status, approved_at FROM works WHERE id=?').get(ids[slug]);
        d.close();
        return row;
      })();
      assert(row.review_status === 'approved' && !!row.approved_at, `approving ${slug} still sets review_status=approved and approved_at`);
    }
    assert(emailRequests.length === 0, `approving works sends no mail — got ${emailRequests.length} sent`);
    console.log('PASS - approving a pending work (with or without an active round) still sets review_status=approved and approved_at, and sends no mail (the approval mail is switched off)');

    console.log('\nALL PASS');
  } finally {
    if (child) {
      child.kill();
      await new Promise(r => setTimeout(r, 400));
    }
    fixture.close();
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
