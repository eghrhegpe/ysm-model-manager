// ===== stats.worker 消息协议（主线程 web-stats.ts ↔ stats.worker.ts 共享）=====
// 纯类型 + 常量，无运行时依赖：worker 与主线程编排各自 import，避免循环引用。

/** 单模型统计结果（与 SearchResult 数值字段对齐） */
export interface WebModelStats {
  boneCount: number;
  cubeCount: number;
  texWidth: number;
  texHeight: number;
  hasError: boolean;
}

/** 带 path 的统计结果（Worker 返回，主线程按 path 对齐防顺序漂移） */
export type WebModelStatsWithPath = WebModelStats & { path: string };

/** 主线程 → Worker：批量统计任务 */
export interface StatsWorkerRequest {
  type: "stats";
  /** 模型路径列表（/web/<type>/<name>/<rel>），单批上限由主线程负责切分 */
  paths: string[];
  /** 请求序号（主线程自增），worker 原样带回，防乱序串批 */
  requestId: number;
}

/** Worker → 主线程：进度（每 10 个模型一条）。注意：当前无主线程消费方——
 * web-stats.ts onmessage 忽略本消息，UI 进度按 chunk 完成数推进（P3 审核：协议字段留作细粒度进度条扩展点，勿误认为已生效） */
export interface StatsWorkerProgress {
  type: "progress";
  requestId: number;
  done: number;
  total: number;
}

/** Worker → 主线程：批量结果（与 paths 一一对应，含 path 便于主线程对齐） */
export interface StatsWorkerResult {
  type: "result";
  requestId: number;
  results: Array<WebModelStatsWithPath>;
}

/** Worker → 主线程：致命错误（WASM 无法加载 / 任务内部异常），主线程据此整体降级 */
export interface StatsWorkerError {
  type: "error";
  requestId: number;
  message: string;
}

export type StatsWorkerResponse =
  | StatsWorkerProgress
  | StatsWorkerResult
  | StatsWorkerError;

/** 单批模型上限：防 Worker 内存爆（每个模型 WASM 解码 + 纹理驻留 HEAP，200 已含余量） */
export const STATS_BATCH_LIMIT = 200;
