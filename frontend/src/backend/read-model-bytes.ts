// ===== 模型字节统一读取入口（平台差异收口 seam，ADR-228）=====
//
// 为什么需要这一层：前端解码 `.ysm` 的内存峰值 ≈ 4.33× 文件大小（L1 base64 串 1.33N
// + L2 atob 串 1.0N + L3 charCodeAt 拷贝 1.0N + HEAPU8.set 1.0N，实测见 ADR-228）。
// 两条平台的读取代价**根本不同**：
//
//   - 网页版：文件在 IndexedDB，`readWebFile` 是**纯前端本地函数调用**——没有 IPC、
//     没有序列化边界。把 `ArrayBuffer` 编码成 base64 再让解码链 `atob` 转回来，纯属
//     浪费（粗算烧 1.33N + slice + rope + atob ≈ 4.3N）。
//   - 桌面 / Android：必须过 Wails 桥，而其传输**只有 JSON**（`JSON.stringify` → fetch
//     → `response.json()`），Go 的 `[]byte` 必然包成 base64 —— 这条 base64 躲不掉。
//
// 结论：平台分叉无法消除，但应**只在这一处存在**（decoder 层不感知平台）。
// 调用方（`preview-3d/decoder/wasm-decode.ts`）只认「给我字节」这一个契约。
//
// 归属：本模块在 `backend/` 同层组合 `web-fs-read`（网页版实现）与 `app`（桥），
// 不是 binding、不进 `browserAdapter`——`webImpls` 是 `satisfies Partial<GoBindingShape>`，
// 只容纳 Go binding 存在的键；更不该为一个纯前端优化去动 Wails binding 契约
//（那会波及 `generate:bindings`、`web-fs.ts` 兜底与 Android 桥）。

import { base64ToBytes } from "@/utils/base/primitives/base64.ts";
import { getApp } from "./app.ts";
import { isWebPlatform } from "./platform.ts";
import { readWebFileArrayBuffer } from "./web-fs-read.ts";

/**
 * 读取模型文件的原始字节。失败（路径非法 / 文件不存在 / 后端不可用）返回 `null`。
 *
 * - 网页版：IndexedDB `ArrayBuffer` 直出（**零 base64 往返**）。注意
 *   `new Uint8Array(ab)` 是**视图而非拷贝**——本路径**零拷贝**；因 IDB 反序列化
 *   每次本就产生新的 `ArrayBuffer`，别名不共享给其他持有者，安全。
 * - 桌面 / Android：`ReadFileBytes`（base64 契约）→ `Uint8Array`（解码产生新缓冲）。
 *
 * 两条路径返回的 `Uint8Array` 都**独占自己的底层缓冲**（且 `byteOffset === 0`、
 * `byteLength === buffer.byteLength`），调用方可安全持有并写进 WASM 堆。
 */
export async function readModelBytes(path: string): Promise<Uint8Array | null> {
  if (isWebPlatform()) {
    // 零拷贝视图：idbGet 的结构化克隆产物是本调用独占的新 ArrayBuffer
    const ab = await readWebFileArrayBuffer(path);
    return ab ? new Uint8Array(ab) : null;
  }
  const { ReadFileBytes } = await getApp();
  const b64 = await ReadFileBytes(path);
  return b64 ? base64ToBytes(b64) : null;
}
