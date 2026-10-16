'use strict';
/*
 * The homepage hero switches on its own between three variants: the open call
 * while a round is active, a "round closed" header for 7 days after the latest
 * round closed (when a winner is announced), and the current selection otherwise.
 * There is no DOM runner in this repo (no dependencies), so this test checks the
 * generated public/index.html in two ways: the markup and the structure of the
 * script (all heroes present, all four endpoints requested at once behind one
 * deadline, the shirt only requested in the open-call branch), and the choice
 * itself, which is a small pure function (chooseHeroVariant) extracted from the
 * page and run in a vm sandbox. The visual and timing behaviour is checked in a
 * browser.
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

// All three heroes are in the markup, hidden until the script has chosen.
const callout = section('<section class="callout is-pending" id="callout"');
const open = section('<section class="open" id="open" hidden>');
const closing = section('<section class="closing" id="closing" hidden>');
console.log('PASS - all three heroes are in the markup (open call as the pending placeholder, the other two hidden)');

// The shirt must not load in the other variants: no src until the script sets it.
const tee = callout.match(/<img id="tee-img"[^>]*>/);
assert(tee && !/\ssrc=/.test(tee[0]) && /data-src="\/img\/gis-tee-front-back\.png"/.test(tee[0]), 'the shirt image has data-src and no src');
assert(!/gis-tee/.test(open) && !/gis-tee/.test(closing), 'the shirt appears in neither of the other heroes');
console.log('PASS - the shirt image has no src in the markup, so the closing and current variants never load it');

// Variants b and c: the submit button, no open-call copy.
for (const [name, markup] of [['current-selection', open], ['closing', closing]]) {
  const btn = markup.match(/<a class="btn" href="([^"]*)">([^<]*)/);
  assert(btn && btn[1] === '/submit' && /^Submit your work/.test(btn[2]), `the ${name} hero has a Submit your work button to /submit`);
  assert(!/t-shirt|Win a|leaderboard|fact|tee/i.test(markup), `the ${name} hero has no shirt, "Win", leaderboard or facts`);
  assert(!/[–—]/.test(markup), `no long dash in the ${name} markup`);
}
assert(/<a class="winner" id="closing-winner" href="\/">/.test(closing), 'the closing hero reuses the .winner card as one link');
assert(/<h1 id="closing-title">/.test(closing) && /<p id="closing-status">/.test(closing), 'the closing hero has a title and a status line');
console.log('PASS - the current-selection and closing heroes have the Submit your work button to /submit and none of the open-call copy');

// The script: one deadline, four endpoints, each requested once.
const script = html.match(/<script>([\s\S]*?)<\/script>/g).map(s => s.slice(8, -9)).find(s => s.includes('chooseHeroVariant'));
assert(script, 'the page has the hero script');
assert(/setTimeout\(resolve, 2500\)/.test(script) && script.split('setTimeout(resolve, 2500)').length === 2, 'there is exactly one shared 2.5s deadline');
for (const url of ['/api/on-view/round', '/api/on-view/closing', '/api/on-view/previous-winner', '/api/works']) {
  assert(script.split(`getJson('${url}'`).length === 2, `${url} is requested exactly once, through getJson (late, failed or malformed counts as null)`);
}
assert(/Promise\.race\(\[promise, deadline\.then\(function\(\)\{ return null; \}\)\]\)/.test(script), 'an answer after the deadline is ignored (race against the deadline)');
assert(script.split('fetch(').length === 3 && script.includes("fetch('/api/on-view/tiles')") && script.includes('fetch(url)'), 'apart from the Currently on view tiles, fetch is only called inside getJson');
assert(/chooseHeroVariant\(round, null, null\) === 'open-call'/.test(script) && /chooseHeroVariant\(round, closing, winner\) === 'closing'/.test(script), 'the branches are picked with chooseHeroVariant');
console.log('PASS - the four endpoints are requested once each behind one shared 2.5s deadline; late, failed or malformed answers count as null');

// The shirt only in the open-call branch.
const iOpenCall = script.indexOf('function showOpenCall');
const iCurrent = script.indexOf('function showCurrent');
const iClosing = script.indexOf('function showClosing');
const iTee = script.indexOf("tee.src = tee.getAttribute('data-src')");
assert(iOpenCall >= 0 && iCurrent > iOpenCall && iClosing > iCurrent, 'the three show functions are all present');
assert(iTee > iOpenCall && iTee < iCurrent && script.split("tee.src =").length === 2, 'the shirt is requested inside showOpenCall only');
console.log('PASS - the shirt is requested in the open-call branch only');

// Closing copy.
assert(script.includes("'Round ' + closing.round_number + ' is closed.'"), 'the title says "Round N is closed." with N from closing.round_number');
assert(script.includes("'Winner announced soon. On View stays open.'") && script.includes("'On View stays open.'"), 'the status line has both texts');
assert(/Number\(winner\.round_number\) === Number\(closing\.round_number\)/.test(script), 'the sentence "Winner announced soon." is dropped when the winner is from the closed round');
assert(script.includes("'Round ' + winner.round_number + ' winner'"), 'the card says "Round M winner" with M from winner.round_number');
assert(script.includes("'/work/' + encodeURIComponent(winner.slug)"), 'the winner card links to /work/:slug with the slug encoded');
console.log('PASS - the closing texts: title, both status lines, the same-round rule, "Round M winner" and the encoded work link');

// The choice itself.
const fnSrc = script.match(/function chooseHeroVariant\(round, closing, winner\) \{[\s\S]*?\n\}/);
assert(fnSrc, 'chooseHeroVariant is a plain top-level function of (round, closing, winner)');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fnSrc[0] + '\nthis.fn = chooseHeroVariant;', sandbox);
const choose = sandbox.fn;
const round = { round_number: 4, starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-10-17T00:00:00Z' };
const closed = { round_number: 4, ends_at: '2026-10-16T11:46:29Z', show_until: '2026-10-23T11:46:29Z' };
const winner = { round_number: 3, slug: 'x', title: 'X', artist: 'Y', image_url: '/uploads/x.webp' };
const invalid = [['null', null], ['undefined', undefined], ['a string', 'error'], ['a number', 500], ['an array', []], ['{} without round_number', {}], ['true', true]];

// a. an active round always gives the open call, whatever else was answered
for (const c of [null, closed]) for (const w of [null, winner]) assert(choose(round, c, w) === 'open-call', `an active round gives open-call (closing ${c ? 'object' : 'null'}, winner ${w ? 'object' : 'null'})`);
// b. no round, closing and winner both objects: closing
assert(choose(null, closed, winner) === 'closing', 'no round + closing + winner gives closing');
for (const [label, v] of invalid) assert(choose(v, closed, winner) === 'closing', `a round that is ${label} counts as no round, so closing`);
// c. everything else: current
assert(choose(null, closed, null) === 'current', 'closing without a winner gives current');
assert(choose(null, null, winner) === 'current', 'a winner without a closing window gives current');
assert(choose(null, null, null) === 'current', 'nothing gives current');
for (const [label, v] of invalid) {
  assert(choose(null, v, winner) === 'current', `closing that is ${label} gives current`);
  assert(choose(null, closed, v) === 'current', `winner that is ${label} gives current`);
}
console.log('PASS - chooseHeroVariant: open-call for an active round; closing only with a closing object and a winner object; current for everything else, invalid shapes counted as null');

console.log('\nALL PASS');
