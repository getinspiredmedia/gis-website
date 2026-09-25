'use strict';
const express    = require('express');
const path       = require('path');
const crypto     = require('crypto');
const fs         = require('fs');
const Database   = require('better-sqlite3');
const multer     = require('multer');
const sharp      = require('sharp');
const { Resend } = require('resend');

const app  = express();
const PORT = process.env.PORT || 3000;

const DB_PATH      = process.env.DB_PATH       || path.join(__dirname, 'data', 'gis.db');
// Uploads live next to the database so they persist on the Railway volume.
// Locally: data/uploads/  |  Railway: /data/uploads/
const UPLOAD_DIR   = process.env.UPLOAD_DIR    || path.join(path.dirname(DB_PATH), 'uploads');
const ADMIN_PWD    = process.env.ADMIN_PASSWORD || 'admin';
const RESEND_KEY      = process.env.RESEND_API_KEY;
const FROM_EMAIL      = process.env.RESEND_FROM        || 'noreply@getinspiredsociety.com';
const ADMIN_EMAIL     = process.env.ADMIN_EMAIL        || 'info@getinspiredsociety.com';
const SITE_URL        = process.env.SITE_URL           || 'https://getinspiredsociety.com';
const HCAPTCHA_SECRET = process.env.HCAPTCHA_SECRET;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Database ──────────────────────────────────────────────────────────────────

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS works (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT UNIQUE NOT NULL,
    title      TEXT NOT NULL,
    artist     TEXT NOT NULL,
    email      TEXT NOT NULL DEFAULT '',
    portfolio  TEXT NOT NULL DEFAULT '#',
    image_url  TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'previous'
                   CHECK(status IN ('current','previous','archived')),
    view_count INTEGER NOT NULL DEFAULT 0,
    review_status TEXT NOT NULL DEFAULT 'approved'
                   CHECK(review_status IN ('pending','approved','rejected')),
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed works from static JSON when database is empty. Seed data is
// pre-approved — it stands in for already-published works, not new
// submissions awaiting review.
if (db.prepare('SELECT COUNT(*) as n FROM works').get().n === 0) {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data', 'works.json'), 'utf8'));
  const ins  = db.prepare('INSERT OR IGNORE INTO works (slug,title,artist,portfolio,image_url,status,review_status) VALUES (?,?,?,?,?,?,?)');
  db.transaction(rows => rows.forEach(r =>
    ins.run(r.slug, r.title, r.artist, r.portfolio || '#', r.image, r.current ? 'current' : 'previous', 'approved')
  ))(seed);
}

// Migrations for existing databases
try { db.exec("ALTER TABLE works ADD COLUMN email TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE works ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0"); } catch {}
// Existing rows predate the review step — grandfathered in as approved so
// already-published work doesn't disappear from the wall.
try { db.exec("ALTER TABLE works ADD COLUMN review_status TEXT NOT NULL DEFAULT 'approved' CHECK(review_status IN ('pending','approved','rejected'))"); } catch {}
try { db.exec("ALTER TABLE works ADD COLUMN approved_at TEXT"); } catch {}
try { db.exec("ALTER TABLE works ADD COLUMN round_number INTEGER"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN artist_name  TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN artist_email TEXT NOT NULL DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN used INTEGER NOT NULL DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))"); } catch {}

// Tokens table for hand-in links
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    token        TEXT PRIMARY KEY,
    artist_name  TEXT NOT NULL,
    artist_email TEXT NOT NULL,
    used         INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// One row per (work, visitor) view, used to dedup view_count within 24h.
// visitor_hash is a salted hash of IP+user-agent — the IP itself is never stored.
db.exec(`
  CREATE TABLE IF NOT EXISTS work_views (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id      INTEGER NOT NULL,
    visitor_hash TEXT NOT NULL,
    viewed_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_work_views_work_hash ON work_views(work_id, visitor_hash)');

// Weekly rounds (epic 4). Created by hand via SQL (see CLAUDE.md) — there is
// deliberately no admin UI to add or edit them. round_number is the natural
// key: simple, stable, and matches how everything else refers to a round.
db.exec(`
  CREATE TABLE IF NOT EXISTS rounds (
    round_number   INTEGER PRIMARY KEY,
    starts_at      TEXT NOT NULL,
    ends_at        TEXT NOT NULL,
    winner_work_id INTEGER,
    announced_at   TEXT
  );
`);

// The round whose [starts_at, ends_at) window covers this moment, or null if
// none — assigned once at submission time (created_at), never reassigned.
function currentRoundNumber() {
  const row = db.prepare(
    "SELECT round_number FROM rounds WHERE starts_at <= datetime('now') AND datetime('now') < ends_at ORDER BY round_number DESC LIMIT 1"
  ).get();
  return row ? row.round_number : null;
}

// A round is ready for a winner once it has at least one approved work and
// the most recent approved_at among that round's approved works is 7+ days
// in the past — the same window archiveOldWorks() already uses per work. A
// still-pending work in the round is invisible to this query (it only looks
// at review_status='approved'), so it never holds up the round.
function roundStats(roundNumber) {
  const row = db.prepare(
    "SELECT COUNT(*) AS n, MAX(approved_at) AS latest FROM works WHERE round_number=? AND review_status='approved'"
  ).get(roundNumber);
  const ready = row.n > 0 && !!row.latest
    && db.prepare("SELECT datetime(?, '+7 days') <= datetime('now') AS ready").get(row.latest).ready === 1;
  return { approvedCount: row.n, ready };
}

// Fisher-Yates, in place on a copy — used to hide the view_count ranking
// behind the public leaderboard (see GET /api/on-view/leaderboard).
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Auto-archive ──────────────────────────────────────────────────────────────

// The UPDATE only ever matches rows still in status='previous', so a work is
// archived (and mailed) exactly once — a restart within the same hour just
// re-runs the query against rows that are already 'archived' and matches none.
// The 7-day wall window runs from approved_at, not created_at — otherwise a
// submission that waits days for review would get a shortened (or zero)
// visible run once approved. approved_at is null for rows grandfathered as
// approved by the review-step migration (they predate any pending period),
// so COALESCE falls back to created_at for exactly those, preserving their
// original archive timing.
async function archiveOldWorks() {
  const rows = db.prepare(
    "UPDATE works SET status='archived' WHERE status='previous' AND review_status='approved' AND datetime(COALESCE(approved_at, created_at), '+7 days') <= datetime('now') RETURNING slug, title, email"
  ).all();
  if (rows.length > 0) console.log(`[archive] archived ${rows.length} work(s)`);
  for (const row of rows) {
    if (!row.email) continue;
    await sendEmail({
      to:      row.email,
      subject: 'Your work has come down from On View',
      html:    `<p>"${row.title}" was on the wall for seven days. It comes down today.</p>`
             + `<p>The page stays online: <a href="${SITE_URL}/work/${row.slug}">${SITE_URL}/work/${row.slug}</a></p>`
             + `<p>On View runs every week. Submit again: <a href="${SITE_URL}/submit">${SITE_URL}/submit</a></p>`
             + `<p>Thank you for showing your work.</p>`
             + `<p>Creative regards,<br>Get Inspired Society</p>`,
    });
  }
}

// ── Admin session (reset on restart — acceptable for internal tool) ────────────

const ADMIN_SESSION = crypto.createHash('sha256').update('gis-admin:' + ADMIN_PWD).digest('hex');

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (token !== ADMIN_SESSION) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── hCaptcha ──────────────────────────────────────────────────────────────────

async function verifyHcaptcha(token) {
  if (!HCAPTCHA_SECRET) { console.warn('[captcha] HCAPTCHA_SECRET not set — skipping verification'); return true; }
  try {
    const r = await fetch('https://api.hcaptcha.com/siteverify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `secret=${encodeURIComponent(HCAPTCHA_SECRET)}&response=${encodeURIComponent(token)}`,
    });
    const data = await r.json();
    return data.success === true;
  } catch (e) {
    console.error('[captcha] verification error:', e.message);
    return false;
  }
}

// ── Rate-limiting ─────────────────────────────────────────────────────────────

const contactRequests = new Map();

function allowContact(ip) {
  const now    = Date.now();
  const window = 15 * 60 * 1000;
  const limit  = 5;
  const hits   = (contactRequests.get(ip) || []).filter(t => now - t < window);
  if (hits.length >= limit) return false;
  hits.push(now);
  contactRequests.set(ip, hits);
  return true;
}

// /submit is public (no token needed) as of the open call — same
// sliding-window pattern and limit as allowContact, kept as its own Map so
// the two actions don't share one quota.
const submitRequests = new Map();

function allowSubmit(ip) {
  const now    = Date.now();
  const window = 15 * 60 * 1000;
  const limit  = 5;
  const hits   = (submitRequests.get(ip) || []).filter(t => now - t < window);
  if (hits.length >= limit) return false;
  hits.push(now);
  submitRequests.set(ip, hits);
  return true;
}

// Caps how many /work/:slug requests from one IP can affect the view count,
// independent of the 24h visitor-hash dedup (see "View counting" below) —
// that dedup alone can't stop a script that sends a new User-Agent on every
// request. Only gates the counting step: an IP over the limit still gets the
// page normally, so a burst never turns into a blocked visitor.
const workViewRequests = new Map();

function allowWorkView(ip) {
  const now    = Date.now();
  const window = 60 * 1000;
  const limit  = 20;
  const hits   = (workViewRequests.get(ip) || []).filter(t => now - t < window);
  if (hits.length >= limit) return false;
  hits.push(now);
  workViewRequests.set(ip, hits);
  return true;
}

// ── Email ─────────────────────────────────────────────────────────────────────

const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;

async function sendEmail({ to, subject, html }) {
  if (!resend) { console.warn('[email] Resend not configured — skipped:', subject); return; }
  try { await resend.emails.send({ from: FROM_EMAIL, to, subject, html }); }
  catch (e) { console.error('[email] send error:', e.message); }
}

// archiveOldWorks() calls sendEmail(), so it must not run before sendEmail
// (and the resend client it closes over) is defined above.
archiveOldWorks();
const archiveInterval = setInterval(archiveOldWorks, 60 * 60 * 1000);

// ── View counting ────────────────────────────────────────────────────────────
// A view counts once per visitor per work per 24h. "Visitor" is a salted hash
// of IP + user-agent, checked against work_views — the raw IP is never stored.

const VISITOR_HASH_SALT = process.env.VISITOR_HASH_SALT || '';
if (!VISITOR_HASH_SALT) console.warn('[views] VISITOR_HASH_SALT not set — falling back to a fixed empty salt');

function hashVisitor(ip, userAgent) {
  return crypto.createHash('sha256').update(VISITOR_HASH_SALT + '|' + ip + '|' + userAgent).digest('hex');
}

// Rolling window, not tied to any weekly/round logic — that doesn't exist yet.
function cleanupOldViews() {
  const n = db.prepare("DELETE FROM work_views WHERE datetime(viewed_at, '+30 days') <= datetime('now')").run().changes;
  if (n > 0) console.log(`[views] cleaned up ${n} work_views row(s) older than 30 days`);
}

cleanupOldViews();
const viewCleanupInterval = setInterval(cleanupOldViews, 24 * 60 * 60 * 1000);

// ── Upload middleware ─────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter(_, file, cb) {
    cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype));
  },
});

// ── App middleware ────────────────────────────────────────────────────────────

app.set('trust proxy', 1); // Railway sits behind a proxy; needed for correct req.ip
app.use(express.json());

// Serve uploads from volume path (works regardless of where UPLOAD_DIR is)
app.use('/uploads', express.static(UPLOAD_DIR));

app.use(express.static(path.join(__dirname, 'public')));

// ── Plausible analytics proxy ───────────────────────────────────────────────────
// Reverse-proxied via the site's own domain so adblockers/tracker-blockers that
// target the plausible.io hostname don't skew the numbers (brief §4).

app.get('/js/:file', async (req, res) => {
  if (!/^[\w-]+\.js$/.test(req.params.file)) return res.status(404).end();
  try {
    const upstream = await fetch(`https://plausible.io/js/${req.params.file}`);
    if (!upstream.ok) return res.status(upstream.status).end();
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/javascript');
    const cacheControl = upstream.headers.get('cache-control');
    if (cacheControl) res.set('Cache-Control', cacheControl);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    console.error('[plausible] script proxy error:', e.message);
    res.status(502).end();
  }
});

