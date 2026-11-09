'use strict';
/*
 * /submit is the WONDER open call page (build/pages/submit.html ->
 * public/submit/index.html), a build-system page using the standard nav,
 * analytics and footer partials. This checks the generated
 * public/submit/index.html directly (no DOM runner in this repo), same
 * pattern as test/homepage.test.js: every section's literal copy, from the
 * task brief word for word, exactly three "Submit your work" buttons (all
 * pointing at TALLY_URL, target="_blank", rel="noopener"), that the build
 * aborts on a malformed TALLY_URL, exactly one statement panel, and the
 * copy rules from docs/gis-design-system.md (no long dash, never the word
 * "community").
 *
 * Button placement: hero, after "How to submit", and the closing section
 * (data-position="hero"/"how-to-submit"/"closing", matching the Plausible
 * "Application Started" position prop build/pages/submit.html fires on
 * click). The task brief's own content block and its "Opbouw en
 * componenten" section 4a/4c/4f agree on this placement; only one line in
 * its acceptance criteria says "na de intro" instead of "in de hero",
 * which would also make the total four buttons instead of the stated
 * three, so that line is treated as a drafting slip, not followed. See
 * the terugrapportage for this task (git history) for the full reasoning.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'build', 'pages.config.js');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function run() {
  // Build once up front so the generated file reflects the current sources
  // (same approach test/homepage.test.js relies on implicitly — this repo
  // has no watch/rebuild-on-read step).
  const build = spawnSync('node', ['build/build.js'], { cwd: ROOT });
  assert(build.status === 0, `npm run build succeeds before these checks run — got exit ${build.status}: ${build.stderr}`);

  const html = fs.readFileSync(path.join(ROOT, 'public', 'submit', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const { TALLY_URL } = require('../build/pages.config');

  const visibleText = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ');

  // 1. Literal content, section by section, word for word from the brief.
  const literalStrings = [
    'Open Call: WONDER',
    'Free to enter',
    'Whatever made you stop and look twice.',
    'Deadline: 6 December 2026',
    "Wonder is the moment the world surprises you. A strange light in an ordinary street. A face you can't stop looking at. A place that only exists in your head until you make it real.",
    'For our next issue, Get Inspired Society is looking for work that holds that moment. Not perfect, not polished for its own sake, but personal. Show us what makes you wonder, and how you see it.',
    "Work with a clear personal voice, strong visual impact and a feeling that stays with you. Every interpretation is welcome: quiet or loud, real or imagined, intimate or epic.",
    'Photographers, illustrators, digital artists, painters and mixed media makers from anywhere in the world. Emerging or established, it makes no difference. We look at the work, not the name.',
    "AI-assisted and AI-generated work is welcome. We only ask that you're open about how your work was made.",
    'Up to 3 works, plus one or two sentences about each piece.',
    'Selected works will be featured twice: in the WONDER issue of Get Inspired Magazine, in print and online, and in a WONDER exhibition in the GIS digital gallery.',
    'one work will be chosen for the cover. Its maker receives a free printed copy of the issue.',
    'three artists will be invited for an extended feature with a series of their work and an interview.',
    'All selected artists get 20% off the printed issue.',
    'Open: 9 November 2026',
    'Magazine and gallery launch: 15 January 2027',
    'Free to enter. Deadline 6 December 2026.',
  ];
  for (const s of literalStrings) {
    assert(visibleText.includes(s), `the page's visible text includes the literal line "${s}"`);
  }
  console.log('PASS - every section\'s copy is present, word for word from the brief');

  // Deadline appears twice in the brief's own content (Key dates row and
  // the closing line), so a plain substring check on "Deadline: 6 December
  // 2026" alone would not prove the hero's own copy is there too; checked
  // above via the exact hero line. Sanity-count it shows up at least twice.
  const deadlineOccurrences = (visibleText.match(/Deadline:? 6 December 2026/g) || []).length;
  assert(deadlineOccurrences >= 2, `"Deadline... 6 December 2026" appears at least twice (hero and key dates) — got ${deadlineOccurrences}`);
  console.log('PASS - the deadline is stated in both the hero and key dates');

  // 2. Exactly three "Submit your work" buttons, each wired correctly.
  const btnRe = /<a class="btn"[^>]*>[\s\S]*?<\/a>/g;
  const buttons = html.match(btnRe) || [];
  const submitButtons = buttons.filter(b => /Submit your work/.test(b));
  assert(submitButtons.length === 3, `exactly three "Submit your work" buttons — got ${submitButtons.length}`);
  for (const b of submitButtons) {
    assert(b.includes(`href="${TALLY_URL}"`), `a "Submit your work" button's href is TALLY_URL (${TALLY_URL}) — got: ${b}`);
    assert(/target="_blank"/.test(b), `a "Submit your work" button opens in a new tab (target="_blank") — got: ${b}`);
    assert(/rel="noopener"/.test(b), `a "Submit your work" button has rel="noopener" — got: ${b}`);
    assert(/\(opens in a new tab\)/.test(b), 'a "Submit your work" button carries the visually-hidden "(opens in a new tab)" text for screen readers');
  }
  const positions = submitButtons.map(b => (b.match(/data-position="([^"]+)"/) || [])[1]).sort();
  assert(JSON.stringify(positions) === JSON.stringify(['closing', 'hero', 'how-to-submit']), `the three buttons sit at hero, how-to-submit and closing — got ${JSON.stringify(positions)}`);
  console.log('PASS - exactly three "Submit your work" buttons, each opening TALLY_URL in a new tab with rel="noopener"');

  // 3. The build aborts when TALLY_URL does not start with https://tally.so/.
  {
    const original = fs.readFileSync(CONFIG_PATH, 'utf8');
    assert(original.includes("const TALLY_URL = 'https://tally.so/"), 'fixture assumption: pages.config.js has the expected TALLY_URL declaration shape');
    const mutated = original.replace(/const TALLY_URL = '[^']*';/, "const TALLY_URL = 'https://example.com/not-tally';");
    assert(mutated !== original, 'mutation actually changed the file content');
    fs.writeFileSync(CONFIG_PATH, mutated, 'utf8');
    try {
      const result = spawnSync('node', ['build/build.js'], { cwd: ROOT });
      assert(result.status !== 0, `the build exits non-zero when TALLY_URL does not start with https://tally.so/ — got exit ${result.status}`);
      assert(/TALLY_URL/.test(result.stderr.toString()), `the build's error output names TALLY_URL — got: ${result.stderr}`);
    } finally {
      fs.writeFileSync(CONFIG_PATH, original, 'utf8');
    }
  }
  console.log('PASS - the build aborts when TALLY_URL does not start with https://tally.so/');

  // Rebuild once more with the restored, valid config so the repo is left
  // in the same generated state this test found it in.
  {
    const rebuild = spawnSync('node', ['build/build.js'], { cwd: ROOT });
    assert(rebuild.status === 0, `rebuild after restoring pages.config.js succeeds — got exit ${rebuild.status}: ${rebuild.stderr}`);
  }

  // 4. Exactly one statement panel on the page (the hero itself, per the brief).
  const statementCount = (html.match(/class="statement"/g) || []).length;
  assert(statementCount === 1, `exactly one .statement element — got ${statementCount}`);
  console.log('PASS - exactly one statement panel on the page');

  // 5. Copy rules: no long dash (U+2014), and never the word "community".
  assert(!visibleText.includes('—'), 'no long dash (U+2014) anywhere in the visible text');
  assert(!/\bcommunity\b/i.test(visibleText), 'the word "community" never appears in the visible text');
  console.log('PASS - no long dash and no "community" anywhere in the visible text');

  console.log('\nALL PASS');
}

if (require.main === module) {
  try {
    run();
    process.exit(0);
  } catch (e) {
    console.error('FAIL -', e.message);
    process.exit(1);
  }
}

module.exports = { run };
