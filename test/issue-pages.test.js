'use strict';
/*
 * /magazine/<slug> is now its own issue page (built from build/pages/issue.html
 * + build/data/issues.js), not the reader. The reader moved 1:1 to
 * /magazine/<slug>/read. This test covers:
 *   1. each issue page's content (title/line/cover/artists/meta/buttons/OG),
 *      read from the built public/magazine/<slug>/index.html;
 *   2. exactly one statement per issue page;
 *   3. data-source vs. reader consistency, parsing each reader's own real
 *      ISSUE object rather than trusting the data source blindly;
 *   4. the redirect rule for old spread-carrying links (?spread=N) and that
 *      a bare /magazine/<slug> serves the issue page, not a redirect;
 *   5. the reader's footer "Magazine" link (its "Close", see CLAUDE.md)
 *      points back at its own issue page, not the generic archive;
 *   6. the pending-approval new-copy marker is reported, not silently lost.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const { ISSUES, UNAPPROVED_COPY } = require('../build/data/issues');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'test', '.issue-pages-test.db');
const UPLOAD_DIR = path.join(ROOT, 'test', '.issue-pages-test-uploads');
const PORT = 3211;
const BASE = `http://127.0.0.1:${PORT}`;

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
      fetch(BASE + '/').then(r => (r.ok ? resolve() : retry(n))).catch(() => retry(n));
    };
    const retry = (n) => {
      if (n <= 0) return reject(new Error('server did not come up'));
      setTimeout(() => attempt(n - 1), 300);
    };
    attempt(retries);
  });
}

function readPublic(p) {
  return fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');
}

// Parses a reader's real ISSUE object out of its own source, between the
// // issue:start / // issue:end markers, by evaluating the object literal
// in a sandbox — not a regex guess at individual fields.
function parseReaderIssue(slug) {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'magazine', slug, 'read', 'index.html'), 'utf8');
  const match = html.match(/const ISSUE = (\{[\s\S]*?\n\};)/);
  assert(match, `${slug}: could not find "const ISSUE = {...};" in the reader`);
  const sandbox = {};
  vm.createContext(sandbox);
  const issue = vm.runInContext('(' + match[1].slice(0, -1) + ')', sandbox);
  return issue;
}

function countOccurrences(haystack, needle) {
  return (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

async function run() {
  cleanupFiles();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  let child;
  try {
    child = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, DB_PATH, UPLOAD_DIR, PORT: String(PORT) },
      stdio: 'ignore',
    });
    await waitForServer(30);

    // ── 1-2-6: per-issue content, exactly one statement, OG tags, pending-copy marker ──
    for (const issue of ISSUES) {
      const html = readPublic(`magazine/${issue.slug}/index.html`);
      const room = String(issue.number).padStart(2, '0');

      assert(html.includes(`data-reveal-group="hero">${issue.title}</h1>`), `${issue.slug}: hero title is "${issue.title}"`);
      assert(html.includes(`<p class="lede rv" data-reveal-group="hero">${issue.line}</p>`), `${issue.slug}: hero lede is the issue's own line`);
      // The hero's own cover (heroCover): for Bloom, the responsive srcset
      // generated from its master; for the other three (no master), the
      // existing cover file used as-is, no object-fit:cover cropping and
      // real width/height attributes so the box takes the real ratio.
      const hc = issue.heroCover;
      if (hc.responsiveBase) {
        const widest = hc.responsiveWidths[hc.responsiveWidths.length - 1];
        assert(html.includes(`src="${hc.responsiveBase}-${widest}.jpg"`), `${issue.slug}: hero cover fallback src is the widest JPEG variant`);
        assert(html.includes(`srcset="${hc.responsiveBase}-${hc.responsiveWidths[0]}.avif`), `${issue.slug}: hero cover has an AVIF srcset from the master`);
      } else {
        assert(html.includes(`src="${hc.src}"`), `${issue.slug}: hero cover src is ${hc.src}`);
      }
      assert(html.includes(`width="${hc.width}" height="${hc.height}"`), `${issue.slug}: hero cover carries its real width/height attributes (${hc.width}x${hc.height})`);
      assert(!/\.i-cover\{[^}]*object-fit:\s*cover/.test(html), `${issue.slug}: .i-cover has no object-fit:cover rule (would crop the cover)`);
      assert(!/\.i-cover\{[^}]*aspect-ratio/.test(html), `${issue.slug}: .i-cover has no hardcoded aspect-ratio (the box takes the real cover ratio instead)`);
      assert(html.includes(`view-transition-name:issue-${room}`), `${issue.slug}: hero cover carries view-transition-name:issue-${room}`);
      assert(html.includes(`data-reveal-group="hero">Issue ${room}</span>`), `${issue.slug}: eyebrow reads "Issue ${room}"`);

      assert(html.includes(`href="/magazine/${issue.slug}/read"`), `${issue.slug}: "Read the issue" button points at /read`);
      assert(html.includes(`>Read the issue<`), `${issue.slug}: "Read the issue" label present`);
      assert(html.includes(`href="${issue.pdf}" download`), `${issue.slug}: "Download the PDF" button links the real PDF`);
      assert(html.includes(`>Download the PDF<`), `${issue.slug}: button label is the reader's own "Download the PDF", not an invented "Download PDF"`);
      assert(html.includes(`href="${issue.peecho}" target="_blank" rel="noopener"`), `${issue.slug}: "Order a print" button links Peecho, new tab`);
      assert(html.includes(`>Order a print<`), `${issue.slug}: button label is the reader's own "Order a print", not an invented "Order print"`);

      for (const a of issue.artists) {
        assert(html.includes(`<span class="name">${a.name}</span>`), `${issue.slug}: artist row for ${a.name}`);
        assert(html.includes(`href="/magazine/${issue.slug}/read?spread=${a.spread}"`), `${issue.slug}: ${a.name}'s row links to their own spread`);
      }

      const statementCount = countOccurrences(html, 'class="claim rv"');
      assert(statementCount === 1, `${issue.slug}: exactly one statement panel — got ${statementCount}`);
      assert(html.includes('Every issue<br>starts with<br>a question.'), `${issue.slug}: statement text matches the archive page's own text`);

      assert(html.includes(`<meta property="og:title" content="${issue.title}">`), `${issue.slug}: og:title`);
      assert(html.includes(`<meta property="og:description" content="${issue.line}">`), `${issue.slug}: og:description`);
      assert(html.includes(`<meta property="og:image" content="https://getinspiredsociety.com${issue.cover}">`), `${issue.slug}: og:image is a full URL`);
      assert(html.includes('<meta name="twitter:card" content="summary_large_image">'), `${issue.slug}: twitter:card`);

      const others = ISSUES.filter(i => i.slug !== issue.slug);
      others.forEach(o => {
        assert(html.includes(`href="/magazine/${o.slug}"`), `${issue.slug}: archive row links to /magazine/${o.slug}`);
      });

      assert(html.includes(UNAPPROVED_COPY.lookInsideLabel), `${issue.slug}: the pending-approval "Look inside" label is present on the page`);

      // Checked against the visible text only (HTML comments and script
      // bodies stripped first) — pre-existing shared partials (nav,
      // analytics) carry their own internal code comments with a long
      // dash, unrelated to this page's own copy and out of this task's
      // scope.
      const visibleText = html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/g, ' ');
      assert(!visibleText.includes('—'), `${issue.slug}: no long dash in the visible text`);
      assert(!/community/i.test(visibleText), `${issue.slug}: no "community" in the visible text`);
      assert(!visibleText.includes('Get Inspired Magazine'), `${issue.slug}: "Get Inspired Magazine" is not in the visible text`);
    }
    console.log('PASS - all four issue pages: title/line/cover/eyebrow, three buttons with the reader\'s own exact labels, five artist rows linking to their own spread, exactly one statement, OG tags, archive links to the other three issues, no long dash/"community"/"Get Inspired Magazine"');
    console.log(`REPORTED (pending approval, see build/data/issues.js UNAPPROVED_COPY): lookInsideLabel = ${JSON.stringify(UNAPPROVED_COPY.lookInsideLabel)}`);

    // ── 3: data source vs. reader consistency ──────────────────────────────
    for (const issue of ISSUES) {
      const real = parseReaderIssue(issue.slug);
      assert(real.title === issue.title, `${issue.slug}: data source title "${issue.title}" matches the reader's own "${real.title}"`);
      assert(real.cover === issue.cover, `${issue.slug}: data source cover matches the reader's own cover path`);
      assert(real.pdf === issue.pdf, `${issue.slug}: data source pdf matches the reader's own pdf path`);
      assert(real.spreads.length === issue.spreadCount, `${issue.slug}: data source spreadCount (${issue.spreadCount}) matches the reader's real spreads.length (${real.spreads.length})`);
      assert(real.artists.length === issue.artists.length, `${issue.slug}: same number of artists`);
      real.artists.forEach((a, i) => {
        const d = issue.artists[i];
        assert(d, `${issue.slug}: data source has an artist at index ${i}`);
        assert(a.name === d.name, `${issue.slug}: artist ${i} name matches ("${d.name}" vs reader's "${a.name}")`);
        assert(a.spread === d.spread, `${issue.slug}: artist ${i} spread number matches`);
        const spreadFromReader = real.spreads[a.spread - 1];
        assert(spreadFromReader && spreadFromReader.src === d.image, `${issue.slug}: artist ${i}'s tile image matches the reader's own spreads[${a.spread - 1}].src`);
        assert(spreadFromReader && spreadFromReader.alt === d.alt, `${issue.slug}: artist ${i}'s tile alt matches the reader's own spreads[${a.spread - 1}].alt`);
      });
    }
    console.log('PASS - build/data/issues.js matches every reader\'s own real ISSUE object (title, cover, pdf, spread count, artists, per-artist image/alt)');

    // ── 4: redirect rule ─────────────────────────────────────────────────────
    const redirected = await fetch(BASE + '/magazine/bloom?spread=5', { redirect: 'manual' });
    assert(redirected.status === 301, `GET /magazine/bloom?spread=5 answers 301, got ${redirected.status}`);
    assert(redirected.headers.get('location') === '/magazine/bloom/read?spread=5', `redirect target carries the same query string, got ${redirected.headers.get('location')}`);

    // express.static's own trailing-slash redirect (/magazine/bloom ->
    // /magazine/bloom/, pre-existing on every directory-style page, e.g.
    // /gallery) is unrelated to this task's redirect rule; following it is
    // the right check here, not asserting a literal 200 on the bare path.
    const bare = await fetch(BASE + '/magazine/bloom');
    assert(bare.status === 200, `GET /magazine/bloom (no query) eventually serves the issue page, got ${bare.status}`);
    const bareHtml = await bare.text();
    assert(bareHtml.includes('data-reveal-group="hero">Bloom</h1>'), 'GET /magazine/bloom serves the issue page, not the reader');

    const readerDirect = await fetch(BASE + '/magazine/bloom/read?spread=5');
    assert(readerDirect.status === 200, `GET /magazine/bloom/read?spread=5 serves the reader directly, got ${readerDirect.status}`);
    console.log('PASS - /magazine/<slug>?spread=N redirects (301) to /magazine/<slug>/read?spread=N with the query preserved; a bare /magazine/<slug> serves the issue page; /magazine/<slug>/read works directly');

    // ── 5: reader's "Close" (footer Magazine link) ──────────────────────────
    for (const issue of ISSUES) {
      const readerHtml = await (await fetch(BASE + `/magazine/${issue.slug}/read`)).text();
      assert(readerHtml.includes(`<a href="/magazine/${issue.slug}">Magazine</a>`), `${issue.slug}: the reader's footer "Magazine" link (Close) points back at its own issue page, not the generic /magazine archive`);
    }
    console.log('PASS - every reader\'s footer "Magazine" link (Close) points back at its own issue page');

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
