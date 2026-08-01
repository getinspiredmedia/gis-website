'use strict';
/*
 * Several pages sit outside the build pipeline (see CLAUDE.md) and carry a
 * hand-maintained copy of the masthead's mobile-nav toggle (markup + script)
 * from build/partials/nav.html. This guards against any of them silently
 * drifting from the partial. It does not compare the rest of each file —
 * only the toggle button/menu markup and the toggle script, which must stay
 * byte-identical (modulo the nav's own opening-tag attributes, which are
 * expected to differ per page).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Hand-maintained copies of build/partials/nav.html's toggle. Add a page here
// the moment it gets its own copy of the shared nav.
const HAND_MAINTAINED_COPIES = [
  'public/on-view/index.html',
  'public/work/index.html',
];

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

function extractNavBlock(html) {
  const match = html.match(/<nav[^>]*>[\s\S]*?<\/nav>/);
  if (!match) return null;
  return match[0].replace(/^<nav[^>]*>/, '<nav>');
}

function extractToggleScript(html) {
  const scripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
  return scripts.find(s => s.includes("querySelector('.nav-toggle')")) || null;
}

function extractToggleButtonAttrs(html) {
  const match = html.match(/<button class="nav-toggle"[^>]*>/);
  if (!match) return null;
  const tag = match[0];
  const attrs = {};
  ['aria-expanded', 'aria-controls', 'aria-label'].forEach(name => {
    const m = tag.match(new RegExp(name + '="([^"]*)"'));
    attrs[name] = m ? m[1] : null;
  });
  return attrs;
}

function normalizeNavPartial(html) {
  return html.replace('{{NAV_ATTR}}', '');
}

function checkNavDrift() {
  const partial = normalizeNavPartial(read('build/partials/nav.html'));

  const partialNav    = extractNavBlock(partial);
  const partialScript = extractToggleScript(partial);
  const partialAria   = extractToggleButtonAttrs(partial);

  const errors = [];
  if (!partialNav)    errors.push('Could not find <nav> block in build/partials/nav.html');
  if (!partialScript) errors.push('Could not find toggle <script> in build/partials/nav.html');
  if (!partialAria)   errors.push('Could not find <button class="nav-toggle"> in build/partials/nav.html');

  for (const copyPath of HAND_MAINTAINED_COPIES) {
    const copy = read(copyPath);
    const copyNav    = extractNavBlock(copy);
    const copyScript = extractToggleScript(copy);
    const copyAria   = extractToggleButtonAttrs(copy);

    if (!copyNav)    errors.push(`Could not find <nav> block in ${copyPath}`);
    if (!copyScript) errors.push(`Could not find toggle <script> in ${copyPath}`);
    if (!copyAria)   errors.push(`Could not find <button class="nav-toggle"> in ${copyPath}`);

    // ARIA attributes get their own explicit check (with a named diff) rather
    // than relying only on the full-block string compare below, so an
    // ARIA-only change produces an unambiguous, actionable error instead of
    // a generic "markup drifted".
    if (partialAria && copyAria) {
      ['aria-expanded', 'aria-controls', 'aria-label'].forEach(name => {
        if (partialAria[name] !== copyAria[name]) {
          errors.push(
            `Toggle ${name} differs — partial="${partialAria[name]}" vs ${copyPath}="${copyAria[name]}"`
          );
        }
      });
    }

    if (partialNav && copyNav && partialNav !== copyNav) {
      errors.push(`Nav markup (logo/toggle/menu) in ${copyPath} has drifted from build/partials/nav.html`);
    }
    if (partialScript && copyScript && partialScript !== copyScript) {
      errors.push(`Toggle script in ${copyPath} has drifted from build/partials/nav.html`);
    }
  }

  return errors;
}

if (require.main === module) {
  const errors = checkNavDrift();
  if (errors.length) {
    console.error('[check-nav-drift] FAILED:');
    errors.forEach(e => console.error('  - ' + e));
    console.error('\nThe pages listed in HAND_MAINTAINED_COPIES are maintained by hand (they are not part of the build pipeline).');
    console.error('When you change the mobile nav toggle in build/partials/nav.html, copy the same');
    console.error('<nav>...</nav> block and toggle <script> into each of them.');
    process.exit(1);
  }
  console.log(`[check-nav-drift] OK — ${HAND_MAINTAINED_COPIES.length} hand-maintained cop${HAND_MAINTAINED_COPIES.length === 1 ? 'y matches' : 'ies match'} build/partials/nav.html`);
}

module.exports = { checkNavDrift };
