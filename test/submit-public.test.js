'use strict';
/*
 * Epic 3: /submit is public (no shared token) for the open call. Protected
 * the same way the contact form is — hCaptcha + honeypot on the form, an
 * IP rate limiter on POST /api/submit — since the token gate that used to
 * be the only access control is gone. Old /submit/:token links keep
 * working via a redirect. Also covers the duplicate-check bugfix: a
 * rejected submission must not permanently block a resubmission from the
 * same email (only an active pending/approved submission should).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.submit-public-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.submit-public-test-uploads');
const PORT = 3195;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'test-admin-pwd';

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function cleanupFiles() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    fs.rmSync(f, { force: true });
  }
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
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

function startServer() {
  return spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT), ADMIN_PASSWORD },
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

function workRowByEmail(email) {
  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT * FROM works WHERE email=?').get(email);
  db.close();
  return row;
}

// hp/captcha default to '' / a placeholder token — HCAPTCHA_SECRET is unset
// in this test env, so verifyHcaptcha() accepts any non-empty token without
// a real hCaptcha round-trip (same fail-open-when-unconfigured behavior the
// contact form already relies on).
async function apiSubmit({ name, email, portfolio, work_title, hp = '', captcha = 'test-captcha-token', noCaptchaField = false }, imageBuf) {
  const form = new FormData();
  form.append('name', name);
  form.append('email', email);
  form.append('portfolio', portfolio);
  form.append('work_title', work_title);
  form.append('hp', hp);
  if (!noCaptchaField) form.append('captcha', captcha);
  form.append('image', new Blob([imageBuf], { type: 'image/webp' }), 'test.webp');
  return fetch(`${BASE}/api/submit`, { method: 'POST', body: form });
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = startServer();
    await waitForServer(30);

    const imageBuf = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 80, g: 140, b: 200 } },
    }).webp().toBuffer();

    // GET /submit loads without a token
    {
      const r = await fetch(`${BASE}/submit`);
      assert(r.status === 200, `GET /submit responds 200 without a token — got ${r.status}`);
      const html = await r.text();
      assert(html.toLowerCase().includes('submit your work') || html.includes('id="form"'), 'GET /submit renders the submission form');
    }
    console.log('PASS - /submit is publicly reachable without a token');

    // A valid submission gets review_status=pending, same as /hand-in
    {
      const r = await apiSubmit({ name: 'Open Call Artist', email: 'open-call-artist@example.com', portfolio: 'https://example.com/portfolio', work_title: 'Open Call Work' }, imageBuf);
      const j = await r.json();
      assert(r.status === 200 && j.ok, `a valid /submit submission is accepted — got ${r.status} ${JSON.stringify(j)}`);
    }
    const work = workRowByEmail('open-call-artist@example.com');
    assert(!!work, '/api/submit created a work row');
    assert(work.review_status === 'pending', `a new /submit submission is review_status=pending — got ${work.review_status}`);
    console.log('PASS - a valid /submit submission gets review_status=pending');

    // Honeypot: filled -> silent ok, no row created
    {
      const r = await apiSubmit({ name: 'Bot', email: 'honeypot-bot@example.com', portfolio: 'https://example.com', work_title: 'Bot Work', hp: 'I am a bot' }, imageBuf);
      const j = await r.json();
      assert(r.status === 200 && j.ok, 'a filled honeypot gets a silent ok response');
    }
    assert(!workRowByEmail('honeypot-bot@example.com'), 'a filled honeypot creates no work row');
    console.log('PASS - a filled honeypot field is silently accepted without creating a submission');

    // Missing captcha token -> rejected
    {
      const r = await apiSubmit({ name: 'No Captcha', email: 'no-captcha@example.com', portfolio: 'https://example.com', work_title: 'X', noCaptchaField: true }, imageBuf);
      const j = await r.json();
      assert(r.status === 400 && !j.ok, `a submission without a captcha token is rejected — got ${r.status} ${JSON.stringify(j)}`);
    }
    assert(!workRowByEmail('no-captcha@example.com'), 'a request with no captcha token creates no work row');
    console.log('PASS - hCaptcha is enforced: a submission without a captcha token is rejected');

    // Bugfix: a rejected submission does not permanently block a resubmission
    const adminToken = await adminAuth();
    {
      const r = await apiSubmit({ name: 'Reject Me', email: 'reject-retry@example.com', portfolio: 'https://example.com', work_title: 'First Try' }, imageBuf);
      const j = await r.json();
      assert(r.status === 200 && j.ok, 'first submission from the retry email is accepted');
    }
    const firstWork = workRowByEmail('reject-retry@example.com');
    assert(!!firstWork, 'the first submission created a work row');
    {
      const r = await fetch(`${BASE}/api/admin/works/${firstWork.id}/reject`, { method: 'POST', headers: { Authorization: 'Bearer ' + adminToken } });
      const j = await r.json();
      assert(r.status === 200 && j.ok, 'rejecting the first submission succeeds');
    }
    {
      const r = await apiSubmit({ name: 'Reject Me', email: 'reject-retry@example.com', portfolio: 'https://example.com', work_title: 'Second Try' }, imageBuf);
      const j = await r.json();
      assert(r.status === 200 && j.ok, `a previously-rejected email can resubmit — got ${r.status} ${JSON.stringify(j)}`);
    }
    {
      const db = new Database(DB_PATH);
      const rows = db.prepare('SELECT * FROM works WHERE email=?').all('reject-retry@example.com');
      db.close();
      assert(rows.length === 2, `both attempts left a row for the retried email — got ${rows.length}`);
      const second = rows.find(w => w.title === 'Second Try');
      assert(!!second && second.review_status === 'pending', 'the resubmission is pending, not blocked by the old rejected one');
    }
    console.log('PASS - a previously-rejected email is not permanently blocked from resubmitting (duplicate-check bugfix)');

    // /submit/:token redirects to /submit for any token value
    {
      const r = await fetch(`${BASE}/submit/anything-goes-here-not-even-a-real-token`, { redirect: 'manual' });
      assert(r.status === 301, `GET /submit/:token redirects with 301 — got ${r.status}`);
      assert(r.headers.get('location') === '/submit', `redirect target is /submit — got ${r.headers.get('location')}`);
    }
    console.log('PASS - /submit/:token redirects to /submit for any token value, old shared links keep working');

    // Rate limiter — run last: it deliberately exhausts the per-IP quota for
    // the rest of this test run, so nothing below it can rely on a fresh one.
    {
      let blocked = 0;
      for (let i = 0; i < 10; i++) {
        const r = await apiSubmit({ name: 'Burst', email: `burst-${i}@example.com`, portfolio: 'https://example.com', work_title: 'Burst' }, imageBuf);
        if (r.status === 429) blocked++;
      }
      assert(blocked > 0, `rapid repeated POST /api/submit requests from one IP eventually get rate-limited — got ${blocked}/10 blocked`);
    }
    console.log('PASS - POST /api/submit is rate-limited against rapid repeated requests from one IP');

    console.log('\nALL PASS');
  } finally {
    if (child) {
      child.kill();
      await new Promise(r => setTimeout(r, 300));
    }
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
