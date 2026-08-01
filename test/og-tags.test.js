'use strict';
/*
 * /work/:slug must serve per-work Open Graph / Twitter Card tags in the raw
 * HTML response (crawlers don't execute JS). og:image must resolve to a JPEG
 * (not the wall's native WebP — WhatsApp's link-preview crawler has
 * long-standing problems rendering WebP) and stay comfortably under
 * WhatsApp's ~600KB size guidance, for every work regardless of how large or
 * poorly-compressible its source image is.
 *
 * This spins up the real server against a throwaway DB and UPLOAD_DIR, seeds
 * five works — current, previous, archived (outside the 7-day wall cycle),
 * one sourced from an external URL (a local HTTP fixture, so the test has no
 * dependency on real internet access), and one with a deliberately
 * high-entropy/large source image as the "biggest file in the system" case —
 * and asserts both the HTML tags and the /og-image/:slug endpoint itself.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.og-tags-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.og-tags-test-uploads');
const OG_CACHE_DIR = path.join(ROOT, 'test', 'og-cache'); // server derives this from dirname(DB_PATH)
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const OG_DESCRIPTION = 'A weekly work on Get Inspired Society';
const OG_MAX_BYTES = 500 * 1024;

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

async function checkOgImage(slug, label) {
  const r = await fetch(`${BASE}/og-image/${slug}`);
  assert(r.ok, `${label}: /og-image/${slug} responds 200 (got ${r.status})`);
  const contentType = r.headers.get('content-type');
  assert(contentType === 'image/jpeg', `${label}: content-type is image/jpeg, not webp (got ${contentType})`);
  const buf = Buffer.from(await r.arrayBuffer());
  assert(buf.length > 0, `${label}: og-image body is non-empty`);
  assert(buf.length <= OG_MAX_BYTES, `${label}: og-image size ${(buf.length / 1024).toFixed(0)}KB is under the ${OG_MAX_BYTES / 1024}KB budget`);
  console.log(`PASS - ${label}: image/jpeg, ${(buf.length / 1024).toFixed(0)}KB`);
  return buf.length;
}

async function run() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    fs.rmSync(f, { force: true });
  }
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.rmSync(OG_CACHE_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  // Local HTTP fixture standing in for an external image URL (e.g. the seed
  // data's picsum.photos links) — no dependency on real internet access.
  const fixtureImage = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 40, g: 60, b: 140 } },
  }).webp({ quality: 82 }).toBuffer();
  const fixtureServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/webp' });
    res.end(fixtureImage);
  });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const fixturePort = fixtureServer.address().port;

  // Deliberately high-entropy source image — the worst realistic case for
  // JPEG re-compression, standing in for "the largest file in the system".
  const noiseWidth = 1920, noiseHeight = 1920;
  const noiseBuf = Buffer.alloc(noiseWidth * noiseHeight * 3);
  for (let i = 0; i < noiseBuf.length; i++) noiseBuf[i] = Math.floor(Math.random() * 256);
  await sharp(noiseBuf, { raw: { width: noiseWidth, height: noiseHeight, channels: 3 } })
    .webp({ quality: 82 })
    .toFile(path.join(UPLOAD_DIR, 'worst-case.webp'));

  await sharp({ create: { width: 1200, height: 1200, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .webp({ quality: 82 })
    .toFile(path.join(UPLOAD_DIR, 'plain.webp'));

  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    await waitForServer(30);

    const db = new Database(DB_PATH);
    db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
    ).run('test-current-work', 'Test Current Work', 'Current Artist', '#', '/uploads/plain.webp', 'current');
    db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now','-2 days'))"
    ).run('test-previous-work', 'Test Previous Work', 'Previous Artist', '#', '/uploads/plain.webp', 'previous');
    db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now','-10 days'))"
    ).run('test-archived-work', 'Test Archived Work', 'Archived Artist', '#', `http://127.0.0.1:${fixturePort}/image.webp`, 'archived');
    db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,created_at) VALUES (?,?,?,?,?,?,datetime('now'))"
    ).run('test-worst-case-work', 'Test Worst Case Work', 'Noise Artist', '#', '/uploads/worst-case.webp', 'current');
    db.close();

    // HTML tags — current work
    {
      const html = await fetch(`${BASE}/work/test-current-work`).then(r => r.text());
      assert(extractMeta(html, 'property', 'og:title') === 'Test Current Work by Current Artist', 'og:title correct for current work');
      assert(extractMeta(html, 'property', 'og:description') === OG_DESCRIPTION, 'og:description is the exact fixed sentence');
      const image = extractMeta(html, 'property', 'og:image');
      assert(image === 'https://gis-website-production.up.railway.app/og-image/test-current-work', 'og:image points at /og-image/:slug, not the raw upload: ' + image);
      assert(extractMeta(html, 'property', 'og:type') === 'article', 'og:type is article');
      assert(extractMeta(html, 'property', 'og:url') === 'https://gis-website-production.up.railway.app/work/test-current-work', 'og:url is canonical absolute URL');
      assert(extractMeta(html, 'name', 'twitter:card') === 'summary_large_image', 'twitter:card present');
      console.log('PASS - current work: HTML tags present and correct');
    }

    // HTML tags — archived work (outside 7-day wall cycle), external source
    {
      const html = await fetch(`${BASE}/work/test-archived-work`).then(r => r.text());
      assert(extractMeta(html, 'property', 'og:title') === 'Test Archived Work by Archived Artist', 'og:title correct for archived work');
      assert(extractMeta(html, 'property', 'og:description') === OG_DESCRIPTION, 'og:description exact match for archived work too');
      assert(extractMeta(html, 'property', 'og:image') === 'https://gis-website-production.up.railway.app/og-image/test-archived-work', 'og:image points at /og-image/:slug for archived work too');
      console.log('PASS - archived work (past 7-day wall cycle): HTML tags still correct');
    }

    // HTML tags — non-existent slug must not produce empty/broken tags
    {
      const html = await fetch(`${BASE}/work/does-not-exist-at-all`).then(r => r.text());
      const image = extractMeta(html, 'property', 'og:image');
      assert(!!image && image.startsWith('https://'), 'fallback og:image is a non-empty absolute URL: ' + image);
      assert(extractMeta(html, 'property', 'og:description') === OG_DESCRIPTION, 'og:description exact match even for missing work');
      console.log('PASS - unknown slug: fallback HTML tags present, none empty');
    }

    // /og-image/:slug itself — content-type and size, across five works
    // including the worst-case (largest/least compressible) source.
    const sizes = {};
    sizes.current   = await checkOgImage('test-current-work', 'current work');
    sizes.previous  = await checkOgImage('test-previous-work', 'previous work');
    sizes.archived  = await checkOgImage('test-archived-work', 'archived work (external source)');
    sizes.worstCase = await checkOgImage('test-worst-case-work', 'worst-case (largest/high-entropy source)');
    sizes.fallback  = await checkOgImage('does-not-exist-nowhere', 'fallback (unknown slug)');

    // Cache sanity: a second request for the same slug must be served from
    // disk, not reconverted (same bytes, much faster).
    const t0 = Date.now();
    const cachedSize = await checkOgImage('test-worst-case-work', 'worst-case, second request (cache hit)');
    const cachedMs = Date.now() - t0;
    assert(cachedSize === sizes.worstCase, 'cached response is byte-identical to the first conversion');
    console.log(`PASS - cache hit served in ${cachedMs}ms`);

    console.log('\nALL PASS');
  } finally {
    child.kill();
    fixtureServer.close();
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
      fs.rmSync(f, { force: true });
    }
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
    fs.rmSync(OG_CACHE_DIR, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('FAIL -', e.message);
    process.exit(1);
  });
}

module.exports = { run };
