// ===== 测试用纹理字节构造器（单一事实源）=====
// 从 stats-core.test.ts 抽出：构造最小 PNG/JPEG 字节，供 sniffTexSize 相关测试共用。
// 消除测试文件间构造器重复（jscpd）。

/** 构造最小 PNG 字节（签名 + IHDR 宽高，对齐 sniffTexSize 读取偏移 16..23） */
export function pngBytes(w: number, h: number): Uint8Array {
  const arr = new Uint8Array(24);
  arr[0] = 0x89;
  arr[1] = 0x50;
  arr[2] = 0x4e;
  arr[16] = (w >>> 24) & 0xff;
  arr[17] = (w >>> 16) & 0xff;
  arr[18] = (w >>> 8) & 0xff;
  arr[19] = w & 0xff;
  arr[20] = (h >>> 24) & 0xff;
  arr[21] = (h >>> 16) & 0xff;
  arr[22] = (h >>> 8) & 0xff;
  arr[23] = h & 0xff;
  return arr;
}

/** 构造最小 JPEG 字节（SOI + SOF0 段携带宽高，对齐 sniffTexSize 的 SOF 扫描） */
export function jpgBytes(w: number, h: number): Uint8Array {
  const arr = new Uint8Array(12);
  arr[0] = 0xff;
  arr[1] = 0xd8;
  arr[2] = 0xff;
  arr[3] = 0xc0; // SOF0
  arr[6] = 0x08; // precision
  arr[7] = (h >>> 8) & 0xff;
  arr[8] = h & 0xff;
  arr[9] = (w >>> 8) & 0xff;
  arr[10] = w & 0xff;
  return arr;
}
