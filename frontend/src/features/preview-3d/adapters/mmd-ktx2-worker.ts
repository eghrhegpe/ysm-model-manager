// ===== MMD KTX2 编码 Worker =====
// 将 WASM basis_encoder 的同步编码挪到 Worker 线程，避免 4096² 大纹理
// 单次 ~10s 的同步编码阻塞主进程（首次加载卡死问题）。
// 主线程 encodeToKTX2 → postMessage(RGBA + 尺寸) → 本 Worker 编码 → 回传 KTX2 ArrayBuffer。
import { encodeToKTX2Basis, TextureTooLargeError } from "./mmd-ktx2-basis.ts";
import { safeErrorMessage } from "../../../utils/safe-error-msg.ts";

/** 主线程 → Worker 的请求 */
export interface Ktx2EncodeRequest {
  id: number;
  width: number;
  height: number;
  data: ArrayBuffer; // RGBA 像素（transferable）
}

/** Worker → 主线程的响应 */
export interface Ktx2EncodeResponse {
  id: number;
  ok: boolean;
  buffer?: ArrayBuffer; // 编码后的 KTX2（transferable）
  error?: string;
}

self.onmessage = async (e: MessageEvent<Ktx2EncodeRequest>) => {
  const { id, width, height, data } = e.data;
  try {
    const buf = await encodeToKTX2Basis({ data: new Uint8Array(data), width, height });
    const resp: Ktx2EncodeResponse = { id, ok: true, buffer: buf };
    (self as unknown as Worker).postMessage(resp, [buf]);
  } catch (err) {
    const resp: Ktx2EncodeResponse = {
      id,
      ok: false,
      error: safeErrorMessage(err),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};

// 类型守卫：让 TS 知道这是 worker 上下文（vite worker chunk 约定）
export {};
