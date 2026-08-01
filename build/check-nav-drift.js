'use strict';
/*
 * public/on-view/index.html sits outside the build pipeline (see CLAUDE.md)
 * and carries a hand-maintained copy of the masthead's mobile-nav toggle
 * (markup + script) from build/partials/nav.html. This guards against the
 * two silently drifting apart. It does not compare the rest of either file —
 * only the toggle button/menu markup and the toggle script, which must stay
 * byte-identical (modulo the nav's own opening-tag attributes, which are
 * expected to differ per page).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

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
  const onView  = read('public/on-view/index.html');

  const partialNav = extractNavBlock(partial);
  const onViewNav  = extractNavBlock(onView);
  const partialScript = extractToggleScript(partial);
  const onViewScript  = extractToggleScript(onView);
  const partialAria = extractToggleButtonAttrs(partial);
  const onViewAria  = extractToggleButtonAttrs(onView);

  const errors = [];
  if (!partialNav)    errors.push('Could not find <nav> block in build/partials/nav.html');
  if (!onViewNav)     errors.push('Could not find <nav> block in public/on-view/index.html');
  if (!partialScript) errors.push('Could not find toggle <script> in build/partials/nav.html');
  if (!onViewScript)  errors.push('Could not find toggle <script> in public/on-view/index.html');
  if (!partialAria)   errors.push('Could not find <button class="nav-toggle"> in build/partials/nav.html');
  if (!onViewAria)    errors.push('Could not find <button class="nav-toggle"> in public/on-view/index.html');

  // ARIA attributes get their own explicit check (with a named diff) rather than
  // relying only on the full-block string compare below, so an ARIA-only change
  // produces an unambiguous, actionable error instead of a generic "markup drifted".
  if (partialAria && onViewAria) {
    ['aria-expanded', 'aria-controls', 'aria-label'].forEach(name => {
      if (partialAria[name] !== onViewAria[name]) {
        errors.push(
          `Toggle ${name} differs — partial="${partialAria[name]}" vs on-view="${onViewAria[name]}"`
        );
      }
    });
  }

  if (partialNav && onViewNav && partialNav !== onViewNav) {
    errors.push('Nav markup (logo/toggle/menu) in public/on-view/index.html has drifted from build/partials/nav.html');
  }
  if (partialScript && onViewScript && partialScript !== onViewScript) {
    errors.push('Toggle script in public/on-view/index.html has drifted from build/partials/nav.html');
  }

  return errors;
}

if (require.main === module) {
  const errors = checkNavDrift();
  if (errors.length) {
    console.error('[check-nav-drift] FAILED:');
    errors.forEach(e => console.error('  - ' + e));
    console.error('\npublic/on-view/index.html is maintained by hand (it is not part of the build pipeline).');
    console.error('When you change the mobile nav toggle in build/partials/nav.html, copy the same');
    console.error('<nav>...</nav> block and toggle <script> into public/on-view/index.html.');
    process.exit(1);
  }
  console.log('[check-nav-drift] OK — on-view nav matches build/partials/nav.html');
}

module.exports = { checkNavDrift };
