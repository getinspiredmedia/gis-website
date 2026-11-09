'use strict';
/*
 * The homepage corridor (build/corridor-artists.js, rendered into
 * public/index.html by build/build.js) and /gallery (build/pages/gallery.html,
 * hardcoded) both list the same five Bloom artists with the same room
 * numbers. They are two independent sources (the corridor's shared data
 * module is deliberately not wired into /gallery, see CLAUDE.md), so nothing
 * stops them drifting apart by hand; this only checks they still agree.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

const { CORRIDOR_ARTISTS } = require('../build/corridor-artists');

const homepageHtml = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const galleryHtml = fs.readFileSync(path.join(ROOT, 'build', 'pages', 'gallery.html'), 'utf8');

// Homepage: read back the rendered corr-work figures, in document order.
const figureRe = /<figure class="corr-work" data-room="(\d+)">[\s\S]*?<b>([^<]+)<\/b><span>Room (\d+)<\/span>/g;
const homepageEntries = [];
let m;
while ((m = figureRe.exec(homepageHtml))) {
  homepageEntries.push({ room: Number(m[1]), name: m[2], labelRoom: Number(m[3]) });
}
assert(homepageEntries.length === 5, `the homepage corridor renders exactly 5 works — got ${homepageEntries.length}`);
homepageEntries.forEach(e => assert(e.room === e.labelRoom, `work "${e.name}": data-room (${e.room}) matches the plaque's "Room ${e.labelRoom}"`));
console.log('PASS - the homepage corridor renders exactly 5 works, each with a matching data-room and plaque room number');

// /gallery: read back the five <div class="name"><b>Name</b><span>Room 0N</span></div> rows.
const galleryRe = /<div class="name rv"><b>([^<]+)<\/b><span>Room (\d+)<\/span><\/div>/g;
const galleryEntries = [];
while ((m = galleryRe.exec(galleryHtml))) {
  galleryEntries.push({ name: m[1], room: Number(m[2]) });
}
assert(galleryEntries.length === 5, `/gallery lists exactly 5 artists — got ${galleryEntries.length}`);
console.log('PASS - /gallery lists exactly 5 artists');

// Compare: same artists, same room numbers, same order, on both pages, and
// matching build/corridor-artists.js (the homepage's own data source).
assert(
  JSON.stringify(CORRIDOR_ARTISTS.map(a => ({ name: a.name, room: a.room }))) ===
  JSON.stringify(homepageEntries.map(e => ({ name: e.name, room: e.room }))),
  'the rendered homepage corridor matches build/corridor-artists.js exactly, in order'
);
console.log('PASS - the rendered homepage corridor matches build/corridor-artists.js exactly, in order');

assert(
  JSON.stringify(CORRIDOR_ARTISTS.map(a => ({ name: a.name, room: a.room }))) ===
  JSON.stringify(galleryEntries),
  `the homepage corridor and /gallery list the same artists with the same room numbers, in the same order — got homepage ${JSON.stringify(CORRIDOR_ARTISTS.map(a => a.name + ' #' + a.room))} vs gallery ${JSON.stringify(galleryEntries.map(e => e.name + ' #' + e.room))}`
);
console.log('PASS - the homepage corridor and /gallery agree on all five artists and room numbers');

console.log('\nALL PASS');
