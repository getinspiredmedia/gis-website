'use strict';
/*
 * Epic 4: weekly rounds, clocked from approval (approved_at), not
 * submission. works.round_number is assigned once at submission time,
 * based on which rounds row's [starts_at, ends_at) window covers the
 * current moment — or stays null if none does. A round is "ready for a
 * winner" once it has at least one approved work and the most recent
 * approved_at among that round's approved works is 7+ days in the past;
 * a still-pending work in the round is excluded from that aggregate
 * entirely, so it never blocks readiness. The winner is the approved
 * work with the highest deduplicated view_count, tied broken by earliest
 * created_at. POST /api/admin/rounds/:round_number/announce-winner only
 * succeeds on a ready, not-yet-announced round, and records
 * winner_work_id + announced_at exactly once.
 *
 * Two assumptions applied here without explicit confirmation from André
 * (see CLAUDE.md "Rondes"): the tiebreak on equal view_count is earliest
 * created_at, and there is no admin UI to create/edit rounds — only the
 * documented SQL example.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.rounds-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.rounds-test-uploads');
const PORT = 3193;
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

async function apiSubmit(email, title, imageBuf) {
  const form = new FormData();
  form.append('name', 'Round Tester');
  form.append('email', email);
  form.append('portfolio', 'https://example.com');
  form.append('work_title', title);
  form.append('hp', '');
  form.append('captcha', 'test-captcha-token');
  form.append('image', new Blob([imageBuf], { type: 'image/webp' }), 'test.webp');
  return fetch(`${BASE}/api/submit`, { method: 'POST', body: form });
}

function workByTitle(title) {
  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT * FROM works WHERE title=?').get(title);
  db.close();
  return row;
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = startServer();
    await waitForServer(30);
    const adminToken = await adminAuth();
    assert(!!adminToken, 'admin auth succeeds');

    const imageBuf = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 60, g: 100, b: 180 } },
    }).webp().toBuffer();

    // ── round_number assignment ──────────────────────────────────────────
    // A: no round exists at all -> stays null.
    {
      const r = await apiSubmit('no-round@example.com', 'No Round Work', imageBuf);
      const j = await r.json();
      assert(r.status === 200 && j.ok, 'submission with no round configured is accepted');
    }
    assert(workByTitle('No Round Work').round_number === null, 'a submission with no active round gets round_number=NULL');
    console.log('PASS - a submission with no round configured gets round_number=NULL');

    // B: seed a round covering now -> gets that round_number.
    {
      const db = new Database(DB_PATH);
      db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (1, datetime('now','-2 days'), datetime('now','+5 days'))").run();
      db.close();
    }
    {
      const r = await apiSubmit('in-window@example.com', 'In Window Work', imageBuf);
      const j = await r.json();
      assert(r.status === 200 && j.ok, 'in-window submission is accepted');
    }
    assert(workByTitle('In Window Work').round_number === 1, `a submission inside round 1's window gets round_number=1 — got ${workByTitle('In Window Work').round_number}`);
    console.log('PASS - a submission inside a round window gets the correct round_number');

    // C: round 1 has since ended, round 2 is entirely in the future -> stays null again.
    {
      const db = new Database(DB_PATH);
      db.prepare("UPDATE rounds SET ends_at = datetime('now','-1 hour') WHERE round_number=1").run();
      db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (2, datetime('now','+10 days'), datetime('now','+17 days'))").run();
      db.close();
    }
    {
      const r = await apiSubmit('outside-window@example.com', 'Outside Window Work', imageBuf);
      const j = await r.json();
      assert(r.status === 200 && j.ok, 'outside-window submission is accepted');
    }
    assert(workByTitle('Outside Window Work').round_number === null, `a submission when no round covers now gets round_number=NULL — got ${workByTitle('Outside Window Work').round_number}`);
    console.log('PASS - a submission outside every round window gets round_number=NULL');

    // ── "ready for a winner" ─────────────────────────────────────────────
    // Round 10: two approved works at different approved_at times, plus one
    // still-pending work. Not ready until the LATEST approval is 7+ days old;
    // the pending work must never factor into that at all.
    {
      const db = new Database(DB_PATH);
      db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (10, datetime('now','-30 days'), datetime('now','-20 days'))").run();
      db.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,created_at,approved_at,view_count) " +
        "VALUES (?,?,?,?,?,?,?,?,datetime('now','-9 days'),datetime('now','-8 days'),5)"
      ).run('round10-old-approval', 'Round 10 Old Approval', 'Artist A', '#', '/uploads/a.webp', 'previous', 'approved', 10);
      db.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,created_at,approved_at,view_count) " +
        "VALUES (?,?,?,?,?,?,?,?,datetime('now','-9 days'),datetime('now','-1 day'),3)"
      ).run('round10-recent-approval', 'Round 10 Recent Approval', 'Artist B', '#', '/uploads/b.webp', 'previous', 'approved', 10);
      db.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,created_at) " +
        "VALUES (?,?,?,?,?,?,?,?,datetime('now','-9 days'))"
      ).run('round10-still-pending', 'Round 10 Still Pending', 'Artist C', '#', '/uploads/c.webp', 'previous', 'pending', 10);
      db.close();
    }
    {
      const rows = await (await fetch(`${BASE}/api/admin/rounds`, { headers: { Authorization: 'Bearer ' + adminToken } })).json();
      const round10 = rows.find(r => r.round_number === 10);
      assert(!!round10, 'round 10 shows up in the admin rounds list');
      assert(round10.approved_count === 2, `round 10 counts only its 2 approved works, not the pending one — got ${round10.approved_count}`);
      assert(round10.status === 'ongoing', `round 10 is not ready yet — the most recent approval (1 day ago) hasn't hit 7 days — got status "${round10.status}"`);
    }
    console.log('PASS - a round with a recent approval is not ready, even though an older approval in the same round already is; the pending work is excluded, not blocking');

    // Age the recent approval past 7 days -> now ready.
    {
      const db = new Database(DB_PATH);
      db.prepare("UPDATE works SET approved_at = datetime('now','-8 days') WHERE slug='round10-recent-approval'").run();
      db.close();
    }
    {
      const rows = await (await fetch(`${BASE}/api/admin/rounds`, { headers: { Authorization: 'Bearer ' + adminToken } })).json();
      const round10 = rows.find(r => r.round_number === 10);
      assert(round10.status === 'ready_for_winner', `round 10 becomes ready once its latest approval is 7+ days old — got status "${round10.status}"`);
    }
    console.log('PASS - a round becomes ready once its most recent approval is 7+ days old');

    // ── winner determination, including a tie ───────────────────────────
    // Round 20: two approved works tied on view_count; earliest created_at wins.
    {
      const db = new Database(DB_PATH);
      db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (20, datetime('now','-30 days'), datetime('now','-20 days'))").run();
      db.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,created_at,approved_at,view_count) " +
        "VALUES (?,?,?,?,?,?,?,?,datetime('now','-15 days'),datetime('now','-8 days'),10)"
      ).run('round20-earliest', 'Round 20 Earliest', 'Artist Early', '#', '/uploads/e.webp', 'previous', 'approved', 20);
      db.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,created_at,approved_at,view_count) " +
        "VALUES (?,?,?,?,?,?,?,?,datetime('now','-14 days'),datetime('now','-8 days'),10)"
      ).run('round20-later', 'Round 20 Later', 'Artist Late', '#', '/uploads/l.webp', 'previous', 'approved', 20);
      db.close();
    }

    // Not ready round (10 before its recent-approval aging, use round 30 fresh instead) rejects the action.
    {
      const db = new Database(DB_PATH);
      db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (30, datetime('now','-30 days'), datetime('now','-20 days'))").run();
      db.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,created_at,approved_at,view_count) " +
        "VALUES (?,?,?,?,?,?,?,?,datetime('now','-2 days'),datetime('now','-1 day'),1)"
      ).run('round30-fresh', 'Round 30 Fresh', 'Artist Fresh', '#', '/uploads/f.webp', 'previous', 'approved', 30);
      db.close();
    }
    {
      const r = await fetch(`${BASE}/api/admin/rounds/30/announce-winner`, { method: 'POST', headers: { Authorization: 'Bearer ' + adminToken } });
      const j = await r.json();
      assert(r.status === 400 && j.error, `announce-winner on a not-ready round is rejected — got ${r.status} ${JSON.stringify(j)}`);
    }
    {
      const db = new Database(DB_PATH);
      const round = db.prepare('SELECT winner_work_id, announced_at FROM rounds WHERE round_number=30').get();
      db.close();
      assert(!round.winner_work_id && !round.announced_at, 'a rejected announce-winner call sets nothing');
    }
    console.log('PASS - announce-winner refuses to act on a round that is not ready yet, and sets nothing');

    // Announce the winner for the ready, tied round 20.
    let winnerJson;
    {
      const r = await fetch(`${BASE}/api/admin/rounds/20/announce-winner`, { method: 'POST', headers: { Authorization: 'Bearer ' + adminToken } });
      winnerJson = await r.json();
      assert(r.status === 200 && winnerJson.ok, `announce-winner on a ready round succeeds — got ${r.status} ${JSON.stringify(winnerJson)}`);
    }
    assert(winnerJson.winner.slug === 'round20-earliest', `on a tied view_count, the earliest created_at wins — got ${winnerJson.winner.slug}`);
    {
      const db = new Database(DB_PATH);
      const round = db.prepare('SELECT winner_work_id, announced_at FROM rounds WHERE round_number=20').get();
      const winnerRow = db.prepare('SELECT slug FROM works WHERE id=?').get(round.winner_work_id);
      db.close();
      assert(!!round.announced_at, 'announcing the winner records announced_at');
      assert(winnerRow.slug === 'round20-earliest', 'winner_work_id points at the correctly tie-broken work');
    }
    console.log('PASS - announce-winner picks the earliest-created work on a tied view_count, and records winner_work_id + announced_at');

    // A second announce-winner call on the same round is refused.
    {
      const r = await fetch(`${BASE}/api/admin/rounds/20/announce-winner`, { method: 'POST', headers: { Authorization: 'Bearer ' + adminToken } });
      const j = await r.json();
      assert(r.status === 409 && j.error, `a second announce-winner call on an already-announced round is refused — got ${r.status} ${JSON.stringify(j)}`);
    }
    console.log('PASS - a round\'s winner is recorded exactly once; a repeat call is refused');

    // The admin rounds list reflects the final state correctly.
    {
      const rows = await (await fetch(`${BASE}/api/admin/rounds`, { headers: { Authorization: 'Bearer ' + adminToken } })).json();
      const round20 = rows.find(r => r.round_number === 20);
      assert(round20.status === 'winner_announced', `round 20 shows status winner_announced — got "${round20.status}"`);
      assert(round20.winner && round20.winner.slug === 'round20-earliest', 'round 20 lists the correct winner in the admin overview');
    }
    console.log('PASS - the admin rounds overview reflects the announced winner');

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
