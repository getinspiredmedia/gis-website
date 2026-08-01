'use strict';
/*
 * Verifies the Plausible reverse-proxy in server.js (GET /js/:file, POST
 * /api/event) end-to-end against a local fixture standing in for
 * plausible.io — the real plausible.io is unreachable from this sandbox
 * (same egress restriction hit on prior tasks). Runs server.js in-process
 * (required directly, not spawned) so global.fetch can be intercepted
 * before the routes' own fetch() calls resolve it; the target host is
 * hardcoded in server.js, so there's no env var to redirect instead.
 *
 * The specific thing this task cares about: the event proxy must forward
 * the real visitor's IP (X-Forwarded-For, via req.ip / trust proxy) and
 * original User-Agent to Plausible, not the server's own. Without that,
 * Plausible sees every visitor as the same server IP, breaking
 * geo/device stats and risking bot-detection false positives.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.plausible-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.plausible-test-uploads');
const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}`;

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function cleanup() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
}

async function run() {
  cleanup();

  let lastEventRequest = null;
  const fixture = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/js/pa-MH-OTeJcc74k86JrwLa7k.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=86400' });
      return res.end('/* fake plausible script */');
    }
    if (req.method === 'POST' && req.url === '/api/event') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        lastEventRequest = { headers: { ...req.headers }, body };
        res.writeHead(202, { 'Content-Type': 'text/plain' });
        res.end('');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const fixturePort = fixture.address().port;

  const originalFetch = global.fetch;
  global.fetch = function (url, opts) {
    if (typeof url === 'string' && url.startsWith('https://plausible.io')) {
      return originalFetch(url.replace('https://plausible.io', `http://127.0.0.1:${fixturePort}`), opts);
    }
    return originalFetch(url, opts);
  };

  process.env.DB_PATH = DB_PATH;
  process.env.UPLOAD_DIR = UPLOAD_DIR;
  process.env.PORT = String(PORT);
  require(path.join(ROOT, 'server.js'));

  await new Promise(resolve => setTimeout(resolve, 800));

  const results = [];
  function check(cond, msg) { results.push({ pass: !!cond, msg }); }

  try {
    // ── Script proxy — unchanged behaviour, kept here as a regression guard ──
    {
      const r = await originalFetch(`${BASE}/js/pa-MH-OTeJcc74k86JrwLa7k.js`);
      check(r.status === 200, 'script proxy: 200 status');
      check((r.headers.get('content-type') || '').includes('javascript'), 'script proxy: content-type forwarded');
      check(r.headers.get('cache-control') === 'public, max-age=86400', 'script proxy: cache-control forwarded from upstream');
    }
    {
      const r = await originalFetch(`${BASE}/js/not-a-script.txt`);
      check(r.status === 404, 'script proxy: non-.js filename rejected by the allowlist');
    }

    // ── Event proxy: the header-forwarding this task is actually about ──
    {
      const payload = JSON.stringify({ n: 'pageview', u: 'https://getinspiredsociety.com/', d: 'getinspiredsociety.com' });
      const r = await originalFetch(`${BASE}/api/event`, {
        method: 'POST',
        headers: {
          'Content-Type':    'text/plain', // Plausible's real script does this to dodge a CORS preflight
          'User-Agent':      'Mozilla/5.0 (TestDevice) TestBrowser/1.0',
          'X-Forwarded-For': '203.0.113.42', // simulated real visitor IP, arriving via Railway's own proxy
        },
        body: payload,
      });
      check(r.status === 202, 'event proxy: upstream status relayed to the client');
      await new Promise(resolve => setTimeout(resolve, 150));
      check(!!lastEventRequest, 'event proxy: fixture actually received the forwarded request');

      check(
        lastEventRequest.headers['user-agent'] === 'Mozilla/5.0 (TestDevice) TestBrowser/1.0',
        'event proxy: the VISITOR\'s User-Agent reaches Plausible, not a server-default — got ' + lastEventRequest.headers['user-agent']
      );
      check(
        lastEventRequest.headers['x-forwarded-for'] === '203.0.113.42',
        'event proxy: the VISITOR\'s real IP reaches Plausible as X-Forwarded-For (proves trust-proxy → req.ip resolves correctly) — got ' + lastEventRequest.headers['x-forwarded-for']
      );
      check(lastEventRequest.headers['content-type'] === 'application/json', 'event proxy: text/plain body still forwarded as application/json');

      let parsed;
      try { parsed = JSON.parse(lastEventRequest.body); } catch (e) { /* left undefined, asserted below */ }
      check(!!parsed && parsed.n === 'pageview' && parsed.d === 'getinspiredsociety.com', 'event proxy: JSON body forwarded intact — got ' + lastEventRequest.body);
    }

    // application/json content-type must work identically to text/plain
    {
      const r = await originalFetch(`${BASE}/api/event`, {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'User-Agent':      'AnotherAgent/2.0',
          'X-Forwarded-For': '198.51.100.7',
        },
        body: JSON.stringify({ n: 'pageview', u: 'https://getinspiredsociety.com/about', d: 'getinspiredsociety.com' }),
      });
      check(r.status === 202, 'event proxy (application/json content-type): status relayed');
      await new Promise(resolve => setTimeout(resolve, 150));
      check(lastEventRequest.headers['user-agent'] === 'AnotherAgent/2.0', 'event proxy (application/json): User-Agent forwarded');
      check(lastEventRequest.headers['x-forwarded-for'] === '198.51.100.7', 'event proxy (application/json): X-Forwarded-For forwarded');
    }

    // No X-Forwarded-For on the incoming request at all — must still fall back
    // to the actual connection IP (req.ip), never send an empty header.
    {
      const r = await originalFetch(`${BASE}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ n: 'pageview', u: 'https://getinspiredsociety.com/', d: 'getinspiredsociety.com' }),
      });
      check(r.status === 202, 'event proxy (no client IP header): status relayed');
      await new Promise(resolve => setTimeout(resolve, 150));
      check(
        !!lastEventRequest.headers['x-forwarded-for'],
        'event proxy: X-Forwarded-For still present when the client sent none — falls back to the connection IP, never empty — got ' + JSON.stringify(lastEventRequest.headers['x-forwarded-for'])
      );
    }

    const failed = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + ' - ' + r.msg));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exitCode = failed.length === 0 ? 0 : 1;
  } finally {
    global.fetch = originalFetch;
    fixture.close();
    cleanup();
    process.exit(process.exitCode || 0);
  }
}

run();
