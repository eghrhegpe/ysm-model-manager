// ===== 诊断页去重：keep 保留策略（纯函数层） =====
// 2026-09-03 自 dedup.ts 抽出（ADR-040 拆分线的延续）：策略决策零 DOM/会话依赖，
// 独立成层可零 mock 单测；渲染默认保留索引与 exec 删除共用同一决策源，防规则漂移。
// 入参对齐 Go 扫描结果字段（path/size/modTime），type 上与 dedup.ts 的 ScanFile 结构化兼容。
export interface DedupFileLike {
  path: string;
  size: number;
  modTime?: string | number;
}

// modTime 缺失/非法 → null（「无时间信息」，不参与时间裁决）。各策略在 reduce 内自行兜底：
// 全缺失时取首项（严格比较保序）。Go 扫描恒带回 ModTime（go/dedup），仅 mtime 恰为 epoch 0
// 才触发，生产不可达。
function toTimestamp(modTime?: string | number): number | null {
  if (modTime === undefined || modTime === null || modTime === "") return null;
  const ts = typeof modTime === "number" ? modTime : Date.parse(modTime);
  return Number.isNaN(ts) ? null : ts;
}

/** 按时间戳 pick：null 候选跳过（不参与裁决）；全 null 时回退首项（严格比较保序）。 */
function pickByTime(files: DedupFileLike[], cmp: (a: number, b: number) => boolean): number {
  let best = -1;
  for (let i = 0; i < files.length; i++) {
    const t = toTimestamp(files[i].modTime);
    if (t === null) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const bt = toTimestamp(files[best].modTime);
    if (bt !== null && cmp(t, bt)) best = i;
  }
  return best === -1 ? 0 : best;
}

function reduceOldestIdx(files: DedupFileLike[]): number {
  return pickByTime(files, (a, b) => a < b);
}

function reduceNewestIdx(files: DedupFileLike[]): number {
  return pickByTime(files, (a, b) => a > b);
}

function reducePathIdx(files: DedupFileLike[], priorityPath: string): number {
  if (priorityPath) {
    const idx = files.findIndex((f) => f.path.toLowerCase().startsWith(priorityPath.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return reduceLargestIdx(files);
}

function reduceLargestIdx(files: DedupFileLike[]): number {
  return files.reduce((best, e, i, arr) => (e.size > arr[best].size ? i : best), 0);
}

/**
 * 根据保留策略决定默认保留的文件索引
 * - "oldest": 保留最早修改的文件
 * - "newest": 保留最新修改的文件
 * - "path": 保留指定路径前缀匹配的文件
 * - 其他/默认: 保留最大文件（size 最大）
 */
export function getDefaultKeepIdx(
  files: DedupFileLike[],
  policy: string,
  priorityPath: string,
): number {
  if (files.length === 0) return 0;

  switch (policy) {
    case "oldest":
      return reduceOldestIdx(files);
    case "newest":
      return reduceNewestIdx(files);
    case "path":
      return reducePathIdx(files, priorityPath);
    default:
      return reduceLargestIdx(files);
  }
}
