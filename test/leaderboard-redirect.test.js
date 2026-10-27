'use strict';
/*
 * The public leaderboard is gone after the open call: /on-view/leaderboard
 * (with and without trailing slash) answers 301 to /on-view, the page file and
 * its public API are removed, and nothing in the public pages links to it.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.leaderboard-redirect-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.leaderboard-redirect-test-uploads');
const PORT = 3208;
const BASE = `http://127.0.0.1:${PORT}`;

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

function publicHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...publicHtmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer(30);

    for (const p of ['/on-view/leaderboard', '/on-view/leaderboard/']) {
      const r = await fetch(BASE + p, { redirect: 'manual' });
      assert(r.status === 301, `GET ${p} answers 301, got ${r.status}`);
      assert(r.headers.get('location') === '/on-view', `GET ${p} points to /on-view, got ${r.headers.get('location')}`);
    }
    console.log('PASS - /on-view/leaderboard and /on-view/leaderboard/ redirect with 301 to /on-view');

    {
      const r = await fetch(BASE + '/on-view/leaderboard', { redirect: 'follow' });
      assert(r.status === 200 && new URL(r.url).pathname.replace(/\/$/, '') === '/on-view', `following the redirect lands on /on-view, got ${r.status} ${r.url}`);
    }
    console.log('PASS - following the redirect lands on /on-view');

    {
      const api = await fetch(BASE + '/api/on-view/leaderboard');
      assert(api.status === 404, `the public leaderboard API is gone (404), got ${api.status}`);
      const file = await fetch(BASE + '/on-view/leaderboard/index.html', { redirect: 'manual' });
      assert(file.status !== 200, `the page file is no longer served, got ${file.status}`);
      assert(!fs.existsSync(path.join(ROOT, 'public', 'on-view', 'leaderboard')), 'public/on-view/leaderboard is deleted');
    }
    console.log('PASS - the page file and the public API are gone');

    {
      const pages = publicHtmlFiles(path.join(ROOT, 'public'));
      const buildPages = publicHtmlFiles(path.join(ROOT, 'build', 'pages'));
      for (const f of [...pages, ...buildPages]) {
        assert(!/on-view\/leaderboard/.test(fs.readFileSync(f, 'utf8')), `${path.relative(ROOT, f)} has no link to the leaderboard`);
      }
    }
    console.log('PASS - no page or build page links to the leaderboard');

    console.log('\nALL PASS');
  } finally {
    child.kill();
    await new Promise(r => setTimeout(r, 300));
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
