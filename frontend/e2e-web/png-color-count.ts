// ===== E2E 辅助：极简 PNG 解码 + 色桶统计（e2e-web 共享，零第三方依赖）=====
// 目的：对 Playwright 截图 buffer 统计色相桶数，硬断言模型不是纯黑剪影。
// 仅支持 Web 常见的 8bit RGB/RGBA（color type 2/6），非交错；其余返回 null。
// zlib 来自 Node 内置（Playwright 测试跑在 Node 环境）。

import zlib from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 解开一张 PNG 为 RGBA 像素数组（长度 = width*height*4）；不支持返回 null */
export function decodePng(buf: Buffer): { width: number; height: number; rgba: Buffer } | null {
  if (!buf || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (!width || !height || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return null;
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const strideLen = stride + 1;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride); // 上一行原始数据
  for (let y = 0; y < height; y++) {
    const rowStart = y * strideLen;
    const filter = raw[rowStart];
    const row = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x] ?? 0;
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1)
        v = (v + a) & 0xff; // Sub
      else if (filter === 2)
        v = (v + b) & 0xff; // Up
      else if (filter === 3)
        v = (v + ((a + b) >> 1)) & 0xff; // Average
      else if (filter === 4) {
        // Paeth
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        v = (v + pred) & 0xff;
      }
      cur[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * channels];
      out[o + 1] = cur[x * channels + 1];
      out[o + 2] = cur[x * channels + 2];
      out[o + 3] = channels === 4 ? cur[x * channels + 3] : 0xff;
    }
    prev = cur;
  }
  return { width, height, rgba: out };
}

/**
 * 统计 PNG 中「非黑像素」的色相桶数（16 级桶，抗光照渐变噪声）。
 * 只统计 alpha > 0 且 RGB 不全为 0 的像素；跳过纯黑（阴影/背景黑不是模型证据）。
 */
export function countDistinctColorBuckets(buf: Buffer): number {
  const png = decodePng(buf);
  if (!png) return 0;
  const buckets = new Set<string>();
  const { width, height, rgba } = png;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    const r = rgba[o] >> 4;
    const g = rgba[o + 1] >> 4;
    const b = rgba[o + 2] >> 4;
    if (r + g + b === 0) continue;
    buckets.add(`${r},${g},${b}`);
  }
  return buckets.size;
}
