'use strict';
/*
 * /work/:slug must serve per-work Open Graph / Twitter Card tags in the raw
 * HTML response (crawlers don't execute JS). This spins up the real server
 * against a throwaway DB, seeds a few works — one current, one archived
 * (outside the 7-day wall cycle, since work pages stay live after that) —
 * and asserts the tags land correctly in the response body.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.og-tags-test.db');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const OG_DESCRIPTION = 'A weekly work on Get Inspired Society';

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function extractMeta(html, attr, value) {
  const re = new RegExp(`<meta ${attr}="${value}" content="([^"]*)">`);
  const m = html.match(re);
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;
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

async function run() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    fs.rmSync(f, { force: true });
  }

  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer(30);

    const db = new Database(DB_PATH);
    db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
    ).run('test-current-work', 'Test Current Work', 'Current Artist', '#', '/uploads/current.webp', 'current');
    db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now','-10 days'))"
    ).run('test-archived-work', 'Test Archived Work', 'Archived Artist', '#', 'https://example.com/absolute.jpg', 'archived');
    db.close();

    // Current work — relative image_url must become absolute
    {
      const html = await fetch(`${BASE}/work/test-current-work`).then(r => r.text());
      assert(extractMeta(html, 'property', 'og:title') === 'Test Current Work by Current Artist', 'og:title correct for current work');
      assert(extractMeta(html, 'property', 'og:description') === OG_DESCRIPTION, 'og:description is the exact fixed sentence');
      const image = extractMeta(html, 'property', 'og:image');
      assert(image === 'https://gis-website-production.up.railway.app/uploads/current.webp', 'og:image resolved to an absolute URL: ' + image);
      assert(extractMeta(html, 'property', 'og:type') === 'article', 'og:type is article');
      assert(extractMeta(html, 'property', 'og:url') === 'https://gis-website-production.up.railway.app/work/test-current-work', 'og:url is canonical absolute URL');
      assert(extractMeta(html, 'name', 'twitter:card') === 'summary_large_image', 'twitter:card present');
      console.log('PASS - current work: all tags present and correct');
    }

    // Archived work (outside 7-day wall cycle) — page must still resolve with correct tags
    {
      const html = await fetch(`${BASE}/work/test-archived-work`).then(r => r.text());
      assert(extractMeta(html, 'property', 'og:title') === 'Test Archived Work by Archived Artist', 'og:title correct for archived work');
      assert(extractMeta(html, 'property', 'og:description') === OG_DESCRIPTION, 'og:description exact match for archived work too');
      assert(extractMeta(html, 'property', 'og:image') === 'https://example.com/absolute.jpg', 'already-absolute og:image passed through unchanged');
      console.log('PASS - archived work (past 7-day wall cycle): tags still correct');
    }

    // Non-existent slug — must not produce empty/broken tags
    {
      const html = await fetch(`${BASE}/work/does-not-exist-at-all`).then(r => r.text());
      const image = extractMeta(html, 'property', 'og:image');
      assert(!!image && image.startsWith('https://'), 'fallback og:image is a non-empty absolute URL: ' + image);
      assert(extractMeta(html, 'property', 'og:description') === OG_DESCRIPTION, 'og:description exact match even for missing work');
      console.log('PASS - unknown slug: fallback tags present, none empty');
    }

    console.log('\nALL PASS');
  } finally {
    child.kill();
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
      fs.rmSync(f, { force: true });
    }
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
  });
}

module.exports = { run };
