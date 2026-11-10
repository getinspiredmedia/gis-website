'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Every magazine issue reader, found by folder: public/magazine/<slug>/read/index.html.
// public/magazine/index.html (the archive) and public/magazine/<slug>/index.html
// (the per-issue page, built from build/pages/issue.html) are both built from
// build/pages and are not readers.
function listReaderPages(root = ROOT) {
  const dir = path.join(root, 'public', 'magazine');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'read', 'index.html')))
    .map(e => `public/magazine/${e.name}/read/index.html`)
    .sort();
}

module.exports = { listReaderPages };
