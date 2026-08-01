'use strict';
const fs = require('fs');
const path = require('path');
const pages = require('./pages.config');

const ROOT = path.resolve(__dirname, '..');
const PARTIALS = path.join(__dirname, 'partials');

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function injectNav(html, navConfig) {
  let partial = read(path.join(PARTIALS, 'nav.html'));
  const attr = navConfig.variant === 'light' ? ' data-variant="light"' : '';
  partial = partial.replace('{{NAV_ATTR}}', attr);
  if (navConfig.active) {
    partial = partial.replace(
      new RegExp(`data-nav="${navConfig.active}" href="[^"]*"`),
      `data-nav="${navConfig.active}" aria-current="page" href="#"`
    );
  }
  partial = partial.replace(/ data-nav="[^"]*"/g, '');
  return html.replace('<!-- @include: nav -->', partial);
}

function injectFooter(html, navConfig, footerConfig) {
  let partial = read(path.join(PARTIALS, 'footer.html'));
  const tagline = footerConfig?.tagline;
  partial = partial.replace(
    '<!-- FOOTER_TAGLINE -->',
    tagline ? `<p class="close rv">${tagline}</p>` : ''
  );
  if (navConfig.active) {
    partial = partial.replace(
      new RegExp(`data-footer="${navConfig.active}" href="[^"]*"`),
      `data-footer="${navConfig.active}" href="#"`
    );
  }
  partial = partial.replace(/ data-footer="[^"]*"/g, '');
  return html.replace('<!-- @include: footer -->', partial);
}

function injectWipe(html) {
  const partial = read(path.join(PARTIALS, 'wipe.html'));
  return html.replace('<!-- @include: wipe -->', partial);
}

const { checkNavDrift } = require('./check-nav-drift');
const navDriftErrors = checkNavDrift();
if (navDriftErrors.length) {
  console.error('[build] Aborting — public/on-view/index.html has drifted from build/partials/nav.html:');
  navDriftErrors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}

pages.forEach(config => {
  const inputPath = path.join(ROOT, config.input);
  if (!fs.existsSync(inputPath)) {
    console.warn(`Skipped (not yet created): ${config.input}`);
    return;
  }
  let html = read(inputPath);
  html = injectNav(html, config.nav);
  html = injectFooter(html, config.nav, config.footer);
  html = injectWipe(html);
  const outPath = path.join(ROOT, config.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Built: ${config.output}`);
});
