'use strict';
// Single data source for the four issue pages (/magazine/<slug>, built from
// build/pages/issue.html by build/build.js). Every value here is copied
// from the matching reader's own ISSUE object (public/magazine/<slug>/read/
// index.html) and from that reader's <meta name="description">, not
// invented — test/issue-data-consistency.test.js parses each reader's real
// ISSUE object and checks it still matches title/line/cover/pdf/peecho/
// artists/spreadCount here, so the two can't silently drift apart.
//
// artists[].image/alt reuse the exact spread the reader's own
// artists[].spread entry points at (src/alt copied verbatim from that
// reader's spreads[] array) — the issue page's artist tiles and its "look
// inside" row both use these same five images, there is no separate,
// larger spread gallery in this data source.
//
// spreadsWord is the word form already used in each reader's own meta
// description (e.g. "...seventeen spreads."), reused for the issue page's
// meta line instead of writing a new phrase.
const ISSUES = [
  {
    slug: 'origins',
    number: 1,
    title: 'Origins',
    line: 'Before mastery. Before style. There is the spark.',
    cover: '/assets/covers/origins.webp',
    coverAlt: 'Cover of Get Inspired Society, Issue 1, Origins.',
    pdf: '/assets/pdf/origins.pdf',
    peecho: 'https://www.peecho.com/print/en/2140141',
    spreadCount: 27,
    spreadsWord: 'twenty-seven',
    artists: [
      { name: 'Clemens Maurer', spread: 2, image: '/assets/spreads/origins/02.webp', alt: 'Introduction to Clemens Maurer, beside two rocks floating above a desert flat at dusk.' },
      { name: 'Dina Belenko', spread: 7, image: '/assets/spreads/origins/07.webp', alt: 'Introduction to Dina Belenko, beside a tabletop world of dominoes, tiny houses, and mushrooms.' },
      { name: 'Michael Duckworth', spread: 12, image: '/assets/spreads/origins/12.webp', alt: 'Introduction to Michael Duckworth, beside a black and white rainy street of umbrellas and light.' },
      { name: 'Michelle Quirós', spread: 17, image: '/assets/spreads/origins/17.webp', alt: 'Introduction to Michelle Quirós, beside a black and white close-up of a beaded Panamanian collar.' },
      { name: 'Oscar Rey', spread: 22, image: '/assets/spreads/origins/22.webp', alt: 'Introduction to Oscar Rey, beside a colorful gouache of a seated figure reading.' },
    ],
  },
  {
    slug: 'no-algorithm',
    number: 2,
    title: 'No Algorithm',
    line: 'Before the feed. Before the scroll. There is attention.',
    cover: '/assets/covers/no-algorithm.webp',
    coverAlt: 'Cover of Get Inspired Society, Issue 2, No Algorithm.',
    pdf: '/assets/pdf/no-algorithm.pdf',
    peecho: 'https://www.peecho.com/print/en/2198517',
    spreadCount: 22,
    spreadsWord: 'twenty-two',
    artists: [
      { name: 'Tommi Viitala', spread: 2, image: '/assets/spreads/no-algorithm/02.webp', alt: 'Introduction to Tommi Viitala, beside a motion-blurred view of passengers on a tram.' },
      { name: 'Silke Seybold', spread: 6, image: '/assets/spreads/no-algorithm/06.webp', alt: 'Introduction to Silke Seybold, beside a sepia lith print of a figure within a derelict industrial hall.' },
      { name: 'Dina Belenko', spread: 10, image: '/assets/spreads/no-algorithm/10.webp', alt: 'Introduction to Dina Belenko, beside dried flowers and fluid caustics against pale blue.' },
      { name: 'Anna Lena Raab', spread: 14, image: '/assets/spreads/no-algorithm/14.webp', alt: 'Introduction to Anna Lena Raab, beside a black and white view of a modernist building and a sculpted head.' },
      { name: 'Jordi Piris', spread: 18, image: '/assets/spreads/no-algorithm/18.webp', alt: 'Introduction to Jordi Piris, beside a black and white beach with a net at the waterline.' },
    ],
  },
  {
    slug: 'chasing-light',
    number: 3,
    title: 'Chasing Light',
    line: 'The same sun. Never the same light.',
    cover: '/magazine/chasing-light/assets/covers/chasing-light.webp',
    coverAlt: 'Cover of Get Inspired Society, Issue 3, Chasing Light.',
    pdf: '/assets/pdf/chasing-light.pdf',
    peecho: 'https://www.peecho.com/print/en/2273132',
    spreadCount: 22,
    spreadsWord: 'twenty-two',
    artists: [
      { name: 'Will Corvara', spread: 2, image: '/magazine/chasing-light/assets/spreads/02.webp', alt: 'Introduction to Will Corvara, beside a warm interior where light falls across a hand and drapery.' },
      { name: 'Jeff Vonk', spread: 6, image: '/magazine/chasing-light/assets/spreads/06.webp', alt: 'Introduction to Jeff Vonk, beside a dark forest of palms catching low light.' },
      { name: 'Ulf Berglund', spread: 10, image: '/magazine/chasing-light/assets/spreads/10.webp', alt: 'Introduction to Ulf Berglund, beside a monochrome view through a window toward a lit tower.' },
      { name: 'Janusz Furrer', spread: 14, image: '/magazine/chasing-light/assets/spreads/14.webp', alt: 'Introduction to Janusz Furrer, beside a yellow wall with a red door and a hard diagonal shadow.' },
      { name: 'Joaquin Pastor Genzor', spread: 18, image: '/magazine/chasing-light/assets/spreads/18.webp', alt: 'Introduction to Joaquin Pastor Genzor, beside a hand-shaped shadow on a curved sunlit wall.' },
    ],
  },
  {
    slug: 'bloom',
    number: 4,
    title: 'Bloom',
    line: 'Nothing opens on command.',
    cover: '/assets/covers/bloom.webp',
    coverAlt: 'Cover of Bloom, Issue 4: tulips rising from a lit drawer beneath the shadow of a crown. Photograph by Dina Belenko.',
    pdf: '/assets/pdf/bloom.pdf',
    peecho: 'https://www.peecho.com/print/en/2397702',
    spreadCount: 17,
    spreadsWord: 'seventeen',
    artists: [
      { name: 'Dina Belenko', spread: 2, image: '/assets/spreads/bloom/02.webp', alt: 'Dina Belenko: a figure in a glowing rabbit mask lounging in a red armchair, a key hanging from her foot, beside her artist statement.' },
      { name: 'Kylli Sparre', spread: 5, image: '/assets/spreads/bloom/05.webp', alt: 'Kylli Sparre: her artist statement beside an aerial view of figures in dark water arranged like a flower.' },
      { name: 'Sara Fraysse', spread: 8, image: '/assets/spreads/bloom/08.webp', alt: 'Sara Fraysse: a yellow bench beside a tiled pool seen from above, with her artist statement.' },
      { name: 'Martina Dorigatti', spread: 11, image: '/assets/spreads/bloom/11.webp', alt: 'Martina Dorigatti: her artist statement beside a torn paper collage of a face among red petals.' },
      { name: 'Clemens Maurer', spread: 14, image: '/assets/spreads/bloom/14.webp', alt: 'Clemens Maurer: a figure wrapped in a blue polka dot garment shaped like a flower on red, beside his artist statement.' },
    ],
  },
];

// NEW COPY — not anywhere on the site yet (not in any reader, the archive,
// or the homepage). Needs André's approval; see the task's Eindrapport.
// The build does not fail on this (see build/build.js), but
// test/issue-pages.test.js reports it on every run so it stays visible
// until it's either approved or replaced.
const UNAPPROVED_COPY = {
  lookInsideLabel: 'Look inside',
};

module.exports = { ISSUES, UNAPPROVED_COPY };
