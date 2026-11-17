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
// A job may use `heights` instead of `widths` (resize by height, for a short
// wide logo scaled to a fixed display height rather than a fixed display
// width) and `formats` to override the default ['avif','webp','jpg'] — the
// two footer logos are transparent brush-lettering on a square canvas, so
// they're cropped to their own ink (extract, picked by hand against each
// source's real pixels) and only need webp/png (no jpg: no alpha channel).
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
  // Footer logo pair: both supplied as a 2000x2000 canvas with a wide
  // transparent margin around the brush-lettering. extract crops that
  // margin away (bbox of the real ink, each picked by hand against the
  // source's own alpha channel, with an 8px pad so anti-aliased edges
  // aren't clipped); heights match the footer's 40px/80px/@1x/@2x display
  // sizes.
  { src: 'public/assets/logos/society-logo.webp',  outDir: 'public/assets/responsive', base: 'society-logo',  heights: [80, 120], formats: ['webp', 'png'], extract: { left: 0, top: 265, width: 1860, height: 1518 } },
  { src: 'public/assets/logos/magazine-logo.png',  outDir: 'public/assets/responsive', base: 'magazine-logo', heights: [80, 120], formats: ['webp', 'png'], extract: { left: 0, top: 265, width: 1962, height: 1517 } },
];

async function run() {
  for (const job of JOBS) {
    const srcPath = path.join(ROOT, job.src);
    const outDir = path.join(ROOT, job.outDir);
    fs.mkdirSync(outDir, { recursive: true });
    const base = () => job.extract ? sharp(srcPath).extract(job.extract) : sharp(srcPath);
    const meta = await base().metadata();
    const formats = job.formats || ['avif', 'webp', 'jpg'];
    const byHeight = !!job.heights;
    const sizes = (byHeight ? job.heights : job.widths).filter(s => s <= (byHeight ? meta.height : meta.width));
    if (!sizes.length) sizes.push(byHeight ? meta.height : meta.width);
    for (const s of sizes) {
      for (const ext of formats) {
        const outPath = path.join(outDir, `${job.base}-${s}.${ext}`);
        if (fs.existsSync(outPath)) continue;
        const pipeline = base().resize(byHeight ? { height: s, withoutEnlargement: true } : { width: s, withoutEnlargement: true });
        if (ext === 'avif') await pipeline.avif({ quality: 55 }).toFile(outPath);
        else if (ext === 'webp') await pipeline.webp({ quality: 72 }).toFile(outPath);
        else if (ext === 'png') await pipeline.png({ compressionLevel: 9 }).toFile(outPath);
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
