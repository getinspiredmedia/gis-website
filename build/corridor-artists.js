'use strict';
// Shared data source for the homepage's corridor ("de gang") component: the
// five Bloom artists, their room number and which reader spread their photo
// is cropped from. Room numbers here must match the room numbers hardcoded
// on build/pages/gallery.html (test/corridor-gallery-consistency.test.js
// checks the two never drift apart); the spread numbers match the same
// artists[].spread mapping already used by public/magazine/bloom/index.html's
// own ISSUE object (see CLAUDE.md's "Nieuw issue toevoegen").
// width/height are the cropped source's own pixel dimensions (see the
// matching extract rects in build/generate-responsive-images.js), used as
// the <img> width/height attributes so the browser reserves the right box
// before the image loads (no layout shift).
const CORRIDOR_ARTISTS = [
  { name: 'Dina Belenko',      room: 1, slug: 'room-01', spread: 2,  width: 698, height: 870 },
  { name: 'Kylli Sparre',      room: 2, slug: 'room-02', spread: 5,  width: 697, height: 697 },
  { name: 'Sara Fraysse',      room: 3, slug: 'room-03', spread: 8,  width: 612, height: 407 },
  { name: 'Martina Dorigatti', room: 4, slug: 'room-04', spread: 11, width: 575, height: 846 },
  { name: 'Clemens Maurer',    room: 5, slug: 'room-05', spread: 14, width: 698, height: 870 },
];

module.exports = { CORRIDOR_ARTISTS };
