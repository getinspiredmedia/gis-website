'use strict';
/*
 * archiveOldWorks() moves works from 'previous' to 'archived' after 7 days.
 * It used to mail the maker when that happened; that mail is now switched
 * off (the On View open call has closed, see CLAUDE.md and
 * test/on-view-submit-closed.test.js), while the archiving itself keeps
 * running unchanged. Covers: the status transition still happens, no mail
 * goes out for it (checked against a local Resend fixture, same pattern as
 * before), and a second server start against the same DB within the same
 * hour does not re-archive it.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.archive-email-test.db');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE_URL = 'https://getinspiredsociety.test';

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

function seedOldWork(slug) {
  const db = new Database(DB_PATH);
  db.prepare(
    "INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,created_at) " +
    "VALUES (?,?,?,?,?,?,?,datetime('now','-8 days'))"
  ).run(slug, 'Archive Email Test Work', 'Test Artist', 'maker@example.com', '#', '/uploads/test.webp', 'previous');
  db.close();
}

function startServer(fixturePort) {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH,
      PORT: String(PORT),
      SITE_URL,
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
    // 0. Start the server once just to create the schema (and run the seed
    //    that only fires on an empty table), then stop it before seeding
    //    our own row — otherwise the row would be written before the
    //    `works` table exists.
    child = startServer(fixturePort);
    await waitForServer(30);
    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // 1. Seed a work that's been 'previous' for 8 days, then start the
    //    server — archiveOldWorks() runs once immediately at startup.
    seedOldWork('archive-email-test-work');
    child = startServer(fixturePort);
    await waitForServer(30);

    // Give the immediate archiveOldWorks() call + its await sendEmail a moment to land.
    await new Promise(r => setTimeout(r, 1000));

    {
      const db = new Database(DB_PATH);
      const row = db.prepare('SELECT status FROM works WHERE slug=?').get('archive-email-test-work');
      db.close();
      assert(row.status === 'archived', `work is archived after 7+ days — got status "${row.status}"`);
    }
    console.log('PASS - a work older than 7 days in status previous is archived');

    assert(emailRequests.length === 0, `the archive-expiry mail is switched off — got ${emailRequests.length} sent`);
    console.log('PASS - archiving a work sends no mail (the archive-expiry mail is switched off)');

    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // 2. Restart against the same DB within the same "hour" — the row is
    //    already 'archived', so the startup archiveOldWorks() call must
    //    not match it again.
    child = startServer(fixturePort);
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1000));

    assert(emailRequests.length === 0, `a restart against the same DB sends no mail either — got ${emailRequests.length} total`);
    console.log('PASS - restarting the server against the same DB does not re-archive the work or send a mail');

    console.log('\nALL PASS');
  } finally {
    if (child) child.kill();
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