// Plausible's script sends the event payload as JSON but with a non-standard
// Content-Type (to avoid a CORS preflight), so the global express.json() above
// won't parse it — this route-level parser accepts any Content-Type as JSON.
app.post('/api/event', express.json({ type: () => true }), async (req, res) => {
  try {
    const upstream = await fetch('https://plausible.io/api/event', {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'User-Agent':       req.headers['user-agent'] || '',
        'X-Forwarded-For':  req.ip || req.socket.remoteAddress || '',
      },
      body: JSON.stringify(req.body),
    });
    res.status(upstream.status).end();
  } catch (e) {
    console.error('[plausible] event proxy error:', e.message);
    res.status(502).end();
  }
});

// ── Public API ────────────────────────────────────────────────────────────────

app.get('/api/works', (req, res) => {
  const rows = db.prepare(
    "SELECT slug,title,artist,portfolio,image_url AS image,status FROM works " +
    "WHERE status != 'archived' AND review_status = 'approved' " +
    "ORDER BY CASE status WHEN 'current' THEN 0 ELSE 1 END, id DESC"
  ).all();
  res.json(rows.map(w => ({ ...w, current: w.status === 'current' })));
});

// Single work by slug — no lifecycle-status filter (so an archived work's page
// stays reachable), but still gated on review_status so a pending or rejected
// work behaves exactly like an unknown slug: 404.
app.get('/api/works/:slug', (req, res) => {
  const row = db.prepare(
    "SELECT slug,title,artist,portfolio,image_url AS image,status FROM works WHERE slug=? AND review_status='approved'"
  ).get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  res.json({ ...row, current: row.status === 'current' });
});

