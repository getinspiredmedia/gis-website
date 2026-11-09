'use strict';

// The open call WONDER opened 9 November 2026: /submit is now the WONDER
// open call page (build/pages/submit.html), not André's weekly On View form
// any more (that form moved to /on-view/submit, see CLAUDE.md). Used by the
// homepage's issue-05 card and its "Show your work." door.
const ISSUE_CALL_URL = '/submit';
const ISSUE_CALL_CARD_LINE = 'Free to enter. Deadline 6 December 2026.';
const ISSUE_CALL_DOOR_LINE = 'Free to enter. Deadline 6 December 2026.';

// The Tally form WONDER submissions go through. A placeholder (not a real
// Tally form) until André supplies the real one, swap this one value and
// rebuild, nothing else needs to change. build/build.js aborts the build if
// this doesn't start with https://tally.so/, so a stray typo here can't
// ship a broken submit link.
const TALLY_URL = 'https://tally.so/r/REPLACE_ME';

const pages = [
  {
    input:  'build/pages/index.html',
    output: 'public/index.html',
    nav:    { active: null, variant: 'dark' },
    footer: { tagline: 'Seventeen years of looking.' },
    // The homepage owns its own wipe/view-transition navigation via
    // public/js/motion.js (see CLAUDE.md) instead of the shared wipe
    // partial, so the two don't both intercept the same clicks.
    wipe: false,
  },
  {
    input:  'build/pages/magazine.html',
    output: 'public/magazine/index.html',
    nav:    { active: 'magazine', variant: 'dark' },
    footer: {},
  },
  {
    input:  'build/pages/gallery.html',
    output: 'public/gallery/index.html',
    nav:    { active: 'gallery', variant: 'dark' },
    footer: {},
  },
  {
    input:  'build/pages/about.html',
    output: 'public/about/index.html',
    nav:    { active: 'about', variant: 'light' },
    footer: {},
  },
  {
    input:  'build/pages/contact.html',
    output: 'public/contact/index.html',
    nav:    { active: 'contact', variant: 'dark' },
    footer: {},
  },
  {
    input:  'build/pages/support.html',
    output: 'public/support/index.html',
    nav:    { active: 'support', variant: 'dark' },
    footer: {},
  },
  {
    input:  'build/pages/privacy.html',
    output: 'public/privacy/index.html',
    nav:    { active: null, variant: 'light' },
    footer: {},
  },
  {
    input:  'build/pages/submit.html',
    output: 'public/submit/index.html',
    nav:    { active: null, variant: 'dark' },
    footer: {},
  },
];

module.exports = { pages, ISSUE_CALL_URL, ISSUE_CALL_CARD_LINE, ISSUE_CALL_DOOR_LINE, TALLY_URL };
