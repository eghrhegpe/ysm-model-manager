// ===== 位解码工具（对齐 nbt.go extractBits / bitsPerEntry + voxel.go readVarInt）=====
// 纯函数：从 LongArray（精确 bigint[]）按位偏移取位，支持跨 64 位容器边界。
// 消费方：litematic-voxel.ts / schematic-voxel.ts / voxel-pipeline.ts

/**
 * 对齐 voxel.go:531-549 readVarInt：返回 {value, offset}（shift≥64 截断防溢出 wrap）
 * 用于 .schematic v2 BlockData varint 解码。
 */
export function readVarInt(
  data: ArrayLike<number>,
  offset: number,
): { value: number; offset: number } {
  let result = 0;
  let shift = 0;
  while (offset < data.length) {
    if (shift >= 64) break; // 畸形 varint（连续 continuation bit 无终止）→ 截断返回
    const b = data[offset];
    offset++;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result, offset };
}

/**
 * 对齐 nbt.go:299-327 extractBits：从 LongArray（精确 bigint[]，小端位序）按
 * bitOffset 取 bitCount 位，支持跨 64 位容器边界。longIdx 越界返回 0
 * （与 Go 一致——越界位视为 air）。
 */
export function extractBits(longs: bigint[], bitOffset: number, bitCount: number): number {
  if (bitCount <= 0 || bitOffset < 0) return 0;
  const longIdx = Math.floor(bitOffset / 64);
  const bitPos = bitOffset % 64;
  if (longIdx >= longs.length) return 0;
  const mask = (1n << BigInt(bitCount)) - 1n;
  if (bitPos + bitCount <= 64) {
    return Number((BigInt(longs[longIdx]) >> BigInt(bitPos)) & mask);
  }
  const bitsFromFirst = 64 - bitPos;
  const bitsFromSecond = bitCount - bitsFromFirst;
  const low = BigInt(longs[longIdx]) >> BigInt(bitPos);
  let high = 0n;
  if (longIdx + 1 < longs.length) {
    high = BigInt(longs[longIdx + 1]) & ((1n << BigInt(bitsFromSecond)) - 1n);
  }
  return Number(low | (high << BigInt(bitsFromFirst)));
}

/** 对齐 nbt.go:329-338 bitsPerEntry：palette 大小 → 每方块位数（≥2，单条目返回 0） */
export function bitsPerEntry(paletteSize: number): number {
  if (paletteSize <= 1) return 0;
  let b = Math.ceil(Math.log2(paletteSize));
  if (b < 2) b = 2;
  return b;
}

/**
 * 打包位解码：expectedCount 个方块索引 → palette 索引数组。
 * 输入为精确 64 位 LongArray（parseNbtRootExact 产物；number 归一有精度损失，
 * 见 nbt-parse.ts NbtReader.longsExact）。越界位 → 0（air），与 Go extractBits 一致。
 */
export function unpackBlockStates(
  longs: bigint[],
  bitsPerBlock: number,
  expectedCount: number,
): number[] {
  const out: number[] = new Array(expectedCount);
  for (let i = 0; i < expectedCount; i++) {
    out[i] = extractBits(longs, i * bitsPerBlock, bitsPerBlock);
  }
  return out;
}
