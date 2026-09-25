'use strict';
/*
 * notifyClosedRounds() mails the makers of every approved work in a round once
 * its ends_at has passed, exactly once per round (rounds.closed_notification_sent_at
 * is claimed in the same UPDATE that finds the round). Same Resend fixture
 * pattern as test/archive-email.test.js: RESEND_BASE_URL points at a local
 * server standing in for api.resend.com.
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
  const closedMails = () => emailRequests.filter(m => /^Round \d+ is closed$/.test(m.subject));
  const recipients = () => closedMails().map(m => [].concat(m.to)[0]).sort();

  let child;
  try {
    // Create the schema first, then stop, so our seed rows have tables to land in.
    child = startServer(fixturePort);
    await waitForServer(30);
    await stopServer(child);

    const db = new Database(DB_PATH);
    db.prepare("UPDATE works SET status='archived'").run();
    // Round 1 closed yesterday, round 2 still runs, round 3 is in the future.
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (1, datetime('now','-8 days'), datetime('now','-1 day'))").run();
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (2, datetime('now','-1 day'), datetime('now','+6 days'))").run();
    const add = (slug, artist, email, reviewStatus, round, status) => db.prepare(
      "INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status,round_number,created_at,approved_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,datetime('now','-2 days'),datetime('now','-1 day'))"
    ).run(slug, 'Title ' + slug, artist, email, '#', `/uploads/${slug}.webp`, status, reviewStatus, round);
    add('no-email', 'Nobody', '', 'approved', 1, 'previous');           // skipped, must not break the batch
    add('anna', 'Anna Maria Lopez', 'anna@example.com', 'approved', 1, 'previous');
    add('studio', 'Studio', 'studio@example.com', 'approved', 1, 'archived'); // archive status does not matter
    add('anna-again', 'Anna Maria Lopez', 'ANNA@example.com', 'approved', 1, 'previous'); // same address: one mail
    add('pending', 'Pen Ding', 'pending@example.com', 'pending', 1, 'previous');
    add('rejected', 'Rey Jected', 'rejected@example.com', 'rejected', 1, 'previous');
    add('no-round', 'No Round', 'noround@example.com', 'approved', null, 'previous');
    add('running-round', 'Run Ning', 'running@example.com', 'approved', 2, 'previous');
    db.close();

    child = startServer(fixturePort);
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1500));

    // Exactly one mail per maker of the closed round; nobody else.
    assert(JSON.stringify(recipients()) === JSON.stringify(['anna@example.com', 'studio@example.com']),
      `only makers with an approved work in the closed round are mailed, once each — got ${JSON.stringify(recipients())}`);
    console.log('PASS - one mail per approved maker of the closed round (archived works included, duplicate address once)');

    const annaMail = closedMails().find(m => [].concat(m.to)[0] === 'anna@example.com');
    assert(annaMail.subject === 'Round 1 is closed', `subject is "Round 1 is closed" — got ${JSON.stringify(annaMail.subject)}`);
    const expectedBody =
      'Hi,\n\n' +
      'Round 1 of the On View open call is now closed.\n\n' +
      'Every submission gets its full seven days on the wall before a winner is picked. The round winner is announced once the last approved work from this round has had its full week of views.\n\n' +
      "If you win, you'll hear from us directly, and the winning work is shown on the site.\n\n" +
      `Keep showing your work. Submit again: ${SITE_URL}/submit\n\n` +
      'Thank you for showing your work.';
    assert(annaMail.text === expectedBody, `plain-text body matches the agreed copy — got ${JSON.stringify(annaMail.text)}`);
    assert(!annaMail.html, 'the mail is plain text only');
    assert(!/[–—]/.test(annaMail.text + annaMail.subject), 'no long dashes in the copy');
    const studioMail = closedMails().find(m => [].concat(m.to)[0] === 'studio@example.com');
    assert(studioMail.text === expectedBody, 'every maker gets the same body: "Hi," with no name, whatever the stored artist name');
    console.log('PASS - subject, plain-text body ("Hi," without a name, "is now closed") and /submit link (no token) are correct');

    // Pending, rejected, round-less works and the still running round get nothing.
    const all = JSON.stringify(emailRequests);
    for (const addr of ['pending@', 'rejected@', 'noround@', 'running@']) {
      assert(!all.includes(addr), `${addr} is not mailed`);
    }
    console.log('PASS - pending, rejected, round-less and running-round works get no mail; the missing address did not break the batch');

    // Round 1 is marked; rounds that have not ended are not.
    {
      const d = new Database(DB_PATH);
      const r1 = d.prepare('SELECT closed_notification_sent_at FROM rounds WHERE round_number=1').get();
      const r2 = d.prepare('SELECT closed_notification_sent_at FROM rounds WHERE round_number=2').get();
      d.close();
      assert(!!r1.closed_notification_sent_at, 'the closed round is marked as notified');
      assert(r2.closed_notification_sent_at === null, 'a round that has not ended is not marked and triggers nothing');
    }
    console.log('PASS - the closed round is marked; a round with ends_at in the future triggers nothing');

    // A restart re-runs the check at startup (the hourly run is the same function): no second mail.
    const before = emailRequests.length;
    await stopServer(child);
    child = startServer(fixturePort);
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1500));
    assert(emailRequests.length === before, `a restart does not mail again — got ${emailRequests.length - before} extra`);
    console.log('PASS - a repeated check (restart) sends no second mail');

    // A round that closes later is picked up on the next run, once.
    {
      const d = new Database(DB_PATH);
      d.prepare("UPDATE rounds SET ends_at=datetime('now','-1 minute') WHERE round_number=2").run();
      d.close();
    }
    await stopServer(child);
    child = startServer(fixturePort);
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1500));
    assert(recipients().includes('running@example.com') && closedMails().filter(m => m.subject === 'Round 2 is closed').length === 1,
      'round 2 is mailed once after its ends_at has passed');
    assert(closedMails().filter(m => m.subject === 'Round 1 is closed').length === 2, 'round 1 is not mailed again');
    console.log('PASS - a round is mailed once when it closes later, and earlier rounds are not repeated');

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
