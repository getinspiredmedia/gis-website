'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Every magazine issue reader, found by folder: public/magazine/<slug>/index.html.
// public/magazine/index.html (the archive) is built from build/pages and is not one.
function listReaderPages(root = ROOT) {
  const dir = path.join(root, 'public', 'magazine');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'index.html')))
    .map(e => `public/magazine/${e.name}/index.html`)
    .sort();
}

module.exports = { listReaderPages };
