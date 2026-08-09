// ===== 创意工坊下载任务构建 + 大小策略（纯函数层）=====
// 从 community/events.ts 抽出：下载大小决策（4MB 确认 / 10MB 拒绝）与
// 选中集 → 下载任务列表的构建逻辑，供单测覆盖（ADR-023 L3）。
import type { DownloadTask } from "./download-queue.ts";

/** 超过该大小需弹窗确认（含边界值本身直接下载） */
export const DOWNLOAD_CONFIRM_BYTES = 4 * 1024 * 1024;
/** 超过该大小直接拒绝（含边界值本身需确认） */
export const DOWNLOAD_REJECT_BYTES = 10 * 1024 * 1024;

export type DownloadSizeDecision = "ok" | "confirm" | "reject";

/** 下载大小策略：≤4MB 直接下；4–10MB 需确认；>10MB 拒绝 */
export function classifyDownloadSize(size: number): DownloadSizeDecision {
  if (size > DOWNLOAD_REJECT_BYTES) return "reject";
  if (size > DOWNLOAD_CONFIRM_BYTES) return "confirm";
  return "ok";
}

/** 下载候选（结构类型，兼容 WorkshopModel） */
export interface DownloadCandidate {
  name: string;
  path: string;
  size?: number;
}

/** 选中集 → 下载任务列表（路径统一转正斜杠；未匹配的选中项静默跳过） */
export function buildDownloadTasks(
  models: DownloadCandidate[],
  selectedNames: Iterable<string>,
  dlPrefix: string,
): DownloadTask[] {
  return [...selectedNames]
    .map((name) => models.find((m) => m.name === name))
    .filter((m): m is DownloadCandidate => Boolean(m))
    .map((m) => ({
      url: dlPrefix + m.path.replace(/\\/g, "/"),
      saveDir: "",
      name: m.name,
      size: m.size || 0,
    }));
}
