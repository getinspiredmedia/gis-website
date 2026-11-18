'use strict';
/*
 * notifyClosedRounds() used to mail the makers of every approved work in a
 * round once its ends_at had passed. That mail is now switched off (the On
 * View open call has closed, see CLAUDE.md and
 * test/on-view-submit-closed.test.js); the function still claims each closed
 * round exactly once (rounds.closed_notification_sent_at), it just sends no
 * mail for it. Same Resend fixture pattern as test/archive-email.test.js:
 * RESEND_BASE_URL points at a local server standing in for api.resend.com,
 * used here to assert it is never called.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.round-closed-email-test.db');
const PORT = 3202;
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

const stopServer = async (child) => {
  child.kill();
  await new Promise(r => setTimeout(r, 400));
};

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
    // Create the schema first, then stop, so our seed rows have tables to land in.
    child = startServer(fixturePort);
    await waitForServer(30);
    await stopServer(child);

    const db = new Database(DB_PATH);
    // Round 1 closed yesterday, round 2 still runs.
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (1, datetime('now','-8 days'), datetime('now','-1 day'))").run();
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (2, datetime('now','-1 day'), datetime('now','+6 days'))").run();
    db.prepare(
      "INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status,round_number,created_at,approved_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,datetime('now','-2 days'),datetime('now','-1 day'))"
    ).run('anna', 'Title anna', 'Anna Maria Lopez', 'anna@example.com', '#', '/uploads/anna.webp', 'previous', 'approved', 1);
    db.close();

    child = startServer(fixturePort);
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1500));

    assert(emailRequests.length === 0, `no round-closed mail is sent — got ${emailRequests.length}`);
    console.log('PASS - closing round 1 sends no mail (the round-closed mail is switched off)');

    // The claim still happens, so this remains idempotent (a repeat run
    // never re-sends, even if the mail were re-enabled later).
    {
      const d = new Database(DB_PATH);
      const r1 = d.prepare('SELECT closed_notification_sent_at FROM rounds WHERE round_number=1').get();
      const r2 = d.prepare('SELECT closed_notification_sent_at FROM rounds WHERE round_number=2').get();
      d.close();
      assert(!!r1.closed_notification_sent_at, 'the closed round is still marked as notified');
      assert(r2.closed_notification_sent_at === null, 'a round that has not ended is not marked');
    }
    console.log('PASS - the closed round is still marked as notified; a round with ends_at in the future is not');

    await stopServer(child);
    child = startServer(fixturePort);
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1500));
    assert(emailRequests.length === 0, `a restart still sends no mail — got ${emailRequests.length}`);
    console.log('PASS - a restart sends no mail either');

    console.log('\nALL PASS');
  } finally {
    if (child) await stopServer(child);
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
