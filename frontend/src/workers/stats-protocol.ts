// ===== stats.worker 消息协议（主线程 web-stats.ts ↔ stats.worker.ts 共享）=====
// 纯类型 + 常量 + 零依赖纯函数，无运行时依赖：worker 与主线程编排各自 import，避免循环引用。

/** 单模型统计结果（与 SearchResult 数值字段对齐） */
export interface WebModelStats {
  boneCount: number;
  cubeCount: number;
  texWidth: number;
  texHeight: number;
  hasError: boolean;
}

/** 带 path 的统计结果（Worker 逐模型回包；主线程按 path 累积对齐——Map 查表，回包序不承担契约，ADR-218 D2 / ADR-219 D1） */
export type WebModelStatsWithPath = WebModelStats & { path: string };

/** 主线程 → Worker：批量统计任务（paths 可被主线程裁剪为「剩余未回包模型」子集——
 *  挂死重试时只重发剩余，已回包模型不重放，ADR-219 D2） */
export interface StatsWorkerRequest {
  type: "stats";
  /** 模型路径列表（/web/<type>/<name>/<rel>），单批上限由主线程负责切分 */
  paths: string[];
  /** 请求序号（主线程自增），worker 原样带回，防乱序串批 */
  requestId: number;
}

/** Worker → 主线程：逐模型流式结果（每模型统计完成后立即回包一条——主线程按 path 累积 +
 *  单 worker 静默看门狗的侦测信号：挂死 worker 停止产出 partial，ADR-219 D1/D2） */
export interface StatsWorkerPartial {
  type: "partial";
  requestId: number;
  result: WebModelStatsWithPath;
}

/** Worker → 主线程：流结束标记（逐模型结果经 partial 送达，本消息只标志「循环走完、无更多
 *  partial」；主线程收到后该 chunk 收尾，缺条目按 EMPTY_ERROR 细粒度补位，ADR-219 D1）。
 *  doneCount = worker 声称本批已处理的模型数（= 应回包 partial 数；当前实现逐模型必回包，
 *  恒等于 paths.length——未来 worker 内并行/跳过时代表实际处理数）。主线程以
 *  received(partial) vs doneCount 对账：缺条目（消息流不完整）dbg 留痕，防御补位语义不变。 */
export interface StatsWorkerResult {
  type: "result";
  requestId: number;
  doneCount: number;
}

/** Worker → 主线程：致命错误（WASM 无法加载 / 任务内部异常），主线程据此终止该 worker
 *  并换 worker 重试剩余（重试耗尽 → 整批降级，ADR-219 D3 故障边界） */
export interface StatsWorkerError {
  type: "error";
  requestId: number;
  message: string;
}

export type StatsWorkerResponse = StatsWorkerPartial | StatsWorkerResult | StatsWorkerError;

// 进度说明：worker 级细粒度消息 = partial 流（ADR-219 D1 重开，ADR-218 D2 的部分修订）——
// 服务正确性（看门狗侦测 + 主线程逐模型累积），UI 进度顺带从 chunk 级升级为模型级
// （onStatsProgress 逐模型推进，零额外协议成本）。

/** 单批模型上限：worker 逐模型处理（for await 循环，峰值内存由单模型解码产物决定，与批大小
 *  无关）——本限制的真实理由是：① 单批墙钟预算（STATS_CHUNK_TIMEOUT_MS=60s）内可完成；
 *  ② 进度按模型级推进时粒度可感知（UI 角标）；200 已含余量。 */
export const STATS_BATCH_LIMIT = 200;

/** 当前是否已跨源隔离（SW 补头 / Go mpr middleware 后 crossOriginIsolated=true；
 *  供多线程 WASM 分支选型）。零依赖纯函数：读全局布尔，worker 全局与主线程均安全；
 *  全链路唯一事实源——coi-sw.ts（SW 注册判定）与 stats.worker.ts（mt/base 选型）共用，
 *  避免两处各自内联探测漂移。 */
export function isCrossOriginIsolated(): boolean {
  return typeof crossOriginIsolated === "boolean" && crossOriginIsolated;
}
