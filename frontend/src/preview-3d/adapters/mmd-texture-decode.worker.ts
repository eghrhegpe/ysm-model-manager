// ===== MMD 纹理解码 Worker =====
// 把 PNG/JPEG/BMP/GIF/WebP 解码从主线程挪到 Worker：
// 浏览器 createImageBitmap() 在 Worker 中可用，解码后产出 ImageBitmap（transferable），
// 主线程拿到后直接喂给 THREE.Texture，跳过 HTMLImageElement 的主线程解码路径。

import { safeErrorMessage } from "../../utils/safe-error-msg.ts";

/** 主线程 → Worker 的请求 */
export interface TexDecodeRequest {
  id: number;
  relPath: string; // 相对路径（映射用）
  bytes: ArrayBuffer; // 原始图片字节（transferable）
  mimeType: string; // "image/png" | "image/jpeg" | ...
}

/** Worker → 主线程的响应 */
export interface TexDecodeResponse {
  id: number;
  relPath: string;
  ok: boolean;
  bitmap?: ImageBitmap; // 解码成功（transferable）
  error?: string;
  width?: number;
  height?: number;
}

self.onmessage = async (e: MessageEvent<TexDecodeRequest>) => {
  const { id, relPath, bytes, mimeType } = e.data;
  try {
    const blob = new Blob([bytes], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    const resp: TexDecodeResponse = {
      id,
      relPath,
      ok: true,
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
    };
    (self as unknown as Worker).postMessage(resp, [bitmap]);
  } catch (err) {
    const resp: TexDecodeResponse = {
      id,
      relPath,
      ok: false,
      error: safeErrorMessage(err),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};

export {};