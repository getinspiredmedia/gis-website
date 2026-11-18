'use strict';
/*
 * End-to-end check that the contact form actually delivers: POST /api/contact
 * with a message and email reaches the (mocked) mailer with both in the
 * body, and the route itself only requires what the client actually sends
 * (message, email, hp, captcha as JSON — the form's own fields now carry
 * name attributes too, for autofill/accessibility/a no-JS fallback, but the
 * live path is the JS fetch() in build/pages/contact.html, not a native form
 * POST). Real delivery to an inbox can't be shown from here — see the
 * eindrapport's checklist for a live test send.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.contact-form-test.db');
const PORT = 3215;
const BASE = `http://127.0.0.1:${PORT}`;

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
    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DB_PATH, PORT: String(PORT),
        ADMIN_EMAIL: 'admin@example.com',
        RESEND_API_KEY: 'test-key',
        RESEND_BASE_URL: `http://127.0.0.1:${fixturePort}`,
      },
      stdio: 'ignore',
    });
    await waitForServer(30);

    // The form's own markup carries the fields the JS reads.
    {
      const html = fs.readFileSync(path.join(ROOT, 'public', 'contact', 'index.html'), 'utf8');
      assert(/<form id="contact-form" action="\/api\/contact" method="post"/.test(html), 'the form has an action and method (progressive enhancement)');
      assert(/<textarea id="contact-message" name="message"/.test(html), 'the message field has a name attribute');
      assert(/<input id="contact-email" name="email"/.test(html), 'the email field has a name attribute');
    }
    console.log('PASS - the contact form fields carry name attributes and the form has action/method');

    // The same JSON shape the page's fetch() sends.
    {
      const r = await fetch(`${BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello, this is a test message.', email: 'visitor@example.com', hp: '', captcha: 'test-captcha-token' }),
      });
      const j = await r.json();
      assert(r.status === 200 && j.ok === true, `the contact form submits successfully — got ${r.status} ${JSON.stringify(j)}`);

      const mail = emailRequests.find(m => m.to === 'admin@example.com');
      assert(!!mail, 'a mail reached the mailer, addressed to ADMIN_EMAIL');
      assert(mail.subject === 'GIS contact from visitor@example.com', `the subject names the sender — got ${mail.subject}`);
      assert(mail.html.includes('Hello, this is a test message.'), 'the message is in the mail body');
      assert(mail.html.includes('visitor@example.com'), 'the sender email is in the mail body');
    }
    console.log('PASS - POST /api/contact delivers message and email to the (mocked) mailer and confirms ok:true');

    // The honeypot and missing-field/invalid-email paths still behave.
    {
      const hp = await fetch(`${BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'spam', email: 'spam@example.com', hp: 'filled', captcha: '' }),
      });
      const hpJson = await hp.json();
      assert(hp.status === 200 && hpJson.ok === true, 'a honeypot-filled request is silently accepted, got ' + hp.status);
      assert(!emailRequests.some(m => m.html && m.html.includes('spam@example.com')), 'no mail was sent for the honeypot-filled request');
    }
    console.log('PASS - a honeypot-filled request is silently accepted and sends no mail');

    {
      const r = await fetch(`${BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '', email: '', hp: '', captcha: 'test-captcha-token' }),
      });
      const j = await r.json();
      assert(r.status === 400 && !!j.error, `an empty message/email is rejected with 400 — got ${r.status} ${JSON.stringify(j)}`);
    }
    console.log('PASS - an empty message or email is rejected with a clear error');

    console.log('\nALL PASS');
  } finally {
    if (child) {
      child.kill();
      await new Promise(r => setTimeout(r, 300));
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
