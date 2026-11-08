'use strict';
// Generates AVIF/WebP/JPEG srcset variants for homepage images, from the
// existing source files in public/assets. Idempotent: skips a size/format
// that is already on disk, so a normal `npm run build` only re-encodes
// after a source file changes or a new width/output is added here. Widths
// are capped to each source's own resolution — sharp can upscale, but a
// fake "responsive" size that is just a blurry enlargement is worse than
// not offering it.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');

// { src, outDir, base, widths, extract } — outDir and src are relative to
// ROOT. extract {left,top,width,height} crops the source first, for
// bloom-exhibition: the Bloom reader's spread 02.webp is a full two-page
// magazine spread (artist photo + a page of bio/poem text on white), and the
// exhibition band needs just the photo — the crop below is the left page's
// artwork only, picked by hand against the source file.
// bloom-hero: public/assets/covers/bloom-master.jpg is still the full cover
// page (1414x2000: white page margins, the masthead/tagline/title text, the
// embedded photo, and a footer "ISSUE NO. ..." line), not the clean,
// margin-free, text-free 1596x1598 photo a since-superseded task briefing
// expected; nothing replaced it in the repo, confirmed against git history
// before this crop was written. The hero needs the photo only (crown
// shadow, hand, tulips), so this crop is hand-picked against the source:
// the embedded photo's own rectangle runs roughly x:85-1330, y:670-1915
// (found by scanning for the white-page/photo boundary), which already
// drops the side/bottom margins and the footer line; starting the crop
// at y=915 instead of the photo's own top (670) additionally drops the
// masthead/tagline/title text overlaid on the photo's own top ~23%, the
// lowest point that still fully excludes it while keeping most of the
// crown shadow in frame. The final box (left 90, top 915, right 1325,
// bottom 1910) is pulled in a further few px on every side from that
// rectangle: the photo itself has a few px of bright lighting bleed right
// at its own edge, bright enough to read as a near-white pixel, which
// would otherwise sit exactly on the generated image's edge and look like
// a leftover margin (checked by hand with test crops and by sampling
// corner/edge pixel values directly, same method as the first cut of
// this image; see test/homepage.test.js for the corner/edge check this
// crop has to satisfy).
const JOBS = [
  { src: 'public/assets/covers/bloom.webp',        outDir: 'public/assets/responsive', base: 'bloom-cover',        widths: [375, 500, 750, 900, 1125] },
  { src: 'public/assets/covers/bloom-master.jpg',   outDir: 'public/assets/responsive', base: 'bloom-hero',         widths: [640, 960, 1235], extract: { left: 90, top: 915, width: 1235, height: 995 } },
  { src: 'public/assets/covers/chasing-light.webp', outDir: 'public/assets/responsive', base: 'chasing-light-cover', widths: [250, 500] },
  { src: 'public/assets/covers/no-algorithm.webp',  outDir: 'public/assets/responsive', base: 'no-algorithm-cover',  widths: [250, 500] },
  { src: 'public/assets/covers/origins.webp',       outDir: 'public/assets/responsive', base: 'origins-cover',       widths: [250, 500] },
  { src: 'public/assets/spreads/bloom/02.webp',     outDir: 'public/assets/responsive', base: 'bloom-exhibition',    widths: [500, 697], extract: { left: 48, top: 330, width: 697, height: 392 } },
];

async function run() {
  for (const job of JOBS) {
    const srcPath = path.join(ROOT, job.src);
    const outDir = path.join(ROOT, job.outDir);
    fs.mkdirSync(outDir, { recursive: true });
    const base = () => job.extract ? sharp(srcPath).extract(job.extract) : sharp(srcPath);
    const meta = await base().metadata();
    const widths = job.widths.filter(w => w <= meta.width);
    if (!widths.length) widths.push(meta.width);
    for (const w of widths) {
      for (const ext of ['avif', 'webp', 'jpg']) {
        const outPath = path.join(outDir, `${job.base}-${w}.${ext}`);
        if (fs.existsSync(outPath)) continue;
        const pipeline = base().resize({ width: w, withoutEnlargement: true });
        if (ext === 'avif') await pipeline.avif({ quality: 55 }).toFile(outPath);
        else if (ext === 'webp') await pipeline.webp({ quality: 72 }).toFile(outPath);
        else await pipeline.jpeg({ quality: 72, mozjpeg: true }).toFile(outPath);
        console.log(`Generated: ${path.relative(ROOT, outPath)}`);
      }
    }
  }
}

if (require.main === module) {
  run().catch(e => { console.error('[generate-responsive-images] failed:', e.message); process.exit(1); });
}

module.exports = { run };
