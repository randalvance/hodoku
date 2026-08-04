#!/usr/bin/env node
/**
 * Generates the extension icons.
 *
 * Written as a tiny rasteriser plus a PNG encoder rather than pulling in a
 * native image dependency: the mark is pure geometry, so it renders identically
 * everywhere and the build stays dependency-free.
 *
 * The mark is a macron-topped "A" — the single most recognisable thing about
 * Hepburn romaji — on an indigo-to-violet rounded square.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'icons');
const SIZES = [16, 32, 48, 128];

/** Supersampling factor; 4x is plenty to hide stair-stepping at 16px. */
const SS = 4;

const BG_TOP = [0x63, 0x5b, 0xff];
const BG_BOTTOM = [0x46, 0x33, 0xd9];
const FG = [0xff, 0xff, 0xff];

/** Strokes of the glyph in unit coordinates: [x0, y0, x1, y1, thickness]. */
const STROKES = [
  [0.30, 0.235, 0.70, 0.235, 0.075], // macron
  [0.235, 0.80, 0.50, 0.365, 0.105], // left leg
  [0.765, 0.80, 0.50, 0.365, 0.105], // right leg
  [0.335, 0.635, 0.665, 0.635, 0.09], // crossbar
];

const CORNER_RADIUS = 0.225;

/* --------------------------------- geometry -------------------------------- */

/** Distance from a point to a line segment. */
function distanceToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSq));
  const cx = x0 + t * dx;
  const cy = y0 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Signed distance to a rounded square covering the unit box. */
function distanceToRoundedSquare(px, py, radius) {
  const qx = Math.abs(px - 0.5) - (0.5 - radius);
  const qy = Math.abs(py - 0.5) - (0.5 - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

function insideGlyph(px, py) {
  for (const [x0, y0, x1, y1, thickness] of STROKES) {
    if (distanceToSegment(px, py, x0, y0, x1, y1) <= thickness / 2) return true;
  }
  return false;
}

/* ---------------------------------- render --------------------------------- */

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      // Supersample: average SS×SS sub-samples per output pixel.
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size;
          const py = (y + (sy + 0.5) / SS) / size;

          if (distanceToRoundedSquare(px, py, CORNER_RADIUS) > 0) continue;

          let sr;
          let sg;
          let sb;
          if (insideGlyph(px, py)) {
            [sr, sg, sb] = FG;
          } else {
            const t = py;
            sr = Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t);
            sg = Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t);
            sb = Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t);
          }
          r += sr;
          g += sg;
          b += sb;
          a += 255;
        }
      }

      const samples = SS * SS;
      const coverage = a / samples;
      const offset = (y * size + x) * 4;
      if (coverage > 0) {
        // Colours are averaged over covered samples only, so edge pixels keep
        // their hue instead of darkening toward black.
        const covered = a / 255;
        pixels[offset] = Math.round(r / covered);
        pixels[offset + 1] = Math.round(g / covered);
        pixels[offset + 2] = Math.round(b / covered);
        pixels[offset + 3] = Math.round(coverage);
      }
    }
  }

  return pixels;
}

/* ------------------------------- PNG encoding ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------- main ---------------------------------- */

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const png = encodePng(renderIcon(size), size);
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    await fs.writeFile(file, png);
    console.log(`  ${String(size).padStart(3)}×${size}  ${(png.length / 1024).toFixed(1)} KB  ${path.relative(ROOT, file)}`);
  }

  // The Web Store listing wants a 128px icon of its own.
  const storeDir = path.join(ROOT, 'store', 'assets');
  await fs.mkdir(storeDir, { recursive: true });
  await fs.writeFile(path.join(storeDir, 'store-icon-128.png'), encodePng(renderIcon(128), 128));
  console.log(`  store/assets/store-icon-128.png`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
