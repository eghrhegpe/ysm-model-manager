// Visual probe for ground-surface design exploration.
// Uses the REAL pixel generators from the codebase (Node 24 type-stripping executes the .ts).
// Renders candidate default-surface looks to PNG so the design report can be verified by reading images.
//
// NOT production code. Lives in artifacts/, never imported by src/.
//
// Run:  node artifacts/ground-design-probe/render-tiles.mjs
//
// Outputs (to artifacts/ground-design-probe/_shots/):
//   tile-plain-default.png       baseline solid/plain flat 0x9a8b78
//   tile-plain-micronoise.png    proposal A: warm brown + faint tiled micro-noise
//   tile-plain-grey-micronoise.png proposal A2: neutral matte grey + micro-noise
//   tile-plain-deep-micronoise.png  proposal A3: deeper warm neutral + micro-noise
//   tile-checker-overlay.png     proposal E: soft transparent checker as overlay layer
//   tile-marble.png / tile-sand.png / tile-grass.png  existing canvas presets (for contrast)
//   sheet-baseline.png           plain | marble | sand | grass
//   sheet-prototype.png          plain-default | plain-micronoise | plain-grey-micronoise | checker

import { generatePlainPixels } from "../../frontend/src/preview-3d/caps/surface-pixels/plain.ts";
import { generateMarblePixels } from "../../frontend/src/preview-3d/caps/surface-pixels/marble.ts";
import { generateSandPixels } from "../../frontend/src/preview-3d/caps/surface-pixels/sand.ts";
import { generateGrassPixels } from "../../frontend/src/preview-3d/caps/surface-pixels/grass.ts";
import { tiledFbm } from "../../frontend/src/preview-3d/caps/surface-pixels/noise.ts";

const SIZE = 512;

// ---- minimal truecolor+alpha PNG encoder (node zlib) ----
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const cd = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cd), 0);
  return Buffer.concat([len, cd, crc]);
}
function writePng(file, rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // add filter byte (0) per row
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    const srcStart = y * w * 4;
    const dstStart = y * (w * 4 + 1) + 1;
    for (let i = 0; i < w * 4; i++) raw[dstStart + i] = rgba[srcStart + i];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}

const OUT = path.resolve("artifacts/ground-design-probe/_shots");
fs.mkdirSync(OUT, { recursive: true });

// baseline flat warm brown (current solid/plain default)
function plain(rgb) {
  return generatePlainPixels({ color: rgb, color2: rgb, gridSize: 8, density: 1, angleRad: 0 }, SIZE);
}

// proposal A: flat base + faint seamless micro-noise (so tiling is invisible but surface reads as "material")
function plainMicro(rgb, amp, freq) {
  const px = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;
      const n = tiledFbm(u, v, freq, freq, 0, 3) - 0.5; // [-0.5,0.5]
      const d = Math.round(n * 2 * amp); // ±amp on 0..255
      const i = (y * SIZE + x) * 4;
      px[i] = clamp255(rgb[0] + d);
      px[i + 1] = clamp255(rgb[1] + d);
      px[i + 2] = clamp255(rgb[2] + d);
      px[i + 3] = 255;
    }
  }
  return px;
}
function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// proposal E: soft transparent checker overlay (line = slightly darker warm, base transparent)
function checkerOverlay(lineRGB, cells, lineSoft) {
  const px = new Uint8Array(SIZE * SIZE * 4);
  const lineW = Math.max(1, Math.round(SIZE / 256));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const isLine = x % (SIZE / cells) < lineW || y % (SIZE / cells) < lineW;
      const i = (y * SIZE + x) * 4;
      if (isLine) {
        px[i] = lineRGB[0];
        px[i + 1] = lineRGB[1];
        px[i + 2] = lineRGB[2];
        px[i + 3] = 255 * lineSoft;
      } else {
        px[i + 3] = 0;
      }
    }
  }
  return px;
}

function tileH(rgb) {
  const px = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = 255;
    }
  return px;
}

// ---- individual tiles ----
writePng(`${OUT}/tile-plain-default.png`, plain([154, 139, 120]), SIZE, SIZE); // 0x9a8b78
writePng(`${OUT}/tile-plain-micronoise.png`, plainMicro([154, 139, 120], 7, 24), SIZE, SIZE);
writePng(`${OUT}/tile-plain-grey-micronoise.png`, plainMicro([138, 138, 140], 7, 24), SIZE, SIZE); // neutral matte
writePng(`${OUT}/tile-plain-deep-micronoise.png`, plainMicro([120, 108, 96], 8, 20), SIZE, SIZE); // deeper warm neutral
writePng(`${OUT}/tile-checker-overlay.png`, checkerOverlay([110, 96, 80], 10, 0.5), SIZE, SIZE);
writePng(
  `${OUT}/tile-marble.png`,
  generateMarblePixels({ color: [232, 229, 223], color2: [143, 138, 128], gridSize: 6, density: 1.5, angleRad: 0 }, SIZE),
  SIZE,
  SIZE,
);
writePng(
  `${OUT}/tile-sand.png`,
  generateSandPixels({ color: [216, 196, 154], color2: [168, 143, 95], gridSize: 8, density: 1, angleRad: 0 }, SIZE),
  SIZE,
  SIZE,
);
writePng(
  `${OUT}/tile-grass.png`,
  generateGrassPixels({ color: [76, 122, 58], color2: [47, 85, 36], gridSize: 8, density: 1.5, angleRad: 0 }, SIZE),
  SIZE,
  SIZE,
);

// ---- contact sheets ----
function sideBySide(tiles) {
  const n = tiles.length;
  const W = SIZE * n;
  const out = new Uint8Array(W * SIZE * 4);
  for (let t = 0; t < n; t++) {
    const src = tiles[t];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const si = (y * SIZE + x) * 4;
        const di = (y * W + (t * SIZE + x)) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      }
  }
  return out;
}

writePng(
  `${OUT}/sheet-baseline.png`,
  sideBySide([
    plain([154, 139, 120]),
    generateMarblePixels({ color: [232, 229, 223], color2: [143, 138, 128], gridSize: 6, density: 1.5, angleRad: 0 }, SIZE),
    generateSandPixels({ color: [216, 196, 154], color2: [168, 143, 95], gridSize: 8, density: 1, angleRad: 0 }, SIZE),
    generateGrassPixels({ color: [76, 122, 58], color2: [47, 85, 36], gridSize: 8, density: 1.5, angleRad: 0 }, SIZE),
  ]),
  SIZE * 4,
  SIZE,
);

writePng(
  `${OUT}/sheet-prototype.png`,
  sideBySide([
    plain([154, 139, 120]),
    plainMicro([154, 139, 120], 7, 24),
    plainMicro([138, 138, 140], 7, 24),
    checkerOverlay([110, 96, 80], 10, 0.5),
  ]),
  SIZE * 4,
  SIZE,
);

console.log("wrote tiles to", OUT);
