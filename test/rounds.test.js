'use strict';
/*
 * Epic 4: weekly rounds, clocked from approval (approved_at), not
 * submission. works.round_number is assigned once at submission time,
 * based on which rounds row's [starts_at, ends_at) window covers the
 * current moment — or stays null if none does. A round is "ready for a
 * winner" once it has at least one approved work and the most recent
 * approved_at among that round's approved works is 7+ days in the past;
 * a still-pending work in the round is excluded from that aggregate
 * entirely, so it never blocks readiness. The winner is chosen by hand:
 * POST /api/admin/rounds/:round_number/announce-winner takes { work_id } and
 * only succeeds on a ready, not-yet-announced round, for an approved work
 * that belongs to that round; it records winner_work_id + announced_at
 * exactly once. Nothing is derived from view_count.
 *
 * One assumption applied here without explicit confirmation from André
 * (see CLAUDE.md "Rondes"): there is no admin UI to create/edit rounds —
 * only the documented SQL example.
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

async function announce(adminToken, round, body) {
  const r = await fetch(`${BASE}/api/admin/rounds/${round}/announce-winner`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: r.status, json: await r.json() };
}

function roundRow(n) {
  const db = new Database(DB_PATH);
  const row = db.prepare('SELECT winner_work_id, announced_at FROM rounds WHERE round_number=?').get(n);
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

    // ── manual winner selection ─────────────────────────────────────────
    // Round 20 is ready and has: the most viewed approved work, a less viewed
    // approved work that is already archived (the one we will pick), a pending
    // work and a rejected work. Round 30 is not ready (its only approval is 1
    // day old).
    {
      const db = new Database(DB_PATH);
      db.prepare("INSERT INTO rounds (round_number, starts_at, ends_at) VALUES (20, datetime('now','-30 days'), datetime('now','-20 days'))").run();
      const ins = db.prepare(
        "INSERT INTO works (slug,title,artist,portfolio,image_url,status,review_status,round_number,created_at,approved_at,view_count) " +
        "VALUES (?,?,?,?,?,?,?,?,datetime('now','-15 days'),?,?)"
      );
      ins.run('round20-top', 'Round 20 Top', 'Artist Top', '#', '/uploads/t.webp', 'previous', 'approved', 20, db.prepare("SELECT datetime('now','-8 days') AS d").get().d, 10);
      ins.run('round20-chosen', 'Round 20 Chosen', 'Artist Chosen', '#', '/uploads/c.webp', 'archived', 'approved', 20, db.prepare("SELECT datetime('now','-9 days') AS d").get().d, 3);
      ins.run('round20-pending', 'Round 20 Pending', 'Artist Pending', '#', '/uploads/p.webp', 'previous', 'pending', 20, null, 50);
      ins.run('round20-rejected', 'Round 20 Rejected', 'Artist Rejected', '#', '/uploads/r.webp', 'previous', 'rejected', 20, null, 60);
      db.close();
    }
    const top = workByTitle('Round 20 Top');
    const chosen = workByTitle('Round 20 Chosen');
    const pendingWork = workByTitle('Round 20 Pending');
    const rejectedWork = workByTitle('Round 20 Rejected');
    const otherRoundWork = workByTitle('Round 10 Old Approval');

    // A round that is not ready rejects the action, even for a valid work of its own.
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
      // Even a valid, approved work of the round itself is refused while the round is ongoing.
      const fresh = workByTitle('Round 30 Fresh');
      const { status, json } = await announce(adminToken, 30, { work_id: fresh.id });
      assert(status === 400 && json.error, `choosing a winner for a round that is still ongoing is rejected — got ${status} ${JSON.stringify(json)}`);
      const round = roundRow(30);
      assert(!round.winner_work_id && !round.announced_at, 'a rejected announce-winner call sets nothing');
    }
    {
      const { status } = await announce(adminToken, 9999, { work_id: top.id });
      assert(status === 404, `an unknown round is a 404 — got ${status}`);
    }
    console.log('PASS - choosing a winner for a round that is still ongoing (or does not exist) is refused, and sets nothing');

    // On the ready round 20, every invalid choice is refused and sets nothing.
    {
      const attempts = [
        ['no work_id at all', {}],
        ['a non-numeric work_id', { work_id: 'abc' }],
        ['a work id that does not exist', { work_id: 999999 }],
        ['an approved work of another round', { work_id: otherRoundWork.id }],
        ['a pending work of the round', { work_id: pendingWork.id }],
        ['a rejected work of the round', { work_id: rejectedWork.id }],
      ];
      for (const [label, body] of attempts) {
        const { status, json } = await announce(adminToken, 20, body);
        assert(status === 400 && json.error, `choosing ${label} is refused — got ${status} ${JSON.stringify(json)}`);
        const round = roundRow(20);
        assert(!round.winner_work_id && !round.announced_at, `a refused choice (${label}) sets nothing`);
      }
    }
    console.log('PASS - a work outside the round, a pending/rejected work, an unknown id or no choice at all is refused, and sets nothing');

    // Choose a winner on the ready round 20: the less viewed, archived work, not the most viewed one.
    {
      assert(top.view_count > chosen.view_count, 'fixture: the chosen work is deliberately not the most viewed');
      const { status, json } = await announce(adminToken, 20, { work_id: chosen.id });
      assert(status === 200 && json.ok, `choosing a winner on a ready round succeeds — got ${status} ${JSON.stringify(json)}`);
      assert(json.winner.slug === 'round20-chosen', `the response names the chosen work, not the highest viewed — got ${json.winner.slug}`);
      const round = roundRow(20);
      assert(round.winner_work_id === chosen.id, `winner_work_id is the chosen work — got ${round.winner_work_id}`);
      assert(!!round.announced_at, 'announcing the winner records announced_at');
    }
    console.log('PASS - a chosen (even archived, less viewed) approved work of a ready round becomes the winner: winner_work_id + announced_at are set');

    // A second call on the same round is refused and does not change the winner.
    {
      const { status, json } = await announce(adminToken, 20, { work_id: top.id });
      assert(status === 409 && json.error, `a second announce-winner call on an already-announced round is refused — got ${status} ${JSON.stringify(json)}`);
      assert(roundRow(20).winner_work_id === chosen.id, 'the refused second call leaves the winner unchanged');
    }
    console.log('PASS - a round\'s winner is recorded exactly once; a repeat call is refused');

    // The admin rounds list reflects the final state correctly.
    {
      const rows = await (await fetch(`${BASE}/api/admin/rounds`, { headers: { Authorization: 'Bearer ' + adminToken } })).json();
      const round20 = rows.find(r => r.round_number === 20);
      assert(round20.status === 'winner_announced', `round 20 shows status winner_announced — got "${round20.status}"`);
      assert(round20.winner && round20.winner.slug === 'round20-chosen', 'round 20 lists the chosen winner in the admin overview');
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