// Public top-10 of the active round for the "in the running" leaderboard
// (public/on-view/leaderboard/index.html). Deliberately excludes view_count
// from the response entirely and shuffles the order server-side — the
// business requirement is a public standings page that keeps the suspense,
// so nothing in the payload may reveal the ranking behind it. No active
// round: empty array, not a 404 — the page renders a quiet empty state.
app.get('/api/on-view/leaderboard', (req, res) => {
  const roundNumber = currentRoundNumber();
  if (roundNumber === null) return res.json([]);
  const rows = db.prepare(
    "SELECT slug, title, artist, image_url AS image FROM works " +
    "WHERE round_number = ? AND review_status = 'approved' " +
    "ORDER BY view_count DESC LIMIT 10"
  ).all(roundNumber);
  res.json(shuffle(rows));
});

// Shuffled selection of up to 4 works for the homepage "Currently on view"
// tiles. Same pattern as the leaderboard above: query the whole eligible set
// (approved, not archived — exactly what /on-view rotates through), shuffle
// server-side, slice after. A fixed "newest first" order would structurally
// favour those works with more views, which is unfair now that views decide
// the round winner, and it doesn't fit "No algorithm decides what's here."
app.get('/api/on-view/tiles', (req, res) => {
  const rows = db.prepare(
    "SELECT slug, title, artist, image_url AS image FROM works " +
    "WHERE status != 'archived' AND review_status = 'approved'"
  ).all();
  res.json(shuffle(rows).slice(0, 4));
});

