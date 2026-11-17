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
const JOBS = [
  { src: 'public/assets/covers/bloom.webp',        outDir: 'public/assets/responsive', base: 'bloom-cover',        widths: [375, 500, 750, 900, 1125] },
  // The issue page's own hero cover (build/pages/issue.html), full-size and
  // uncropped, from the full-resolution master instead of the small
  // 500x707 bloom-cover.webp above (which stays the strip/OG/archive-row
  // image, unchanged).
  { src: 'public/assets/covers/bloom-master.jpg',  outDir: 'public/assets/responsive', base: 'bloom-cover-hero',   widths: [600, 900, 1200] },
  { src: 'public/assets/covers/chasing-light.webp', outDir: 'public/assets/responsive', base: 'chasing-light-cover', widths: [250, 500] },
  { src: 'public/assets/covers/no-algorithm.webp',  outDir: 'public/assets/responsive', base: 'no-algorithm-cover',  widths: [250, 500] },
  { src: 'public/assets/covers/origins.webp',       outDir: 'public/assets/responsive', base: 'origins-cover',       widths: [250, 500] },
  { src: 'public/assets/spreads/bloom/02.webp',     outDir: 'public/assets/responsive', base: 'bloom-exhibition',    widths: [500, 697], extract: { left: 48, top: 330, width: 697, height: 392 } },
  // The homepage's gallery-end section: a real screenshot of the Bloom room
  // in the gis-gallery virtual gallery (1904x964, supplied whole, no
  // extract). Also /gallery's own poster.
  { src: 'public/assets/gallery/room-bloom.png', outDir: 'public/assets/responsive', base: 'room-bloom', widths: [960, 1440, 1904] },
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
