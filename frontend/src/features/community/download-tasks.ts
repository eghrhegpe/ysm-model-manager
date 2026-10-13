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
  // P3（审核发现）：数值守卫范式（AGENTS.md §3.4）——NaN 不比任何阈值大会误判 "ok"
  // 直接下载；Infinity 误判 reject。未知大小（NaN/±Infinity）一律拒绝，交由调用方兜底
  if (!Number.isFinite(size)) return "reject";
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

/**
 * 拼接单模型下载 URL：路径统一转正斜杠后**逐段** encodeURIComponent。
 * dlPrefix 尾带 `/` 属既定契约（Go/前端两侧产出的 raw/jsdelivr 前缀均如此），
 * 不重复补——补了会把 `@main/` 类形态拼成双斜杠变 404。
 * P3 收口：原裸拼 `dlPrefix + path` 遇路径含 `#`/`?`/`%` 时静默截断或坏转义
 * （`#` 落 fragment、`?` 起 query、裸 `%` 非合法转义）；仅空格/非 ASCII 属
 * 浏览器 fetch 会自愈的字符，原写法侥幸能用——保留字符必须显式编码。
 * 分隔符 `/` 保留不编码（故逐段处理，非整串 encodeURIComponent）。
 */
export function buildModelDownloadUrl(dlPrefix: string, path: string): string {
  const norm = path.replace(/\\/g, "/");
  const encoded = norm
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return dlPrefix + encoded;
}

/** 选中集 → 下载任务列表（路径统一转正斜杠 + 逐段编码；未匹配的选中项静默跳过） */
export function buildDownloadTasks(
  models: DownloadCandidate[],
  selectedNames: Iterable<string>,
  dlPrefix: string,
): DownloadTask[] {
  return [...selectedNames]
    .map((name) => models.find((m) => m.name === name))
    .filter((m): m is DownloadCandidate => Boolean(m))
    .map((m) => ({
      url: buildModelDownloadUrl(dlPrefix, m.path),
      saveDir: "",
      name: m.name,
      // P4（审核发现）：`m.size || 0` 会把 -1（Content-Length=-1 哨兵）当真值原样写入
      size: typeof m.size === "number" && Number.isFinite(m.size) && m.size > 0 ? m.size : 0,
    }));
}
