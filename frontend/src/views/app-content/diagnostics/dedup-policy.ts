// ===== 诊断页去重：keep 保留策略（纯函数层） =====
// 2026-09-03 自 dedup.ts 抽出（ADR-040 拆分线的延续）：策略决策零 DOM/会话依赖，
// 独立成层可零 mock 单测；渲染默认保留索引与 exec 删除共用同一决策源，防规则漂移。
// 入参对齐 Go 扫描结果字段（path/size/modTime），type 上与 dedup.ts 的 ScanFile 结构化兼容。
export interface DedupFileLike {
  path: string;
  size: number;
  modTime?: string | number;
}

// modTime 缺失/非法 → 返回 MAX_SAFE_INTEGER。**该哨兵只对 oldest 策略成立**（MAX 不可能是最小值，
// 故 oldest 下不会被选中，无时间信息时兜底首项）；但 newest 取最大值，哨兵会让这类文件被判为
// 「最新」——与「视为最老」的意图相反。真实场景 Go 扫描恒带回 ModTime（go/dedup），仅 mtime 恰为
// epoch 0 才触发，当前实际不可达。方向待裁决（newest 侧视作 -Infinity 或排除出候选）；现状由
// dedup-policy.test.ts 的「记录现状·待裁决」用例钉住。
function toTimestamp(modTime?: string | number): number {
  if (modTime === undefined || modTime === null || modTime === "") return Number.MAX_SAFE_INTEGER;
  const ts = typeof modTime === "number" ? modTime : Date.parse(modTime);
  return Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
}

function reduceOldestIdx(files: DedupFileLike[]): number {
  return files.reduce(
    (best, e, i, arr) => (toTimestamp(e.modTime) < toTimestamp(arr[best].modTime) ? i : best),
    0,
  );
}

function reduceNewestIdx(files: DedupFileLike[]): number {
  return files.reduce(
    (best, e, i, arr) => (toTimestamp(e.modTime) > toTimestamp(arr[best].modTime) ? i : best),
    0,
  );
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
