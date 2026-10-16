'use strict';
/*
 * The approval email only promises the contest (and the t-shirt) when the
 * approved work belongs to the round that is active right now. Work without a
 * round, or from a round that is no longer active, gets a neutral share line in
 * the same place. Everything else in the mail stays the same. Resend is
 * redirected to a local fixture (RESEND_BASE_URL), same pattern as
 * test/archive-email.test.js.
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

const CONTEST = "<p>This week's wall is also a contest. The work with the most views on its page by the end of the week wins a t-shirt. Sharing your link is one way to get more views.</p>";
const NEUTRAL = '<p>Want people to see it? Share your link.</p>';

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
    // Round 4 has closed, round 5 is running now.
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (4, datetime('now','-9 days'), datetime('now','-1 day'))").run();
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (5, datetime('now','-1 day'), datetime('now','+6 days'))").run();
    const add = (slug, round, email) => db.prepare(
      "INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status,round_number) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(slug, 'Title ' + slug, 'Artist ' + slug, email, '#', `/uploads/${slug}.webp`, 'previous', 'pending', round);
    add('no-round', null, 'none@example.com');
    add('closed-round', 4, 'closed@example.com');
    add('active-round', 5, 'active@example.com');
    const ids = Object.fromEntries(db.prepare('SELECT slug, id FROM works').all().map(r => [r.slug, r.id]));
    db.close();

    child = startServer(fixturePort);
    await waitForServer(30);
    const token = (await (await fetch(`${BASE}/api/admin/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PASSWORD }),
    })).json()).token;
    assert(!!token, 'admin auth succeeds');

    const approve = async (slug) => {
      const before = emailRequests.length;
      const r = await fetch(`${BASE}/api/admin/works/${ids[slug]}/approve`, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
      assert(r.status === 200, `approving ${slug} succeeds — got ${r.status}`);
      assert(emailRequests.length === before + 1, `approving ${slug} sends exactly one mail`);
      return emailRequests[emailRequests.length - 1];
    };

    // The whole mail apart from the share line, identical for every case.
    const expectedFor = (slug, shareLine) =>
      `<p>Hi Artist ${slug},</p><p>"Title ${slug}" is now on the wall.<br><a href="${SITE_URL}/work/${slug}">${SITE_URL}/work/${slug}</a></p>`
      + `<p>It stays up for seven days.</p>`
      + shareLine
      + `<p>Example: "My work &quot;Title ${slug}&quot; is on the wall at Get Inspired Society this week. ${SITE_URL}/work/${slug}"</p>`
      + `<p>Suggested hashtag: #GetInspiredSociety</p>`
      + `<p>Creative regards,<br>Get Inspired Society</p>`;

    for (const [slug, label] of [['no-round', 'a work without a round'], ['closed-round', 'a work from a round that is no longer active']]) {
      const mail = await approve(slug);
      assert(mail.subject === 'Your work is on the wall, Get Inspired Society', `${label}: the subject is unchanged`);
      assert(mail.html === expectedFor(slug, NEUTRAL), `${label}: the mail is the usual one with the neutral share line — got ${mail.html}`);
      assert(!/contest|t-shirt|most views/i.test(mail.html), `${label}: no "contest", "t-shirt" or "most views"`);
    }
    console.log('PASS - a work without a round, or from a round that is no longer active, gets "Want people to see it? Share your link." and no contest, t-shirt or most views');

    {
      const mail = await approve('active-round');
      assert(mail.subject === 'Your work is on the wall, Get Inspired Society', 'the active-round mail: the subject is unchanged');
      assert(mail.html === expectedFor('active-round', CONTEST), `a work of the active round gets the contest paragraph, the rest of the mail unchanged — got ${mail.html}`);
    }
    console.log('PASS - a work of the active round gets the unchanged contest paragraph');

    // With no active round at all, even a work of the latest round gets the neutral line.
    {
      const d = new Database(DB_PATH);
      d.prepare("UPDATE rounds SET ends_at = datetime('now','-1 hour') WHERE round_number=5").run();
      d.prepare("INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status,round_number) VALUES ('late','Title late','Artist late','late@example.com','#','/uploads/late.webp','previous','pending',5)").run();
      ids.late = d.prepare("SELECT id FROM works WHERE slug='late'").get().id;
      d.close();
      const mail = await approve('late');
      assert(mail.html === expectedFor('late', NEUTRAL), 'once the last round has closed, its work also gets the neutral line');
    }
    console.log('PASS - once no round is active any more, work of the last round gets the neutral line as well');

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
