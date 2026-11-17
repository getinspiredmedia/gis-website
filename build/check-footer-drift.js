'use strict';
/*
 * The magazine readers (see CLAUDE.md) are outside the build pipeline and
 * carry a hand-maintained copy of the shared footer's <style> block and its
 * .footer-logos markup from build/partials/footer.html. This guards against
 * either silently drifting out of sync. It does not compare the rest of the
 * <footer> element: the links list and tagline are expected to differ (a
 * reader's Magazine link points at its own issue, and readers have no
 * tagline), only the CSS rules and the logo-pair markup must stay
 * byte-identical.
 */
const fs = require('fs');
const path = require('path');

const { listReaderPages } = require('./readers');

const ROOT = path.resolve(__dirname, '..');

// Hand-maintained copies of build/partials/footer.html's <style> block and
// .footer-logos markup. public/on-view/index.html and public/work/index.html
// are not listed: they use their own one-line footer, not the shared one.
const HAND_MAINTAINED_COPIES = [...listReaderPages()];

function read(p) {
  return fs.readFileSync(path.join(ROOT, p), 'utf8');
}

function extractStyleBlock(html) {
  const match = html.match(/<style>\nfooter\{background:var\(--ink\)[\s\S]*?<\/style>/);
  return match ? match[0] : null;
}

function extractLogosBlock(html) {
  const match = html.match(/<div class="footer-logos">[\s\S]*?<\/div>/);
  return match ? match[0] : null;
}

function checkFooterDrift() {
  const partial = read('build/partials/footer.html');
  const partialStyle = extractStyleBlock(partial);
  const partialLogos = extractLogosBlock(partial);

  const errors = [];
  if (!partialStyle) errors.push('Could not find the footer <style> block in build/partials/footer.html');
  if (!partialLogos) errors.push('Could not find the .footer-logos block in build/partials/footer.html');

  for (const copyPath of HAND_MAINTAINED_COPIES) {
    const copy = read(copyPath);
    const copyStyle = extractStyleBlock(copy);
    const copyLogos = extractLogosBlock(copy);

    if (!copyStyle) errors.push(`Could not find the footer <style> block in ${copyPath}`);
    if (!copyLogos) errors.push(`Could not find the .footer-logos block in ${copyPath}`);

    if (partialStyle && copyStyle && partialStyle !== copyStyle) {
      errors.push(`Footer <style> block in ${copyPath} has drifted from build/partials/footer.html`);
    }
    if (partialLogos && copyLogos && partialLogos !== copyLogos) {
      errors.push(`.footer-logos markup in ${copyPath} has drifted from build/partials/footer.html`);
    }
  }

  return errors;
}

if (require.main === module) {
  const errors = checkFooterDrift();
  if (errors.length) {
    console.error('[check-footer-drift] FAILED:');
    errors.forEach(e => console.error('  - ' + e));
    console.error('\nThe pages listed in HAND_MAINTAINED_COPIES are maintained by hand (they are not part of the build pipeline).');
    console.error('When you change the footer\'s <style> block or .footer-logos markup in build/partials/footer.html, copy the same');
    console.error('block into each of them.');
    process.exit(1);
  }
  console.log(`[check-footer-drift] OK — ${HAND_MAINTAINED_COPIES.length} hand-maintained cop${HAND_MAINTAINED_COPIES.length === 1 ? 'y matches' : 'ies match'} build/partials/footer.html`);
}

module.exports = { checkFooterDrift };
