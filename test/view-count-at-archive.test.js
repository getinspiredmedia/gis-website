'use strict';
/*
 * view_count_at_archive freezes a work's view_count the moment
 * archiveOldWorks() archives it, in the same UPDATE as the status flip (see
 * server.js) so no view landing in that instant is lost or double-counted.
 * The admin round-leaderboard and the announce-winner winner selection sort
 * and display COALESCE(view_count_at_archive, view_count) instead of the
 * raw, still-growing view_count — an early-archived work can no longer
 * outrank a later one purely by collecting views after it came down. The
 * public /on-view/leaderboard and /work/:slug's own counter are untouched by
 * this and are not the concern of this file (see admin-round-leaderboard.test.js
 * and view-count.test.js).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.view-count-at-archive-test.db');
const PORT = 3202;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'test-admin-pwd';

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function cleanupFiles() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) fs.rmSync(f, { force: true });
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
    env: { ...process.env, DB_PATH, PORT: String(PORT), ADMIN_PASSWORD },
    stdio: 'ignore',
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

function row(db, slug) {
  return db.prepare('SELECT status, view_count, view_count_at_archive FROM works WHERE slug=?').get(slug);
}

async function run() {
  cleanupFiles();

  let child;
  try {
    child = startServer();
    await waitForServer(30);

    const db = new Database(DB_PATH);

    // 1. A work old enough to archive, with some views already on it.
    db.prepare(
      "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,approved_at,view_count,created_at) " +
      "VALUES (?,?,?,?,?,'previous','approved',datetime('now','-8 days'),?,datetime('now','-8 days'))"
    ).run('freeze-test-work', 'Freeze Test Work', 'Test Artist', '#', '/uploads/freeze.webp', 5);
    db.close();

    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // Restart triggers the immediate archiveOldWorks() call.
    child = startServer();
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 1000));

    {
      const db2 = new Database(DB_PATH);
      const r1 = row(db2, 'freeze-test-work');
      db2.close();
      assert(r1.status === 'archived', `work is archived after 7+ days — got "${r1.status}"`);
      assert(r1.view_count === 5, `view_count is untouched by archiving — got ${r1.view_count}`);
      assert(r1.view_count_at_archive === 5, `view_count_at_archive is set equal to view_count at archive time — got ${r1.view_count_at_archive}`);
    }
    console.log('PASS - archiving a work freezes view_count_at_archive to its view_count at that moment');

    // A visit to the now-archived work's still-reachable page increments the
    // live view_count further, but must not move the frozen count.
    {
      const r = await fetch(`${BASE}/work/freeze-test-work`, { headers: { 'User-Agent': 'post-archive-visitor' } });
      assert(r.status === 200, 'archived work page still responds 200');
      const db2 = new Database(DB_PATH);
      const r1 = row(db2, 'freeze-test-work');
      db2.close();
      // A pending/rejected/unknown-slug work never counts, but this one is
      // still review_status='approved' (only its lifecycle status changed),
      // so the visit does count.
      assert(r1.view_count === 6, `a post-archive visit still increments the live view_count — got ${r1.view_count}`);
      assert(r1.view_count_at_archive === 5, `a post-archive visit does not change the frozen count — got ${r1.view_count_at_archive}`);
    }
    console.log('PASS - a visit after archiving grows view_count but leaves view_count_at_archive untouched');

    child.kill();
    child = null;
    await new Promise(r => setTimeout(r, 300));

    // 2. Backfill: a work archived before this migration (view_count_at_archive
    // still NULL) gets it filled in from its current view_count on startup.
    {
      const db2 = new Database(DB_PATH);
      db2.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,view_count,created_at) " +
        "VALUES (?,?,?,?,?,'archived','approved',?,datetime('now','-30 days'))"
      ).run('pre-existing-archived-work', 'Pre-existing Archived Work', 'Test Artist', '#', '/uploads/old.webp', 42);
      // Simulate the pre-migration state directly: the ALTER TABLE already
      // ran (the column exists), but this row predates it, so its value is NULL.
      db2.prepare('UPDATE works SET view_count_at_archive=NULL WHERE slug=?').run('pre-existing-archived-work');
      db2.close();
    }

    child = startServer();
    await waitForServer(30);
    await new Promise(r => setTimeout(r, 500));

    {
      const db2 = new Database(DB_PATH);
      const r1 = row(db2, 'pre-existing-archived-work');
      db2.close();
      assert(r1.view_count_at_archive === 42, `backfill sets view_count_at_archive from the current view_count (best-effort) — got ${r1.view_count_at_archive}`);
    }
    console.log('PASS - the one-time backfill fills view_count_at_archive for already-archived rows from their current view_count');

    // 3. Fairness: admin round-leaderboard sorts on the frozen count, not the
    // live one. "early" archived with few frozen views but many late,
    // post-archive views must rank BELOW "late" whose live count (all earned
    // within its own 7 days, never archived) is lower in total but higher
    // than "early"'s frozen count.
    {
      const db2 = new Database(DB_PATH);
      db2.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (10, datetime('now','-2 days'), datetime('now','+5 days'))").run();

      db2.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,approved_at,view_count,view_count_at_archive,created_at) " +
        "VALUES ('early',?,?,?,?,'archived','approved',10,datetime('now','-9 days'),50,3,datetime('now','-9 days'))"
      ).run('Early Work', 'Early Artist', '#', '/uploads/early.webp');

      db2.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,approved_at,view_count,created_at) " +
        "VALUES ('late',?,?,?,?,'previous','approved',10,datetime('now','-1 days'),10,datetime('now','-1 days'))"
      ).run('Late Work', 'Late Artist', '#', '/uploads/late.webp');
      db2.close();
    }

    const token = await adminAuth();
    {
      const r = await fetch(`${BASE}/api/admin/rounds/10/leaderboard`, { headers: { Authorization: 'Bearer ' + token } });
      const rows = await r.json();
      const slugs = rows.map(w => w.slug);
      assert(slugs.indexOf('late') < slugs.indexOf('early'),
        `"late" (live 10 > "early"'s frozen 3) outranks "early" (raw total 50) — got order ${JSON.stringify(slugs)}`);
      const early = rows.find(w => w.slug === 'early');
      const late = rows.find(w => w.slug === 'late');
      assert(early.view_count === 3, `archived work reports its frozen count (3), not its raw total (50) — got ${early.view_count}`);
      assert(late.view_count === 10, `non-archived work reports its live, still-growing count — got ${late.view_count}`);
    }
    console.log('PASS - the admin round-leaderboard sorts and displays the frozen count for archived work, the live count otherwise, fixing the early-archive advantage');

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
