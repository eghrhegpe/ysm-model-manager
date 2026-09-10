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

/** 带 path 的统计结果（Worker 返回；主线程合并层按 path 对齐——Map 查表，回包序不承担契约，ADR-218 D2） */
export type WebModelStatsWithPath = WebModelStats & { path: string };

/** 主线程 → Worker：批量统计任务 */
export interface StatsWorkerRequest {
  type: "stats";
  /** 模型路径列表（/web/<type>/<name>/<rel>），单批上限由主线程负责切分 */
  paths: string[];
  /** 请求序号（主线程自增），worker 原样带回，防乱序串批 */
  requestId: number;
}

/** Worker → 主线程：批量结果（合并层按 path 对齐，见 WebModelStatsWithPath） */
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

export type StatsWorkerResponse = StatsWorkerResult | StatsWorkerError;

// 进度说明（ADR-218 D2）：worker 级细粒度进度消息已移除——UI 进度本就走主线程 chunk 级
// onStatsProgress（web-stats.ts 逐批推进）；未来需要细粒度进度条时在 protocol 层扩展。

/** 单批模型上限：防 Worker 内存爆（每个模型 WASM 解码 + 纹理驻留 HEAP，200 已含余量） */
export const STATS_BATCH_LIMIT = 200;
