// ===== 大文件解码内存风险警示（受限平台 OOM 的前置防线）=====
// 背景：前端 WASM 解码 .ysm 的峰值内存 ≈ 3-4× 文件大小——base64 → Uint8Array →
// WASM HEAP → MEMFS → readFile → JSON.parse 六层拷贝并存（见 docs/knowledge/model3d.md
// 不变量）。100MB 阈值是网页版唯一防线，4GB RAM 设备的峰值可能触顶 OOM。
//
// 本模块**不改内存模型**（零拷贝流式解码是长期项），只做**事前告知**：受限平台
// 加载超大模型时给一条带实测字节数的 toast，让用户对卡顿/崩溃有预期，
// 而不是静默 OOM 后一脸茫然。
//
// 归属说明：判定 + 文案提示放 infra 横向层（decoder 是纯解析层，不引 i18n/bus）。

import { isViewerMode } from "@/backend/platform.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";

/** 警示阈值：50MB。峰值按 3× 估算即 150MB，4GB 受限设备已接近危险区。 */
export const LARGE_MODEL_WARN_BYTES = 50 * 1024 * 1024;

/** 峰值内存倍数——实测范围 3-4×，取下界做乐观估计（避免吓人，且已足够警示）。 */
const PEAK_MEMORY_FACTOR = 3;

/** 单次会话内已警示的路径：同一模型反复切换预览只提醒一次（防 toast 轰炸）。 */
const warnedPaths = new Set<string>();

/** 测试用：重置警示记录（模块级状态，isolate:false 共享模块图下需显式复位）。 */
export function __resetLargeModelWarnForTest(): void {
  warnedPaths.clear();
}

/**
 * 受限平台加载大模型时给一条内存风险 toast。
 *
 * - 桌面端（有 Node 解码通道，内存充裕）不提示——提示是噪音；
 * - 判据用**调用方已持有的字节数**，不做额外 IO 探测；
 * - 同路径只警示一次。
 *
 * @param bytes 文件字节数（WASM 解码入口已持有）
 * @param path  模型路径（会话内去重键）
 */
export function warnLargeModelIfNeeded(bytes: number, path: string): void {
  if (!isViewerMode()) return;
  if (!Number.isFinite(bytes) || bytes <= LARGE_MODEL_WARN_BYTES) return;
  if (warnedPaths.has(path)) return;
  warnedPaths.add(path);
  const sizeMb = Math.round(bytes / (1024 * 1024));
  const peakMb = Math.round((bytes * PEAK_MEMORY_FACTOR) / (1024 * 1024));
  bus.emit("toast:show", {
    msg: `⚠️ ${t("preview.largeModelWarn", { size: sizeMb, peak: peakMb })}`,
    duration: TOAST_MS.verbose,
    type: "warn",
  });
}
