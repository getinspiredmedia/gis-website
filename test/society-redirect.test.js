'use strict';
/*
 * The Society page and the Log in pill are gone. Old links to /society (in
 * newsletters and posts) must 301 to the homepage, and no nav or footer on a
 * build page, On View, the work page or a magazine reader may link to /society
 * or to the Circle subdomain any more. The magazine readers share the same nav
 * and footer and are checked as well (found by glob).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const { listReaderPages } = require('../build/readers');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.society-redirect-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.society-redirect-test-uploads');
const PORT = 3203;
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

function navAndFooter(html) {
  const nav = (html.match(/<nav[^>]*>[\s\S]*?<\/nav>/) || [''])[0];
  const footer = (html.match(/<footer[^>]*>[\s\S]*?<\/footer>/) || [''])[0];
  return { nav, footer };
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT) },
      stdio: 'ignore',
    });
    await waitForServer(30);

    for (const p of ['/society', '/society/']) {
      const r = await fetch(BASE + p, { redirect: 'manual' });
      assert(r.status === 301, `GET ${p} answers 301 — got ${r.status}`);
      assert(r.headers.get('location') === '/', `GET ${p} redirects to / — got ${r.headers.get('location')}`);
    }
    console.log('PASS - /society and /society/ both answer 301 to /');

    assert(!fs.existsSync(path.join(ROOT, 'public', 'society')), 'public/society no longer exists');
    assert(!fs.existsSync(path.join(ROOT, 'build', 'pages', 'society.html')), 'build/pages/society.html no longer exists');
    console.log('PASS - the Society page and its source are gone');

    const buildOutputs = require('../build/pages.config').map(c => c.output);
    const pages = [...buildOutputs, 'public/on-view/index.html', 'public/work/index.html', ...listReaderPages()];
    for (const rel of pages) {
      const { nav, footer } = navAndFooter(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      assert(nav && footer, `${rel} has a nav and a footer`);
      for (const [name, part] of [['nav', nav], ['footer', footer]]) {
        assert(!/href="\/society"/.test(part), `${rel}: the ${name} does not link to /society`);
        assert(!/society\.getinspiredsociety\.com/.test(part), `${rel}: the ${name} does not link to the Circle subdomain`);
        assert(!/Log in/i.test(part), `${rel}: the ${name} has no Log in`);
      }
      const items = [...nav.matchAll(/<div class="menu"[^>]*>([\s\S]*?)<\/div>/g)][0][1].match(/<a [^>]*>([^<]*)<\/a>/g).map(a => a.replace(/<[^>]*>/g, ''));
      assert(JSON.stringify(items) === JSON.stringify(['On view', 'Magazine', 'Gallery']), `${rel}: the nav items are On view, Magazine, Gallery — got ${JSON.stringify(items)}`);
    }
    console.log(`PASS - nav and footer of ${pages.length} pages have no Society link, no Circle link and no Log in; the nav is On view, Magazine, Gallery`);

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
