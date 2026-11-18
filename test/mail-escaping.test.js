'use strict';
/*
 * Visitor-supplied text must not be able to add HTML to a mail, a subject must
 * never carry a CR/LF from user input, the pages only link http(s) portfolios,
 * and the removed hand-in flow answers with a redirect (pages) or 404 (API and
 * POST). POST /api/submit is closed (the On View open call has ended, see
 * test/on-view-submit-closed.test.js for its own coverage), so the mails and
 * portfolio validation that endpoint used to produce are no longer exercised
 * here — only the approve/reject/archive mails and the contact form, which
 * still run on existing or admin-managed data.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.mail-escaping-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.mail-escaping-test-uploads');
const PORT = 3206;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'test-admin-pwd';
const SITE_URL = 'https://getinspiredsociety.test';

const EVIL_NAME  = '<a href="https://evil.example">x</a>';
const EVIL_TITLE = '<b>x</b>';
const ESC_NAME   = '&lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;';
const ESC_TITLE  = '&lt;b&gt;x&lt;/b&gt;';

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

let hits = 0;
// trust proxy is on, so a distinct X-Forwarded-For per request keeps the
// per-IP submit and contact rate limits out of the way of these cases.
function freshIp() {
  hits += 1;
  return { 'X-Forwarded-For': `10.0.0.${hits}` };
}

function workId(slug) {
  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT id FROM works WHERE slug=?').get(slug);
  db.close();
  return row.id;
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

  const spawnServer = () => spawn('node', ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH, UPLOAD_DIR, PORT: String(PORT), ADMIN_PASSWORD, SITE_URL,
      RESEND_API_KEY: 'test-key',
      RESEND_BASE_URL: `http://127.0.0.1:${fixturePort}`,
    },
    stdio: 'ignore',
  });

  // A first start only creates the schema; it is stopped again so the seeded
  // rows below are in place for the startup archive run of the second start.
  const first = spawnServer();
  await waitForServer(30);
  first.kill();
  await new Promise(r => setTimeout(r, 500));

  // Seeded before the second start: an old approved work whose archive mail goes
  // out at startup, plus works for the approve/reject mails and the page checks.
  {
    const db = new Database(DB_PATH);
    const ins = db.prepare(
      "INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status,approved_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"
    );
    ins.run('old-evil', EVIL_TITLE, EVIL_NAME, 'old-evil@example.com', 'https://example.com', '/uploads/a.webp', 'previous', 'approved', "2000-01-01 00:00:00", "2000-01-01 00:00:00");
    ins.run('to-approve', EVIL_TITLE, EVIL_NAME, 'to-approve@example.com', 'https://example.com', '/uploads/b.webp', 'previous', 'pending', null, "2026-01-01 00:00:00");
    ins.run('to-reject', EVIL_TITLE, EVIL_NAME, 'to-reject@example.com', 'https://example.com', '/uploads/c.webp', 'previous', 'pending', null, "2026-01-01 00:00:00");
    ins.run('js-portfolio', 'JS Portfolio', 'JS Artist', 'js@example.com', 'javascript:alert(1)', '/uploads/d.webp', 'previous', 'approved', "2999-01-01 00:00:00", "2999-01-01 00:00:00");
    db.close();
  }

  const child = spawnServer();

  try {
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1000)); // let the startup archive run and mail

    const authRes = await fetch(`${BASE}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    const adminToken = (await authRes.json()).token;
    const adminHeaders = { Authorization: 'Bearer ' + adminToken };

    // ── 2. reject mail uses the database values escaped; approve/archive send no mail ─
    // The approval and archive-expiry mails are switched off (the On View
    // open call has closed, see test/on-view-submit-closed.test.js); reject
    // is unaffected.
    {
      const a = await fetch(`${BASE}/api/admin/works/${(workId('to-approve'))}/approve`, { method: 'POST', headers: adminHeaders });
      assert(a.status === 200, 'approve succeeds');
      assert(!emailRequests.some(m => m.to === 'to-approve@example.com'), 'approving sends no mail');

      const j = await fetch(`${BASE}/api/admin/works/${workId('to-reject')}/reject`, { method: 'POST', headers: adminHeaders });
      assert(j.status === 200, 'reject succeeds');
      const rejectMail = emailRequests.find(m => m.to === 'to-reject@example.com');
      assert(!!rejectMail && rejectMail.html.includes(ESC_NAME) && !rejectMail.html.includes('<a href="https://evil.example"'), 'the reject mail escapes the artist, got ' + (rejectMail && rejectMail.html));

      assert(!emailRequests.some(m => m.to === 'old-evil@example.com'), 'the startup archive run sends no mail');
    }
    console.log('PASS - rejection mail escapes artist and title; approval and archiving send no mail');

    // ── 3. contact form: escaped, newlines become <br> ──────────────────────
    {
      const r = await fetch(`${BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...freshIp() },
        body: JSON.stringify({ email: 'a<i>@example.com', message: '<script>alert(1)</script>\nsecond line', hp: '', captcha: 'test-captcha-token' }),
      });
      assert(r.status === 200, 'the contact form accepts the message, got ' + r.status);
      const mail = emailRequests.find(m => m.subject.startsWith('GIS contact from'));
      assert(!!mail, 'the contact mail was sent');
      assert(mail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;<br>second line'), 'the message is escaped with the newline as <br>, got ' + mail.html);
      assert(!mail.html.includes('<script>') && !mail.html.includes('<i>'), 'no raw tags from message or email in the contact mail');
    }
    console.log('PASS - the contact mail escapes the message and the sender, and keeps line breaks');

    // sendEmail()'s CR/LF stripping (server.js) used to be reachable with
    // attacker-controlled text via /api/submit's name/title fields (the only
    // user input that both lands in a subject and isn't format-validated the
    // way an email address is). That endpoint is closed now the On View open
    // call has ended, and no other live subject interpolates unvalidated
    // user text, so this test, which exercised exactly that path, no longer
    // has a live route to drive it. The stripping itself is untouched, as
    // defense in depth.

    // ── 6. pages only link http(s) portfolios ───────────────────────────────
    {
      const workHtml = fs.readFileSync(path.join(ROOT, 'public', 'work', 'index.html'), 'utf8');
      const adminHtml = fs.readFileSync(path.join(ROOT, 'public', 'admin', 'index.html'), 'utf8');
      assert(/var portfolioHTML = \/\^https\?:\\\/\\\/\/i\.test\(work\.portfolio/.test(workHtml), '/work builds the portfolio button only for http(s) values');
      assert(/function portfolioCell\(p\)[\s\S]*\/\^https\?:\\\/\\\/\/i\.test\(p/.test(adminHtml) && adminHtml.includes('portfolioCell(w.portfolio)'), 'admin links the portfolio only for http(s) values and shows plain text otherwise');
      assert(!/href="'\+esc\(w\.portfolio\)/.test(adminHtml), 'admin has no unconditional portfolio href left');
      const api = await (await fetch(`${BASE}/api/works/js-portfolio`)).json();
      assert(api.portfolio === 'javascript:alert(1)', 'the existing row still carries the stored value, so the page guard is what keeps it unlinked');
    }
    console.log('PASS - /work and admin render a portfolio link only for http(s) values');

    // ── 7. hand-in flow removed ─────────────────────────────────────────────
    for (const p of ['/hand-in', '/hand-in/abc']) {
      const r = await fetch(BASE + p, { redirect: 'manual' });
      assert(r.status === 301 && r.headers.get('location') === '/submit', `GET ${p} redirects 301 to /submit, got ${r.status} ${r.headers.get('location')}`);
    }
    {
      const post = await fetch(`${BASE}/hand-in/abc`, { method: 'POST' });
      assert(post.status === 404, 'POST /hand-in/abc is gone (404), got ' + post.status);
      const tok = await fetch(`${BASE}/api/tokens/abc`);
      assert(tok.status === 404, 'GET /api/tokens/abc is gone (404), got ' + tok.status);
      const mk = await fetch(`${BASE}/api/admin/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminHeaders },
        body: JSON.stringify({ artist_name: 'A', artist_email: 'a@example.com' }),
      });
      assert(mk.status === 404, 'POST /api/admin/tokens is gone (404), got ' + mk.status);
      assert(!fs.existsSync(path.join(ROOT, 'public', 'hand-in')), 'public/hand-in is deleted');
    }
    console.log('PASS - /hand-in redirects to /submit and the token routes are gone');

    console.log('\nALL PASS');
  } finally {
    child.kill();
    await new Promise(r => setTimeout(r, 300));
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
