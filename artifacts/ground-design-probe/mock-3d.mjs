// Conceptual 3D-style mock renders (2D raster, no GPU) for ground-design exploration.
// Demonstrates proposal B (grid horizon-fade / soft horizon) and proposal D (grounding shadow + faint env reflection).
// Uses the SAME proposed color values as the report. NOT production code; lives in artifacts/.
//
// Run: node artifacts/ground-design-probe/mock-3d.mjs
// Out: _shots/mock-horizon-fade.png , _shots/mock-grounding.png

import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const W = 1280;
const H = 720;

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
function writePng(file, buf, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    const ds = y * (w * 4 + 1) + 1;
    const ss = y * w * 4;
    for (let i = 0; i < w * 4; i++) raw[ds + i] = buf[ss + i];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  fs.writeFileSync(file, Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]));
}

function makeBuf() {
  return new Uint8Array(W * H * 4);
}
function setPx(buf, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  // alpha blend over existing
  const ea = buf[i + 3] / 255;
  const na = a / 255;
  buf[i] = Math.round(r * na + buf[i] * ea * (1 - na));
  buf[i + 1] = Math.round(g * na + buf[i + 1] * ea * (1 - na));
  buf[i + 2] = Math.round(b * na + buf[i + 2] * ea * (1 - na));
  buf[i + 3] = Math.round((na + ea * (1 - na)) * 255);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function line(buf, x0, y0, x1, y1, col, alpha) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPx(buf, x, y, col[0], col[1], col[2], alpha);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

const OUT = path.resolve("artifacts/ground-design-probe/_shots");
fs.mkdirSync(OUT, { recursive: true });

// ============ Mock 1: horizon fade (proposal B) ============
// Near ground warm brown 0x9a8b78, fades into horizon haze; perspective grid lines
// fade out with distance (no hard ground edge).
{
  const buf = makeBuf();
  const horizon = Math.round(H * 0.52);
  const skyTop = [206, 218, 232];
  const skyHorizon = [224, 230, 236];
  const groundNear = [154, 139, 120];
  const groundFar = [214, 219, 224];
  // sky gradient
  for (let y = 0; y < horizon; y++) {
    const t = y / horizon;
    const c = mix(skyTop, skyHorizon, t);
    for (let x = 0; x < W; x++) setPx(buf, x, y, c[0], c[1], c[2], 255);
  }
  // ground gradient (near -> far horizon), fades into horizon haze so no hard edge
  for (let y = horizon; y < H; y++) {
    const t = (y - horizon) / (H - horizon); // 0 at horizon, 1 at bottom
    const c = mix(groundFar, groundNear, t); // far = haze, near = brown
    for (let x = 0; x < W; x++) setPx(buf, x, y, c[0], c[1], c[2], 255);
  }
  // perspective grid: vertical lines converge to vanishing point at (W/2, horizon)
  const vpX = W / 2;
  const gridCol = [96, 84, 70];
  const rows = 14;
  for (let r = 1; r <= rows; r++) {
    const t = r / rows;
    const y = Math.round(horizon + (H - horizon) * t * t); // perspective spacing (denser far)
    // horizontal line, alpha fades with distance
    const a = Math.round(lerp(60, 200, 1 - t));
    line(buf, 0, y, W, y, gridCol, a);
  }
  // vertical lines: spread at bottom, converge at VP
  const cols = 16;
  for (let c = 0; c <= cols; c++) {
    const bx = (c / cols) * W;
    line(buf, Math.round(bx), H - 1, Math.round(vpX), horizon, gridCol, 150);
  }
  writePng(`${OUT}/mock-horizon-fade.png`, buf, W, H);
}

// ============ Mock 2: grounding shadow + faint env reflection (proposal D) ============
// A matte floor with a soft contact shadow under a model silhouette + faint vertical env
// reflection so the model reads as "grounded".
{
  const buf = makeBuf();
  const floorY = Math.round(H * 0.62);
  const wallTop = [232, 233, 235];
  const floorCol = [150, 138, 122];
  // simple studio: upper wall lighter, floor warm matte
  for (let y = 0; y < floorY; y++) {
    const c = mix([238, 239, 241], [222, 224, 227], y / floorY);
    for (let x = 0; x < W; x++) setPx(buf, x, y, c[0], c[1], c[2], 255);
  }
  for (let y = floorY; y < H; y++) {
    const t = (y - floorY) / (H - floorY);
    const c = mix(floorCol, [120, 110, 96], t); // slightly darker far
    for (let x = 0; x < W; x++) setPx(buf, x, y, c[0], c[1], c[2], 255);
  }
  // model silhouette (a simple character blob) standing on floor
  const cx = Math.round(W * 0.42);
  const headR = 34;
  const headY = floorY - 150;
  // body
  for (let y = headY; y < floorY; y++) {
    const halfW = y < headY + headR * 2 ? 18 : 46;
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      setPx(buf, x, y, 70, 90, 120, 255);
    }
  }
  // head
  for (let y = headY - headR; y <= headY + headR; y++)
    for (let x = cx - headR; x <= cx + headR; x++) {
      const dx = (x - cx) / headR;
      const dy = (y - headY) / headR;
      if (dx * dx + dy * dy <= 1) setPx(buf, x, y, 70, 90, 120, 255);
    }
  // soft contact shadow (ellipse, faded) on floor
  const shY = floorY + 2;
  for (let y = shY - 14; y < shY + 22; y++)
    for (let x = cx - 70; x <= cx + 70; x++) {
      const dx = (x - cx) / 70;
      const dy = (y - shY) / 18;
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        const a = Math.round(lerp(150, 0, d) * (y < shY ? 1 : 0.6));
        setPx(buf, x, y, 40, 34, 28, a);
      }
    }
  // faint vertical env reflection of the model (mirror below floor, low alpha, blurred by simple fade)
  for (let y = floorY; y < floorY + 130; y++) {
    const srcY = floorY - (y - floorY);
    const a = Math.round(lerp(70, 0, (y - floorY) / 130));
    for (let x = cx - 50; x <= cx + 50; x++) {
      const dx = (x - cx) / 50;
      if (Math.abs(dx) <= 1) setPx(buf, x, y, 70, 90, 120, a);
    }
  }
  writePng(`${OUT}/mock-grounding.png`, buf, W, H);
}

console.log("wrote mocks to", OUT);
