'use strict';
/*
 * The homepage hero switches on its own: the open call while a round is active,
 * the current selection otherwise. There is no DOM runner in this repo (no
 * dependencies), so this test checks the generated public/index.html in two
 * ways: the markup and the order of the script (both heroes present, the choice
 * hangs on /api/on-view/round, the shirt and the winner are only requested in
 * the open-call branch, /api/works only in the other), and the choice itself,
 * which is a small pure function (chooseHeroVariant) extracted from the page and
 * run in a vm sandbox. The visual and timing behaviour is checked in a browser.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function section(openTag) {
  const start = html.indexOf(openTag);
  assert(start >= 0, `markup contains ${openTag}`);
  return html.slice(start, html.indexOf('</section>', start));
}

// Both heroes are in the markup, hidden until the script has chosen.
const callout = section('<section class="callout is-pending" id="callout"');
const open = section('<section class="open" id="open" hidden>');
console.log('PASS - both heroes are in the markup (open call as the pending placeholder, current selection hidden)');

// The shirt must not load in the other variant: no src until the script sets it.
const tee = callout.match(/<img id="tee-img"[^>]*>/);
assert(tee && !/\ssrc=/.test(tee[0]) && /data-src="\/img\/gis-tee-front-back\.png"/.test(tee[0]), 'the shirt image has data-src and no src');
console.log('PASS - the shirt image has no src in the markup, so the current-selection variant never loads it');

// Variant b: the submit button, no open-call copy.
const btn = open.match(/<a class="btn" href="([^"]*)">([^<]*)/);
assert(btn && btn[1] === '/submit' && /^Submit your work/.test(btn[2]), 'the current-selection hero has a Submit your work button to /submit');
assert(!/t-shirt|Win a|leaderboard|fact|tee/i.test(open), 'the current-selection hero has no shirt, "Win", leaderboard or facts');
assert(!/[–—]/.test(open), 'no long dash in the new markup');
console.log('PASS - the current-selection hero has the Submit your work button to /submit and none of the open-call copy');

// The choice hangs on /api/on-view/round, with a 2.5s fallback.
const script = html.match(/<script>([\s\S]*?)<\/script>/g).map(s => s.slice(8, -9)).find(s => s.includes('chooseHeroVariant'));
assert(script, 'the page has the hero script');
assert(script.includes("fetch('/api/on-view/round')"), 'the variant is chosen from /api/on-view/round');
assert(/setTimeout\(function\(\)\{ decide\(null\); \}, 2500\)/.test(script), 'no answer within 2.5s chooses the current selection');
assert(/\.catch\(function\(\)\{ decide\(null\); \}\)/.test(script), 'a failed round fetch chooses the current selection');
assert(script.includes("chooseHeroVariant(round) === 'open-call'"), 'decide() uses chooseHeroVariant');
console.log('PASS - the variant comes from /api/on-view/round; failure and silence (2.5s) fall back to the current selection');

// Each branch only requests its own data.
const iOpenCall = script.indexOf('function showOpenCall');
const iCurrent = script.indexOf('function showCurrent');
const iWinner = script.indexOf("fetch('/api/on-view/previous-winner')");
const iWorks = script.indexOf("fetch('/api/works')");
const iTee = script.indexOf("tee.src = tee.getAttribute('data-src')");
assert(iOpenCall >= 0 && iCurrent > iOpenCall, 'showOpenCall comes before showCurrent');
assert(iWinner > iOpenCall && iWinner < iCurrent, 'the winner fetch is inside showOpenCall only');
assert(iTee > iOpenCall && iTee < iCurrent, 'the shirt is requested inside showOpenCall only');
assert(iWorks > iCurrent, '/api/works is fetched inside showCurrent only');
assert(script.split("fetch('/api/on-view/previous-winner')").length === 2 && script.split("fetch('/api/works')").length === 2, 'each of those endpoints is fetched exactly once');
console.log('PASS - the winner fetch and the shirt belong to the open-call branch, /api/works to the current-selection branch');

// The choice itself.
const fnSrc = script.match(/function chooseHeroVariant\(round\) \{[\s\S]*?\n\}/);
assert(fnSrc, 'chooseHeroVariant is a plain top-level function');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fnSrc[0] + '\nthis.fn = chooseHeroVariant;', sandbox);
const choose = sandbox.fn;
const active = { round_number: 4, starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-10-17T00:00:00Z' };
assert(choose(active) === 'open-call', 'an active round gives the open call');
for (const [label, value] of [['null (no active round)', null], ['undefined (no answer)', undefined], ['a string', 'error'], ['a number', 500], ['an array', []], ['an object without round_number', {}], ['true', true]]) {
  assert(choose(value) === 'current', `${label} gives the current selection`);
}
console.log('PASS - chooseHeroVariant: an object with a round gives open-call; null, undefined, strings, numbers, arrays and {} give current');

console.log('\nALL PASS');
