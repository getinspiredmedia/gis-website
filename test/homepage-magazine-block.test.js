'use strict';
/*
 * The homepage and /magazine both show the current issue + archive block
 * from the same source, build/partials/magazine-block.html, injected by
 * build/build.js's injectMagazineBlock(). This proves the two pages'
 * rendered HTML for that block is byte-identical (markup and CSS alike),
 * not just visually similar.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

// Extract the magazine-block's own <style> (the one immediately preceding
// <section class="current">) plus the <section class="current">...
// <section class="archive">...</section> markup, from a built page.
function extractBlock(html, label) {
  const styleMatch = html.match(/<style>\n\.eyebrow\{[\s\S]*?<\/style>\n<section class="current">[\s\S]*?<\/section>\n\n<section class="archive">[\s\S]*?<\/section>/);
  assert(styleMatch, `${label}: could not find the magazine-block's <style> + markup`);
  return styleMatch[0];
}

const homepageHtml = read('public/index.html');
const magazineHtml = read('public/magazine/index.html');

const homepageBlock = extractBlock(homepageHtml, 'public/index.html');
const magazineBlock = extractBlock(magazineHtml, 'public/magazine/index.html');

assert(homepageBlock === magazineBlock, 'the magazine block (CSS + markup) is byte-identical on the homepage and on /magazine');
console.log('PASS - the magazine block is byte-identical on the homepage and on /magazine');

// Sanity: the block actually contains the expected content, so a change to
// the marker regex above couldn't silently match an empty/wrong string.
assert(homepageBlock.includes('<h1>Bloom</h1>'), 'the extracted block contains the current issue\'s own <h1>');
assert(homepageBlock.includes('class="row next rv"'), 'the extracted block contains the issue 05 archive row');
console.log('PASS - the extracted block contains the expected current-issue and archive content');

console.log('\nALL PASS');
