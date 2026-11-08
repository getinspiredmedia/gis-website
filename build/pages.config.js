'use strict';

// André's own form for issue 05 submissions, separate from the weekly
// On View /submit flow, will replace this once it exists. Until then this
// points at /magazine, a real page, instead of a dead placeholder link,
// and the copy says the open call hasn't started yet (it opens 9 November)
// rather than claiming it's already open. All three are meant to be swapped
// together, in this one file, the moment the real form is ready. Used by
// the homepage's issue-05 card and its "Show your work." door.
const ISSUE_CALL_URL = '/magazine';
const ISSUE_CALL_CARD_LINE = 'Open call opens 9 November.';
const ISSUE_CALL_DOOR_LINE = 'Issue 05 opens for submissions on 9 November.';

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
];

module.exports = { pages, ISSUE_CALL_URL, ISSUE_CALL_CARD_LINE, ISSUE_CALL_DOOR_LINE };
