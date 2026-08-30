// ===== 纹理字节尺寸嗅探（单一事实源）=====
// 从 wasm.ts / stats-core.ts 抽出的公共纯函数：嗅探 PNG/JPEG 字节的像素宽高。
// 口径对齐 Go 端 imagePixelArea（internal/app/），勿单独改——两处调用点
// （WASM 解码层 wasm.ts、模型统计 stats-core.ts）共用此实现，消除 24 行跨文件重复（jscpd）。
// 纯函数、零依赖：Worker 与主线程均可安全 import。

/** PNG 8 字签名前 3 字节（89 50 4E，后接 47 0A 16 0A） */
const PNG_SIG = [0x89, 0x50, 0x4e];
/** JPEG SOI(0xD8) 标记——段起始 0xFF */
const JPEG_MARKER = 0xff;
/** JPEG SOF0-15 段携带尺寸；排除无尺寸的 DHT(0xC4)/JPG(0xC8)/DAC(0xCC) */
const JPEG_SOF_MASK = 0xc0;
const JPEG_SOF_EXCLUDE = [0xc4, 0xc8, 0xcc];
/** JPEG 头部扫描上限（足够覆盖 SOI 后首个 SOF，与 Go 端一致） */
const JPEG_HEADER_SCAN_LIMIT = 4096;

/**
 * 从纹理字节嗅探像素尺寸（PNG：8 字签名 + IHDR 后 4 字节宽/4 字节高大端；
 * JPEG：SOI 后首个 SOF 段高度/宽度）。失败返回 null。
 * 与 Go 端 imagePixelArea 口径一致，勿单独改。
 */
export function sniffTexSize(arr: Uint8Array): { w: number; h: number } | null {
  if (!arr?.length) return null;
  if (arr[0] === PNG_SIG[0] && arr[1] === PNG_SIG[1] && arr[2] === PNG_SIG[2]) {
    if (arr.length < 24) return null;
    const w = (arr[16] << 24) | (arr[17] << 16) | (arr[18] << 8) | arr[19];
    const h = (arr[20] << 24) | (arr[21] << 16) | (arr[22] << 8) | arr[23];
    return w > 0 && h > 0 ? { w, h } : null;
  }
  if (arr[0] === JPEG_MARKER && arr[1] === 0xd8) {
    for (let i = 2; i < Math.min(arr.length - 8, JPEG_HEADER_SCAN_LIMIT); i++) {
      const m = arr[i + 1];
      if (
        arr[i] === JPEG_MARKER &&
        (m & 0xf0) === JPEG_SOF_MASK &&
        !JPEG_SOF_EXCLUDE.includes(m)
      ) {
        const h = (arr[i + 5] << 8) | arr[i + 6];
        const w = (arr[i + 7] << 8) | arr[i + 8];
        return w > 0 && h > 0 ? { w, h } : null;
      }
    }
  }
  return null;
}
