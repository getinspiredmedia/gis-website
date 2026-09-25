'use strict';
/*
 * GET /api/admin/rounds/:round_number/leaderboard is an internal, admin-only
 * overview: every approved work of a round with its exact view_count, most
 * views first, earliest created_at first on a tie. The public
 * /api/on-view/leaderboard must stay as it was: top 10, shuffled, no counts.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.admin-round-leaderboard-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.admin-round-leaderboard-test-uploads');
const PORT = 3201;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'test-admin-pwd';

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

async function adminAuth() {
  const r = await fetch(`${BASE}/api/admin/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  return (await r.json()).token;
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT), ADMIN_PASSWORD },
      stdio: 'ignore',
    });
    await waitForServer(30);
    const token = await adminAuth();
    assert(!!token, 'admin auth succeeds');

    const db = new Database(DB_PATH);
    db.prepare("UPDATE works SET status='archived'").run();
    // Round 1 is active now, round 2 is over.
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (1, datetime('now','-2 days'), datetime('now','+5 days'))").run();
    db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (2, datetime('now','-30 days'), datetime('now','-20 days'))").run();
    const add = (slug, round, reviewStatus, views, createdOffset) => db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,view_count,created_at) " +
      "VALUES (?,?,?,?,?,'previous',?,?,?,datetime('now',?))"
    ).run(slug, 'Title ' + slug, 'Artist ' + slug, '#', `/uploads/${slug}.webp`, reviewStatus, round, views, createdOffset);

    // Round 2: sorting with a tie (tie-a is older than tie-b), plus works that must not appear.
    add('low', 2, 'approved', 3, '-15 days');
    add('tie-b', 2, 'approved', 7, '-10 days');
    add('top', 2, 'approved', 20, '-11 days');
    add('tie-a', 2, 'approved', 7, '-14 days');
    add('r2-pending', 2, 'pending', 99, '-12 days');
    add('r2-rejected', 2, 'rejected', 98, '-12 days');
    add('other-round', 1, 'approved', 97, '-1 days');
    add('no-round', null, 'approved', 96, '-12 days');

    // Auth: no session, a wrong one, and an empty bearer are all refused.
    for (const [label, headers] of [['no session', {}], ['a wrong token', { Authorization: 'Bearer nope' }], ['an empty bearer', { Authorization: 'Bearer ' }]]) {
      const r = await fetch(`${BASE}/api/admin/rounds/2/leaderboard`, { headers });
      assert(r.status === 401, `${label} is refused with 401 — got ${r.status}`);
      const text = await r.text();
      assert(!/view_count|Title /.test(text), `${label}: the refusal leaks no work data`);
    }
    console.log('PASS - the admin leaderboard route refuses requests without a valid admin session');

    // Sorted high to low, ties broken by earliest created_at, only approved works of that round.
    {
      const r = await fetch(`${BASE}/api/admin/rounds/2/leaderboard`, { headers: { Authorization: 'Bearer ' + token } });
      assert(r.status === 200, `route responds 200 for admin — got ${r.status}`);
      const rows = await r.json();
      const slugs = rows.map(w => w.slug);
      assert(JSON.stringify(slugs) === JSON.stringify(['top', 'tie-a', 'tie-b', 'low']),
        `sorted by view_count desc, earliest created_at first on a tie, approved works of the round only — got ${JSON.stringify(slugs)}`);
      assert(rows.map(w => w.view_count).join() === '20,7,7,3', 'exact view counts are included');
      assert(rows[0].title === 'Title top' && rows[0].artist === 'Artist top', 'title and artist are included');
    }
    console.log('PASS - sorted high to low with an earliest-first tiebreak; pending, rejected, other-round and round-less works are left out');

    // Unknown round: 404.
    {
      const r = await fetch(`${BASE}/api/admin/rounds/999/leaderboard`, { headers: { Authorization: 'Bearer ' + token } });
      assert(r.status === 404, `unknown round is a 404 — got ${r.status}`);
    }
    console.log('PASS - an unknown round is a 404');

    // Public leaderboard unchanged: round 1 gets 12 more approved works with
    // views 1..12, plus other-round (97): the top 10 are views 97 and 4..12.
    for (let v = 1; v <= 12; v++) add('pub' + v, 1, 'approved', v, '-1 days');
    {
      const orders = new Set();
      for (let i = 0; i < 20; i++) {
        const rows = await (await fetch(`${BASE}/api/on-view/leaderboard`)).json();
        assert(rows.length === 10, `public leaderboard still returns 10 works — got ${rows.length}`);
        for (const w of rows) {
          assert(!('view_count' in w) && !('views' in w) && !('rank' in w), `public leaderboard exposes no counts or rank — got ${JSON.stringify(w)}`);
        }
        const slugs = rows.map(w => w.slug);
        assert(!slugs.includes('pub1') && !slugs.includes('pub2') && !slugs.includes('pub3'), 'the least viewed works fall outside the top 10');
        assert(slugs.includes('other-round') && slugs.filter(s => s.startsWith('pub')).length === 9, 'top 10 by views: other-round plus pub4..pub12');
        orders.add(slugs.join());
      }
      assert(orders.size > 1, 'the public order is shuffled: it varies across 20 requests');
    }
    console.log('PASS - the public leaderboard is unchanged: top 10, shuffled, no view counts');

    db.close();
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
