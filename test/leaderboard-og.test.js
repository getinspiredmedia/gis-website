'use strict';
/*
 * GET /on-view/leaderboard is rendered server-side so a shared link carries
 * Open Graph tags without JS: og:title, og:description, og:url, twitter:card
 * and, when there are works, og:image (the winner's work, else one of the
 * top 10). Everything goes through escapeHtml(). No round or no works: the
 * generic "On View" title and no og:image.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.leaderboard-og-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.leaderboard-og-test-uploads');
const OG_CACHE_DIR = path.join(ROOT, 'test', 'og-cache'); // server derives this from dirname(DB_PATH)
const PORT = 3207;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE_URL = 'https://getinspiredsociety.test';

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function cleanupFiles() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.rmSync(OG_CACHE_DIR, { recursive: true, force: true });
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

function meta(html, attr, name) {
  const m = html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`));
  return m ? m[1] : null;
}

// what a crawler reads: the attribute value after HTML entity decoding
function text(html, attr, name) {
  const v = meta(html, attr, name);
  return v === null ? null : v.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

async function page() {
  const r = await fetch(`${BASE}/on-view/leaderboard`, { redirect: 'manual' });
  assert(r.status === 200, `GET /on-view/leaderboard responds 200 without a redirect, got ${r.status}`);
  return r.text();
}

function insertWork(db, { slug, title, artist, roundNumber, viewCount = 1 }) {
  return db.prepare(
    "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,view_count,view_count_at_archive,approved_at) " +
    "VALUES (?,?,?,?,?,'archived','approved',?,?,?,datetime('now'))"
  ).run(slug, title, artist, '#', '/uploads/art.webp', roundNumber, viewCount, viewCount).lastInsertRowid;
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 110, b: 190 } } })
    .webp().toFile(path.join(UPLOAD_DIR, 'art.webp'));

  let db;
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT), SITE_URL },
    stdio: 'ignore',
  });

  try {
    await waitForServer(30);

    // ── No round at all ─────────────────────────────────────────────────
    {
      const html = await page();
      assert(text(html, 'property', 'og:title') === 'On View · Get Inspired Society', 'without a round og:title is the generic On View title, got ' + text(html, 'property', 'og:title'));
      assert(html.includes('<title>On View · Get Inspired Society</title>'), 'the <title> follows og:title');
      assert(meta(html, 'property', 'og:image') === null, 'without a round there is no og:image');
      assert(meta(html, 'name', 'twitter:card') === 'summary_large_image', 'twitter:card is summary_large_image');
      assert(meta(html, 'property', 'og:url') === SITE_URL + '/on-view/leaderboard', 'og:url is the leaderboard URL');
      assert(!html.includes('<!-- @meta:og -->'), 'the placeholder is gone');
    }
    console.log('PASS - without a round: generic title, no og:image, still twitter:card and og:url');

    db = new Database(DB_PATH);

    // A round that exists but has no approved works behaves like no round.
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (4, datetime('now','-9 days'), datetime('now','-2 days'))").run();
    {
      const html = await page();
      assert(text(html, 'property', 'og:title') === 'On View · Get Inspired Society' && meta(html, 'property', 'og:image') === null, 'a round without works gets the generic title and no og:image');
    }
    console.log('PASS - a round without works: generic title, no og:image');

    // ── Closed round with an announced winner ───────────────────────────
    const winnerId = insertWork(db, { slug: 'winner-ok', title: '<b>"Quoted"</b> $& Title', artist: 'Win <i>ner</i>', roundNumber: 4, viewCount: 9 });
    insertWork(db, { slug: 'other-a', title: 'Other A', artist: 'A', roundNumber: 4 });
    insertWork(db, { slug: 'other-b', title: 'Other B', artist: 'B', roundNumber: 4 });
    db.prepare("UPDATE rounds SET winner_work_id=?, announced_at=datetime('now') WHERE round_number=4").run(winnerId);
    {
      const html = await page();
      assert(text(html, 'property', 'og:title') === "Round 4's top 10 · Get Inspired Society", 'og:title names the round, got ' + text(html, 'property', 'og:title'));
      assert(html.includes("<title>Round 4&#39;s top 10 · Get Inspired Society</title>"), 'the <title> follows og:title');
      assert(text(html, 'property', 'og:description') === 'The ten most viewed works of round 4, in no particular order.', 'og:description for a closed round, got ' + text(html, 'property', 'og:description'));
      const image = meta(html, 'property', 'og:image');
      assert(image === SITE_URL + '/og-image/winner-ok', 'og:image is the winner\'s image, got ' + image);
      assert(meta(html, 'name', 'twitter:card') === 'summary_large_image', 'twitter:card is summary_large_image');
      assert(!html.includes('<b>"Quoted"</b>') && !html.includes('Win <i>'), 'no work title or artist is written into the markup unescaped');

      const img = await fetch(`${BASE}/og-image/winner-ok`);
      assert(img.status === 200 && img.headers.get('content-type').startsWith('image/jpeg'), 'the og:image URL serves a JPEG, got ' + img.status + ' ' + img.headers.get('content-type'));
    }
    console.log('PASS - closed round with winner: title, description and the winner\'s og:image (a JPEG)');

    // ── Closed round without a winner: image is one of the top 10 ───────
    db.prepare("UPDATE rounds SET winner_work_id=NULL, announced_at=NULL WHERE round_number=4").run();
    {
      const seen = new Set();
      for (let i = 0; i < 25; i++) {
        const image = meta(await page(), 'property', 'og:image');
        assert(image && image.startsWith(SITE_URL + '/og-image/'), 'without a winner og:image is still set, got ' + image);
        seen.add(image.slice((SITE_URL + '/og-image/').length));
      }
      for (const s of seen) assert(['winner-ok', 'other-a', 'other-b'].includes(s), 'og:image comes from the top 10, got ' + s);
      assert(seen.size > 1, 'the pick among the top 10 is random, 25 requests gave only ' + [...seen]);
    }
    console.log('PASS - closed round without winner: og:image is a random work of the top 10');

    // ── Escaping of what is interpolated ────────────────────────────────
    db.prepare("DELETE FROM works").run();
    insertWork(db, { slug: 'evil"><b>', title: '<script>"x"</script>', artist: 'Evil', roundNumber: 4 });
    {
      const html = await page();
      const image = meta(html, 'property', 'og:image');
      assert(image === SITE_URL + '/og-image/evil&quot;&gt;&lt;b&gt;', 'quotes and angle brackets in a slug are escaped inside og:image, got ' + image);
      assert(!html.includes('evil"><b>') && !html.includes('<script>"x"</script>'), 'nothing raw from the database ends up in the markup');
    }
    console.log('PASS - values are escaped in the tags (slug with quote and angle brackets)');

    // ── Running round ───────────────────────────────────────────────────
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (5, datetime('now','-1 days'), datetime('now','+6 days'))").run();
    insertWork(db, { slug: 'running-a', title: 'Running A', artist: 'A', roundNumber: 5 });
    {
      const html = await page();
      assert(text(html, 'property', 'og:title') === "Round 5's top 10 · Get Inspired Society", 'a running round is named in og:title, got ' + text(html, 'property', 'og:title'));
      assert(text(html, 'property', 'og:description') === 'The ten most viewed works of this round, in no particular order.', 'og:description for a running round, got ' + text(html, 'property', 'og:description'));
      assert(meta(html, 'property', 'og:image') === SITE_URL + '/og-image/running-a', 'og:image is a work of the running round');
    }
    console.log('PASS - running round: title, description and og:image');

    // The static file still serves the page itself at the directory URL form.
    {
      const r = await fetch(`${BASE}/on-view/leaderboard/`);
      assert(r.status === 200 && (await r.text()).includes('property="og:title"'), 'the trailing-slash URL gets the same server-rendered tags');
    }
    console.log('PASS - the trailing-slash URL is rendered the same way');

    db.close();
    console.log('\nALL PASS');
  } finally {
    if (db && db.open) db.close();
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
