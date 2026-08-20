'use strict';
/*
 * archiveOldWorks() moves works from 'previous' to 'archived' after 7 days
 * and, per work archived, mails the maker via the existing Resend pattern
 * (RESEND_BASE_URL redirected to a local fixture standing in for
 * api.resend.com — the real host is unreachable from this sandbox, same
 * restriction as the Plausible proxy test). Covers: exactly one mail is
 * sent with the right recipient/title/links, and a second server start
 * against the same DB within the same hour does not re-send it (the
 * status='previous' -> 'archived' transition is itself the guard).
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
const SUBMIT_TOKEN = 'test-submit-token';
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
      SUBMIT_TOKEN,
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

    assert(emailRequests.length === 1, `exactly one archive mail is sent — got ${emailRequests.length}`);
    const mail = emailRequests[0];
    assert(mail.to === 'maker@example.com' || (Array.isArray(mail.to) && mail.to.includes('maker@example.com')),
      'mail is addressed to the maker\'s email — got ' + JSON.stringify(mail.to));
    assert(mail.subject === 'Your work has come down from On View',
      'subject matches the agreed copy exactly — got ' + JSON.stringify(mail.subject));
    assert(mail.html.includes('"Archive Email Test Work" was on the wall for seven days. It comes down today.'),
      'body includes the work title in the agreed sentence — got ' + mail.html);
    assert(mail.html.includes(`${SITE_URL}/work/archive-email-test-work`),
      'body links to the work\'s permanent /work/:slug page — got ' + mail.html);
    assert(mail.html.includes(`${SITE_URL}/submit/${SUBMIT_TOKEN}`),
      'body links to the (shared) /submit/:token CTA — got ' + mail.html);
    assert(mail.html.includes('Thank you for showing your work.'),
      'body includes the closing line — got ' + mail.html);
    console.log('PASS - the mail has the correct recipient, subject, title, /work/:slug link and /submit/:token CTA');

    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // 2. Restart against the same DB within the same "hour" — the row is
    //    already 'archived', so the startup archiveOldWorks() call must
    //    not match it again and must not send a second mail.
    child = startServer(fixturePort);
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1000));

    assert(emailRequests.length === 1, `a restart against the same DB sends no second mail — got ${emailRequests.length} total`);
    console.log('PASS - restarting the server against the same DB does not re-send the archive mail');

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
