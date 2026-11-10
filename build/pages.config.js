'use strict';

// The open call WONDER opened 9 November 2026: /submit is now the WONDER
// open call page (build/pages/submit.html), not André's weekly On View form
// any more (that form moved to /on-view/submit, see CLAUDE.md). Used by the
// homepage's issue-05 card and its "Show your work." door.
const ISSUE_CALL_URL = '/submit';
const ISSUE_CALL_CARD_LINE = 'Free to enter. Deadline 6 December 2026.';
const ISSUE_CALL_DOOR_LINE = 'Free to enter. Deadline 6 December 2026.';

// The issue 05 archive row on /magazine (build/pages/magazine.html) reuses
// these, copied verbatim from build/pages/submit.html (its eyebrow's
// "WONDER", its hero statement, and its closing section's launch line), so
// that row can never drift out of date the way its old placeholder text
// did. Not used by submit.html itself (its own copy is left exactly as
// written, see CLAUDE.md), only by the /magazine row; swap all of these
// (plus ISSUE_CALL_URL/CARD_LINE/DOOR_LINE above) together the moment this
// call closes or a new one replaces it.
const ISSUE_05_TITLE = 'WONDER';
const ISSUE_05_STATEMENT = 'Whatever made you stop and look twice.';
const ISSUE_05_LAUNCH_LINE = 'Magazine and gallery launch: 15 January 2027';

// The Tally form WONDER submissions go through, André's real one (live
// since the open call launched 9 November 2026). build/build.js checks
// this against a strict pattern (a real /r/<id> link, no leftover
// placeholder word), so a stray typo or an unreplaced placeholder here
// can't ship a broken submit link, same as a malformed value can't.
const TALLY_URL = 'https://tally.so/r/xVj29E';

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
    nav:    { active: 'open-call', variant: 'dark' },
    footer: {},
  },
];

module.exports = { pages, ISSUE_CALL_URL, ISSUE_CALL_CARD_LINE, ISSUE_CALL_DOOR_LINE, ISSUE_05_TITLE, ISSUE_05_STATEMENT, ISSUE_05_LAUNCH_LINE, TALLY_URL };