// The active round's number and window for the homepage open-call hero. Only
// those three fields, ISO 8601 in UTC; null (not a 404) when no round is
// active, so the hero can just hide that one cell.
app.get('/api/on-view/round', (req, res) => {
  const roundNumber = currentRoundNumber();
  if (roundNumber === null) return res.json(null);
  const row = db.prepare('SELECT round_number, starts_at, ends_at FROM rounds WHERE round_number=?').get(roundNumber);
  const iso = t => t.replace(' ', 'T') + 'Z';
  res.json({ round_number: row.round_number, starts_at: iso(row.starts_at), ends_at: iso(row.ends_at) });
});

app.post('/api/contact', async (req, res) => {
  const { message, email, hp, captcha } = req.body || {};
  if (hp) return res.json({ ok: true }); // honeypot — silent, no captcha/rate-limit slot consumed
  if (!captcha) return res.status(400).json({ error: 'Please complete the captcha.' });
  const captchaOk = await verifyHcaptcha(captcha);
  if (!captchaOk) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  const ip = req.ip || req.socket.remoteAddress || '';
  if (!allowContact(ip)) return res.status(429).json({ error: 'Too many messages. Please wait a few minutes.' });
  if (!message?.trim() || !email?.trim())             return res.status(400).json({ error: 'Required fields missing.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))     return res.status(400).json({ error: 'Invalid email address.' });
  await sendEmail({
    to:      ADMIN_EMAIL,
    subject: `GIS contact from ${email}`,
    html:    `<p><b>From:</b> ${email}</p><p>${message.replace(/\n/g, '<br>')}`,
  });
  res.json({ ok: true });
});

app.get('/api/tokens/:token', (req, res) => {
  const row = db.prepare('SELECT artist_name, used FROM tokens WHERE token=?').get(req.params.token);
  if (!row || row.used) return res.status(404).json({ error: 'Invalid or already used.' });
  res.json({ artist_name: row.artist_name });
});

// ── Hand-in ───────────────────────────────────────────────────────────────────

app.post('/hand-in/:token', upload.single('image'), async (req, res) => {
  try {
    const tokenRow = db.prepare('SELECT * FROM tokens WHERE token=?').get(req.params.token);
    if (!tokenRow || tokenRow.used) return res.status(404).json({ error: 'Invalid or already used link.' });

    const { work_title } = req.body || {};
    if (!work_title?.trim()) return res.status(400).json({ error: 'Please enter a title.' });
    if (!req.file)           return res.status(400).json({ error: 'No image uploaded.' });

    const filename = crypto.randomUUID() + '.webp';
    try {
      await sharp(req.file.buffer)
        .rotate()
        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(path.join(UPLOAD_DIR, filename));
    } catch (e) {
      console.error('[hand-in] sharp error:', e.message);
      return res.status(400).json({ error: 'Could not process image.' });
    }

    const title    = work_title.trim();
    const name     = tokenRow.artist_name;
    const email    = tokenRow.artist_email;
    const baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'work';
    let slug = baseSlug;
    let suffix = 1;
    while (db.prepare('SELECT id FROM works WHERE slug=?').get(slug)) {
      slug = baseSlug + '-' + (suffix++);
    }

    db.prepare('INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status,round_number) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(slug, title, name, email, '#', '/uploads/' + filename, 'previous', 'pending', currentRoundNumber());

    db.prepare('UPDATE tokens SET used=1 WHERE token=?').run(req.params.token);

    console.log('[hand-in] received:', name, email, slug);

    await Promise.all([
      sendEmail({
        to:      ADMIN_EMAIL,
        subject: `Pending approval: "${title}" by ${name}`,
        html:    `<p>${name} (${email}) handed in a work — pending your approval.<br>Title: ${title}<br><br>Review it: <a href="${SITE_URL}/admin">${SITE_URL}/admin</a></p>`,
      }),
      sendEmail({
        to:      email,
        subject: 'Your work is in, Get Inspired Society',
        html:    `<p>${name},</p><p>We have received your work "<b>${title}</b>".</p><p>We will let you know when it goes on the wall.</p><p>Creative regards,<br>Get Inspired Society</p>`,
      }),
    ]);

    res.json({ ok: true });
  } catch (e) {
    console.error('[hand-in] unexpected error:', e.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Submit ────────────────────────────────────────────────────────────────────

app.post('/api/submit', upload.single('image'), async (req, res) => {
  try {
    const { name, email, portfolio, work_title, hp, captcha } = req.body || {};

    if (hp) return res.json({ ok: true }); // honeypot — silent, no captcha/rate-limit slot consumed
    if (!captcha) return res.status(400).json({ error: 'Please complete the captcha.' });
    const captchaOk = await verifyHcaptcha(captcha);
    if (!captchaOk) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
    const ip = req.ip || req.socket.remoteAddress || '';
    if (!allowSubmit(ip)) return res.status(429).json({ error: 'Too many submissions. Please wait a few minutes.' });

    if (!name?.trim() || !email?.trim())            return res.status(400).json({ error: 'Name and email are required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
    if (!portfolio?.trim())                          return res.status(400).json({ error: 'Portfolio URL is required.' });
    if (!req.file)                                  return res.status(400).json({ error: 'No image uploaded.' });

    // Duplicate check: an unresolved submission (pending or approved, and
    // still on the wall) for this email already exists. A rejected work must
    // not count here — it's a resolved outcome, not an active hold, so it
    // must never permanently block a future attempt.
    const existing = db.prepare("SELECT id FROM works WHERE email=? AND status!='archived' AND review_status IN ('pending','approved')").get(email.trim());
    if (existing) return res.status(409).json({ error: "You already have a submission pending review or on the wall. Try again once that's resolved." });

    const filename = crypto.randomUUID() + '.webp';
    try {
      await sharp(req.file.buffer)
        .rotate()
        .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(path.join(UPLOAD_DIR, filename));
    } catch (e) {
      console.error('[submit] sharp error:', e.message);
      return res.status(400).json({ error: 'Could not process image.' });
    }

    const title     = work_title?.trim() || name.trim();
    const baseSlug  = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'work';
    let slug = baseSlug;
    let suffix = 1;
    while (db.prepare('SELECT id FROM works WHERE slug=?').get(slug)) {
      slug = baseSlug + '-' + (suffix++);
    }

    const imagePath = '/uploads/' + filename;
    db.prepare('INSERT INTO works (slug,title,artist,email,portfolio,image_url,status,review_status,round_number) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(slug, title, name.trim(), email.trim(), portfolio.trim(), imagePath, 'previous', 'pending', currentRoundNumber());

    console.log('[submit] added work:', name, email, slug);

    await Promise.all([
      sendEmail({
        to:      ADMIN_EMAIL,
        subject: `Pending approval: "${title}" by ${name}`,
        html:    `<p>${name} (${email}) submitted a work — pending your approval.<br>Portfolio: ${portfolio}<br>Title: ${title}<br><br>Review it: <a href="${SITE_URL}/admin">${SITE_URL}/admin</a></p>`,
      }),
      sendEmail({
        to:      email.trim(),
        subject: 'Your work is in, Get Inspired Society',
        html:    `<p>Hi ${name},</p><p>We have received your work "<b>${title}</b>". We will let you know when it goes on the wall.</p><p>Creative regards,<br>Get Inspired Society</p>`,
      }),
    ]);

    res.json({ ok: true });
  } catch (e) {
    console.error('[submit] unexpected error:', e.message, e.stack);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Admin auth ────────────────────────────────────────────────────────────────

app.post('/api/admin/auth', (req, res) => {
  if ((req.body || {}).password === ADMIN_PWD) return res.json({ token: ADMIN_SESSION });
  res.status(401).json({ error: 'Wrong password.' });
});

// ── Admin: works ──────────────────────────────────────────────────────────────

app.get('/api/admin/works', requireAdmin, (req, res) => {
  res.json(db.prepare(
    "SELECT *, (SELECT COUNT(*) FROM work_views wv WHERE wv.work_id = works.id) AS raw_views FROM works " +
    "ORDER BY CASE status WHEN 'current' THEN 0 WHEN 'previous' THEN 1 ELSE 2 END, id DESC"
  ).all());
});

app.post('/api/admin/works', requireAdmin, (req, res) => {
  const { slug, title, artist, portfolio, image_url, status } = req.body || {};
  if (!slug || !title || !artist || !image_url) return res.status(400).json({ error: 'Missing required fields.' });
  try {
    const r = db.prepare('INSERT INTO works (slug,title,artist,portfolio,image_url,status) VALUES (?,?,?,?,?,?)').run(
      slug, title, artist, portfolio || '#', image_url, status || 'previous'
    );
    res.json({ id: r.lastInsertRowid });
  } catch { res.status(409).json({ error: 'Slug already exists.' }); }
});

app.patch('/api/admin/works/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['current','previous','archived'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  db.prepare('UPDATE works SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/works/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM works WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/works/:id/approve', requireAdmin, async (req, res) => {
  const row = db.prepare(
    "UPDATE works SET review_status='approved', approved_at=datetime('now') WHERE id=? RETURNING slug, title, artist, email"
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (row.email) {
    await sendEmail({
      to:      row.email,
      subject: 'Your work is on the wall, Get Inspired Society',
      html:    `<p>${row.artist},</p><p>"${row.title}" is now on the wall.<br><a href="${SITE_URL}/work/${row.slug}">${SITE_URL}/work/${row.slug}</a></p>`
             + `<p>It stays up for seven days.</p>`
             + `<p>This week's wall is also a contest. The work with the most views on its page by the end of the week wins a t-shirt. Sharing your link is one way to get more views.</p>`
             + `<p>Example: "My work &quot;${row.title}&quot; is on the wall at Get Inspired Society this week. ${SITE_URL}/work/${row.slug}"</p>`
             + `<p>Suggested hashtag: #GetInspiredSociety</p>`
             + `<p>Creative regards,<br>Get Inspired Society</p>`,
    });
  }
  res.json({ ok: true });
});

app.post('/api/admin/works/:id/reject', requireAdmin, async (req, res) => {
  const row = db.prepare(
    "UPDATE works SET review_status='rejected' WHERE id=? RETURNING artist, email"
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (row.email) {
    await sendEmail({
      to:      row.email,
      subject: 'Your submission, Get Inspired Society',
      html:    `<p>${row.artist},</p><p>Thanks for sharing your work. We're not able to feature it on On View this time. We'd love to see what you submit next.</p>`
             + `<p>Creative regards,<br>Get Inspired Society</p>`,
    });
  }
  res.json({ ok: true });
});

// ── Admin: rounds ─────────────────────────────────────────────────────────────
// Rounds themselves are created by hand via SQL (see CLAUDE.md) — no
// create/edit UI here, only the read-only overview and the one-time
// winner action, per the epic's scope.

app.get('/api/admin/rounds', requireAdmin, (req, res) => {
  const rounds = db.prepare('SELECT * FROM rounds ORDER BY round_number DESC').all();
  res.json(rounds.map(r => {
    const stats = roundStats(r.round_number);
    const winner = r.winner_work_id
      ? db.prepare('SELECT slug, title, artist, view_count FROM works WHERE id=?').get(r.winner_work_id)
      : null;
    return {
      ...r,
      approved_count: stats.approvedCount,
      status: r.announced_at ? 'winner_announced' : (stats.ready ? 'ready_for_winner' : 'ongoing'),
      winner,
    };
  }));
});

// Winner: chosen by hand by the admin (body: { work_id }), not derived from
// view_count. Only a ready, not yet announced round accepts a choice, and the
// chosen work must be an approved work of that very round (archived ones
// count: by the time a round is ready, its early works have long come down).
app.post('/api/admin/rounds/:round_number/announce-winner', requireAdmin, (req, res) => {
  const roundNumber = Number(req.params.round_number);
  const round = db.prepare('SELECT * FROM rounds WHERE round_number=?').get(roundNumber);
  if (!round) return res.status(404).json({ error: 'Round not found.' });
  if (round.announced_at) return res.status(409).json({ error: 'Winner already announced for this round.' });
  if (!roundStats(roundNumber).ready) return res.status(400).json({ error: 'This round is not ready for a winner yet.' });

  const workId = Number((req.body || {}).work_id);
  if (!Number.isInteger(workId)) return res.status(400).json({ error: 'Choose a work to announce as the winner.' });
  const winner = db.prepare(
    "SELECT id, slug, title, artist, view_count FROM works WHERE id=? AND round_number=? AND review_status='approved'"
  ).get(workId, roundNumber);
  if (!winner) return res.status(400).json({ error: 'That work is not an approved work of this round.' });

  db.prepare("UPDATE rounds SET winner_work_id=?, announced_at=datetime('now') WHERE round_number=?").run(winner.id, roundNumber);
  res.json({ ok: true, winner });
});

app.post('/api/admin/tokens', requireAdmin, (req, res) => {
  const { artist_name, artist_email } = req.body || {};
  if (!artist_name?.trim() || !artist_email?.trim()) return res.status(400).json({ error: 'Name and email required.' });
  const token = crypto.randomUUID();
  db.prepare('INSERT INTO tokens (token, artist_name, artist_email) VALUES (?,?,?)')
    .run(token, artist_name.trim(), artist_email.trim());
  res.json({ token, url: `${SITE_URL}/hand-in/${token}` });
});

// ── Page routes ───────────────────────────────────────────────────────────────

// /submit is public now — old shared-token links still work via a redirect,
// for any token value (the token itself is no longer checked or needed).
app.get('/submit/:token', (req, res) => {
  res.redirect(301, '/submit');
});

// ── Work page — server-rendered Open Graph / Twitter Card tags ────────────────
// Social crawlers don't execute JS, so the per-work title/image/description
// have to be in the raw HTML response, not filled in client-side.

const WORK_TEMPLATE  = fs.readFileSync(path.join(__dirname, 'public', 'work', 'index.html'), 'utf8');
const OG_DESCRIPTION = 'A weekly work on Get Inspired Society';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── OG image — on-the-fly JPEG conversion, cached on disk ──────────────────────
// WhatsApp's link-preview crawler has long-standing, widely reported problems
// rendering WebP as og:image (the wall's native format), plus its own file-size
// guidance separate from format. Converting at request time — rather than
// generating a second variant at upload — covers every work regardless of when
// or how its image arrived (existing uploads, freshly submitted ones, and the
// external picsum.photos URLs in the seed data), with no changes to the upload
// pipeline, EXIF stripping, or the wall's own webp rendering.
const OG_CACHE_DIR    = path.join(path.dirname(DB_PATH), 'og-cache');
const OG_IMAGE_WIDTH  = 1200;
const OG_IMAGE_HEIGHT = 630;
const OG_MAX_BYTES    = 500 * 1024; // stay safely under WhatsApp's ~600KB guidance
fs.mkdirSync(OG_CACHE_DIR, { recursive: true });

async function loadSourceImageBuffer(imageUrl) {
  if (!imageUrl) {
    return fs.readFileSync(path.join(__dirname, 'public', 'assets', 'gallery-poster.webp'));
  }
  if (/^https?:\/\//i.test(imageUrl)) {
    const r = await fetch(imageUrl);
    if (!r.ok) throw new Error('source image fetch failed: ' + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  const localPath = imageUrl.startsWith('/uploads/')
    ? path.join(UPLOAD_DIR, path.basename(imageUrl))
    : path.join(__dirname, 'public', imageUrl.replace(/^\//, ''));
  return fs.readFileSync(localPath);
}

async function convertToOgJpeg(sourceBuffer) {
  let quality = 82;
  let out;
  do {
    out = await sharp(sourceBuffer)
      .resize(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, { fit: 'cover' })
      .jpeg({ quality })
      .toBuffer();
    quality -= 12;
  } while (out.length > OG_MAX_BYTES && quality >= 40);
  return out;
}

app.get('/og-image/:slug', async (req, res) => {
  const row = db.prepare('SELECT image_url FROM works WHERE slug=?').get(req.params.slug);
  const cacheKey  = row ? req.params.slug : '__fallback__';
  const cachePath = path.join(OG_CACHE_DIR, cacheKey + '.jpg');

  try {
    if (!fs.existsSync(cachePath)) {
      const source = await loadSourceImageBuffer(row && row.image_url);
      const jpeg = await convertToOgJpeg(source);
      fs.writeFileSync(cachePath, jpeg);
    }
    res.type('image/jpeg').send(fs.readFileSync(cachePath));
  } catch (e) {
    console.error('[og-image] failed for slug', req.params.slug, e.message);
    res.status(500).end();
  }
});

function renderWorkPage(work, slug) {
  const title = work ? `${work.title} by ${work.artist}` : 'Work not found';
  const image = `${SITE_URL}/og-image/${slug}`;
  const url   = `${SITE_URL}/work/${slug}`;

  const ogTags = [
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(OG_DESCRIPTION)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join('\n');

  return WORK_TEMPLATE
    .replace('<!-- @meta:og -->', ogTags)
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)} — Get Inspired Society</title>`);
}

// Known link-preview/OG-scraper user-agent substrings, checked case-insensitively.
// Excluded from the view count only — they still get the page and its OG tags
// normally, that's the whole point of them visiting. Fail-open: an unknown or
// missing User-Agent still counts as a view.
const SCRAPER_USER_AGENTS = [
  'facebookexternalhit', // Facebook / Instagram — Meta's single crawler UA unfurls links for both
  'twitterbot',          // X / Twitter (also matches Telegram's "TelegramBot (like TwitterBot)", which is fine — both should be excluded)
  'whatsapp',            // WhatsApp
  'linkedinbot',         // LinkedIn
  'slackbot',            // Slack
  'discordbot',          // Discord
  'telegrambot',         // Telegram
];

function isScraperUserAgent(userAgent) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return SCRAPER_USER_AGENTS.some(s => ua.includes(s));
}

app.get('/work/:slug', (req, res) => {
  const row = db.prepare(
    "SELECT id,slug,title,artist,portfolio,image_url AS image,status FROM works WHERE slug=? AND review_status='approved'"
  ).get(req.params.slug);
  // Known OG-preview scrapers are excluded so a shared link doesn't inflate
  // the count before a single human has opened it. Real visits count once
  // per visitor hash per 24h (see "View counting" above); the per-IP rate
  // limiter there additionally caps a script that varies its User-Agent to
  // dodge that dedup. Either way the page itself always renders normally.
  if (row && !isScraperUserAgent(req.headers['user-agent'])) {
    const ip = req.ip || req.socket.remoteAddress || '';
    if (allowWorkView(ip)) {
      const visitorHash = hashVisitor(ip, req.headers['user-agent'] || '');
      const alreadyCounted = db.prepare(
        "SELECT 1 FROM work_views WHERE work_id=? AND visitor_hash=? AND datetime(viewed_at, '+24 hours') > datetime('now') LIMIT 1"
      ).get(row.id, visitorHash);
      if (!alreadyCounted) {
        db.prepare('INSERT INTO work_views (work_id, visitor_hash) VALUES (?,?)').run(row.id, visitorHash);
        db.prepare('UPDATE works SET view_count = view_count + 1 WHERE id=?').run(row.id);
      }
    }
  }
  res.send(renderWorkPage(row, req.params.slug));
});

app.get('/hand-in', (req, res) => res.status(404).send('Not found'));

app.get('/hand-in/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hand-in', 'index.html'));
});

const httpServer = app.listen(PORT, () => console.log(`GIS server on port ${PORT}`));

// ── Graceful shutdown ────────────────────────────────────────────────────────
// Railway sends SIGTERM on every redeploy, not just real crashes. Without
// this, npm's script wrapper logs "npm error signal SIGTERM" when the
// process dies from the signal, and Railway reports it as a crash even
// though the server was healthy. Stop accepting new connections, let
// in-flight requests finish, close the DB cleanly, then exit(0).

function shutdown(signal) {
  console.log(`[shutdown] Graceful shutdown gestart (${signal})`);

  const forceExitTimer = setTimeout(() => {
    console.error('[shutdown] Timeout bereikt na 10s — forceer afsluiten');
    process.exit(1);
  }, 10000);

  clearInterval(archiveInterval);
  clearInterval(viewCleanupInterval);

  httpServer.close((err) => {
    if (err) console.error('[shutdown] Fout bij sluiten HTTP-server:', err.message);
    try {
      db.close();
      console.log('[shutdown] Database gesloten');
    } catch (e) {
      console.error('[shutdown] Fout bij sluiten database:', e.message);
    }
    clearTimeout(forceExitTimer);
    console.log('[shutdown] Klaar, proces sluit af');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
