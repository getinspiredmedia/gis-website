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
const UPLOAD_DIR   = path.join(__dirname, 'public', 'uploads');
const ADMIN_PWD    = process.env.ADMIN_PASSWORD || 'admin';
const SUBMIT_TOKEN = process.env.SUBMIT_TOKEN  || '';
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.RESEND_FROM   || 'noreply@getinspiredsociety.com';
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL   || 'andrekreft@gmail.com';
const SITE_URL     = process.env.SITE_URL      || 'https://gis-website-production.up.railway.app';

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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed works from static JSON when database is empty
if (db.prepare('SELECT COUNT(*) as n FROM works').get().n === 0) {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'data', 'works.json'), 'utf8'));
  const ins  = db.prepare('INSERT OR IGNORE INTO works (slug,title,artist,portfolio,image_url,status) VALUES (?,?,?,?,?,?)');
  db.transaction(rows => rows.forEach(r =>
    ins.run(r.slug, r.title, r.artist, r.portfolio || '#', r.image, r.current ? 'current' : 'previous')
  ))(seed);
}

// Migrations for existing databases
try { db.exec("ALTER TABLE works ADD COLUMN email TEXT NOT NULL DEFAULT ''"); } catch {}

// ── Auto-archive ──────────────────────────────────────────────────────────────

function archiveOldWorks() {
  const n = db.prepare(
    "UPDATE works SET status='archived' WHERE status='previous' AND datetime(created_at, '+7 days') <= datetime('now')"
  ).run().changes;
  if (n > 0) console.log(`[archive] archived ${n} work(s)`);
}

archiveOldWorks();
setInterval(archiveOldWorks, 60 * 60 * 1000);

// ── Admin session (reset on restart — acceptable for internal tool) ────────────

const ADMIN_SESSION = crypto.createHash('sha256').update('gis-admin:' + ADMIN_PWD).digest('hex');

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (token !== ADMIN_SESSION) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Email ─────────────────────────────────────────────────────────────────────

const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;

async function sendEmail({ to, subject, html }) {
  if (!resend) { console.warn('[email] Resend not configured — skipped:', subject); return; }
  try { await resend.emails.send({ from: FROM_EMAIL, to, subject, html }); }
  catch (e) { console.error('[email] send error:', e.message); }
}

// ── Upload middleware ─────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter(_, file, cb) {
    cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype));
  },
});

// ── App middleware ────────────────────────────────────────────────────────────

app.use(express.json());

// Block /submit without token — must go before static so /submit/index.html isn't served directly
app.get('/submit', (req, res) => res.status(404).send('Not found'));

app.use(express.static(path.join(__dirname, 'public')));

// ── Public API ────────────────────────────────────────────────────────────────

app.get('/api/works', (req, res) => {
  const rows = db.prepare(
    "SELECT slug,title,artist,portfolio,image_url AS image,status FROM works " +
    "WHERE status != 'archived' " +
    "ORDER BY CASE status WHEN 'current' THEN 0 ELSE 1 END, id DESC"
  ).all();
  res.json(rows.map(w => ({ ...w, current: w.status === 'current' })));
});

// Single work by slug — no status filter, used for fallback display of archived works
app.get('/api/works/:slug', (req, res) => {
  const row = db.prepare(
    'SELECT slug,title,artist,portfolio,image_url AS image,status FROM works WHERE slug=?'
  ).get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  res.json({ ...row, current: row.status === 'current' });
});

app.post('/api/contact', async (req, res) => {
  const { message, email, hp } = req.body || {};
  if (hp)                                             return res.json({ ok: true }); // honeypot
  if (!message?.trim() || !email?.trim())             return res.status(400).json({ error: 'Required fields missing.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))     return res.status(400).json({ error: 'Invalid email address.' });
  await sendEmail({
    to:      ADMIN_EMAIL,
    subject: `GIS contact from ${email}`,
    html:    `<p><b>From:</b> ${email}</p><p>${message.replace(/\n/g, '<br>')}`,
  });
  res.json({ ok: true });
});

// ── Submit ────────────────────────────────────────────────────────────────────

app.post('/api/submit', upload.single('image'), async (req, res) => {
  try {
    const { name, email, portfolio, work_title } = req.body || {};

    if (!name?.trim() || !email?.trim())            return res.status(400).json({ error: 'Name and email are required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
    if (!portfolio?.trim())                          return res.status(400).json({ error: 'Portfolio URL is required.' });
    if (!req.file)                                  return res.status(400).json({ error: 'No image uploaded.' });

    // Duplicate check: active (non-archived) work for this email
    const existing = db.prepare("SELECT id FROM works WHERE email=? AND status!='archived'").get(email.trim());
    if (existing) return res.status(409).json({ error: 'You already have a work on the wall. It will be archived after 7 days, then you can submit again.' });

    const filename = crypto.randomUUID() + '.webp';
    try {
      await sharp(req.file.buffer)
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
    db.prepare('INSERT INTO works (slug,title,artist,email,portfolio,image_url,status) VALUES (?,?,?,?,?,?,?)')
      .run(slug, title, name.trim(), email.trim(), portfolio.trim(), imagePath, 'previous');

    console.log('[submit] added work:', name, email, slug);

    await Promise.all([
      sendEmail({
        to:      ADMIN_EMAIL,
        subject: `New work on the wall: "${title}" by ${name}`,
        html:    `<p>${name} (${email}) submitted a work.<br>Portfolio: ${portfolio}<br>Title: ${title}<br><br>View: <a href="${SITE_URL}/admin">${SITE_URL}/admin</a></p>`,
      }),
      sendEmail({
        to:      email.trim(),
        subject: 'Your work is on the wall — Get Inspired Society',
        html:    `<p>Hi ${name},</p><p>Your work is now visible on On View.<br><a href="${SITE_URL}/on-view">${SITE_URL}/on-view</a></p><p>Share it with others!</p>`,
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
    "SELECT * FROM works ORDER BY CASE status WHEN 'current' THEN 0 WHEN 'previous' THEN 1 ELSE 2 END, id DESC"
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

// ── Page routes ───────────────────────────────────────────────────────────────

app.get('/submit/:token', (req, res) => {
  if (!SUBMIT_TOKEN || req.params.token !== SUBMIT_TOKEN) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'submit', 'index.html'));
});

app.get('/work/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'work', 'index.html'));
});

app.listen(PORT, () => console.log(`GIS server on port ${PORT}`));
