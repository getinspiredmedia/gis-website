'use strict';
/*
 * Visitor-supplied text must not be able to add HTML to a mail, a subject must
 * never carry a CR/LF from user input, /api/submit only accepts http(s)
 * portfolio links, the pages only link http(s) portfolios, and the removed
 * hand-in flow answers with a redirect (pages) or 404 (API and POST).
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const sharp = require('sharp');

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

async function apiSubmit({ name, email, portfolio, work_title }, imageBuf) {
  const form = new FormData();
  form.append('name', name);
  form.append('email', email);
  form.append('portfolio', portfolio);
  form.append('work_title', work_title);
  form.append('hp', '');
  form.append('captcha', 'test-captcha-token');
  form.append('image', new Blob([imageBuf], { type: 'image/webp' }), 'test.webp');
  return fetch(`${BASE}/api/submit`, { method: 'POST', body: form, headers: freshIp() });
}

function workRowByEmail(email) {
  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT * FROM works WHERE email=?').get(email);
  db.close();
  return row;
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

    const imageBuf = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 100, g: 120, b: 200 } },
    }).webp().toBuffer();

    const authRes = await fetch(`${BASE}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    const adminToken = (await authRes.json()).token;
    const adminHeaders = { Authorization: 'Bearer ' + adminToken };

    // ── 1. /api/submit mails: confirmation and admin notification ───────────
    {
      const r = await apiSubmit({ name: EVIL_NAME, email: 'evil@example.com', portfolio: 'https://example.com/?a=1&b=2', work_title: EVIL_TITLE }, imageBuf);
      assert(r.status === 200, 'a submission with HTML in name and title is accepted, got ' + r.status);
      const confirm = emailRequests.find(m => m.to === 'evil@example.com' && m.subject.startsWith('Your work is in'));
      assert(!!confirm, 'the confirmation mail was sent');
      assert(confirm.html.includes(ESC_NAME) && confirm.html.includes(ESC_TITLE), 'the confirmation mail shows name and title as escaped text, got ' + confirm.html);
      assert(!confirm.html.includes('<a href="https://evil.example"') && !confirm.html.includes('<b>x</b>'), 'the confirmation mail contains no raw HTML from the name or title');
      const admin = emailRequests.find(m => m.subject.startsWith('Pending approval') && m.html.includes(ESC_TITLE));
      assert(!!admin, 'the admin notification was sent');
      assert(admin.html.includes(ESC_NAME) && admin.html.includes('a=1&amp;b=2'), 'the admin mail escapes name and portfolio, got ' + admin.html);
      assert(!admin.html.includes('<a href="https://evil.example"') && !admin.html.includes('<b>x</b>'), 'the admin mail contains no raw HTML from the name or title');
      assert(admin.html.includes(`<a href="${SITE_URL}/admin">`), 'the admin link itself stays a real link');
    }
    console.log('PASS - /api/submit confirmation and admin mails escape name, title and portfolio');

    // ── 2. approve, reject and archive mails use the database values escaped ─
    {
      const a = await fetch(`${BASE}/api/admin/works/${(workId('to-approve'))}/approve`, { method: 'POST', headers: adminHeaders });
      assert(a.status === 200, 'approve succeeds');
      const approveMail = emailRequests.find(m => m.to === 'to-approve@example.com');
      assert(!!approveMail && approveMail.html.includes(ESC_NAME) && approveMail.html.includes(ESC_TITLE), 'the approval mail escapes artist and title, got ' + (approveMail && approveMail.html));
      assert(!approveMail.html.includes('<b>x</b>') && !approveMail.html.includes('<a href="https://evil.example"'), 'the approval mail has no raw HTML from artist or title');

      const j = await fetch(`${BASE}/api/admin/works/${workId('to-reject')}/reject`, { method: 'POST', headers: adminHeaders });
      assert(j.status === 200, 'reject succeeds');
      const rejectMail = emailRequests.find(m => m.to === 'to-reject@example.com');
      assert(!!rejectMail && rejectMail.html.includes(ESC_NAME) && !rejectMail.html.includes('<a href="https://evil.example"'), 'the reject mail escapes the artist, got ' + (rejectMail && rejectMail.html));

      const archiveMail = emailRequests.find(m => m.to === 'old-evil@example.com');
      assert(!!archiveMail && archiveMail.html.includes(ESC_NAME) && archiveMail.html.includes(ESC_TITLE), 'the archive mail escapes artist and title, got ' + (archiveMail && archiveMail.html));
      assert(!archiveMail.html.includes('<b>x</b>') && !archiveMail.html.includes('<a href="https://evil.example"'), 'the archive mail has no raw HTML from artist or title');
    }
    console.log('PASS - approval, rejection and archive mails escape artist and title');

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

    // ── 4. no CR/LF from user input in a subject ────────────────────────────
    {
      const r = await apiSubmit({ name: 'Line\r\nBcc: attacker@example.com', email: 'crlf@example.com', portfolio: 'https://example.com', work_title: 'Two\nLines' }, imageBuf);
      assert(r.status === 200, 'a submission with line breaks in name and title is accepted, got ' + r.status);
      const sent = emailRequests.filter(m => /Line/.test(m.subject));
      assert(sent.length > 0, 'a mail with the name in its subject was sent');
      assert(emailRequests.every(m => !/[\r\n]/.test(m.subject)), 'no subject contains a CR or LF');
      assert(sent.some(m => m.subject.includes('Bcc: attacker@example.com') === true), 'the text is kept, only the line break is gone');
    }
    console.log('PASS - subjects never contain CR or LF from user input');

    // ── 5. portfolio validation on /api/submit ──────────────────────────────
    for (const [i, bad] of ['javascript:alert(1)', 'ftp://x', 'example.com', 'data:text/html,hi', ' '].entries()) {
      const email = `bad-portfolio-${i}@example.com`;
      const r = await apiSubmit({ name: 'Bad', email, portfolio: bad, work_title: 'Bad Portfolio' }, imageBuf);
      const j = await r.json();
      assert(r.status === 400 && /http:\/\/ or https:\/\//.test(j.error), `portfolio "${bad}" is rejected with 400 and the http(s) message, got ${r.status} ${JSON.stringify(j)}`);
      assert(!workRowByEmail(email), `no work row for portfolio "${bad}"`);
    }
    for (const [i, good] of ['https://example.com', 'http://example.com'].entries()) {
      const email = `good-portfolio-${i}@example.com`;
      const r = await apiSubmit({ name: 'Good', email, portfolio: good, work_title: 'Good Portfolio ' + i }, imageBuf);
      assert(r.status === 200, `portfolio "${good}" is accepted, got ${r.status}`);
      assert(workRowByEmail(email).portfolio === good, `portfolio "${good}" is stored as given`);
    }
    console.log('PASS - only http(s) portfolio links are accepted, without auto-prefixing');

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

  function workId(slug) {
    const db = new Database(DB_PATH);
    const row = db.prepare('SELECT id FROM works WHERE slug=?').get(slug);
    db.close();
    return row.id;
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
  });
}

module.exports = { run };
