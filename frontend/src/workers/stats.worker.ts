// ===== stats.worker.ts — 后台批量模型统计 Worker =====
// SearchModels 数值条件的统计来源（ADR-071 审计增强 #6 + 用户「多线程注入」要求）：
//  1. Worker 内 open IndexedDB（同源）读文件字节 —— 免主线程 base64 大字符串传输
//  2. Worker 内独立加载 YSMParser WASM（ysm-worker-loader.ts，不复用主线程 wasmModule 单例）
//  3. 逐个模型解码 → 统计骨骼/立方体/纹理尺寸 → postMessage 进度 + 批量结果
// 主线程编排（批量切分/超时/取消/降级）见 backend/web-stats.ts；协议见 stats-protocol.ts。
// 容量/取消：单批上限由主线程 STATS_BATCH_LIMIT 切分；主线程可 terminate 本 Worker 取消。
import { idbGet } from "../backend/idb.ts";
import { parseWebPath } from "../backend/web-common.ts";
import { safeErrorMessage } from "../utils/safe-error-msg.ts";
import {
  initYsmParserInWorker,
  initYsmParserInWorkerMt,
  decodeYsmInWorker,
  decodeYsmInWorkerMemfs,
} from "../wasm/ysm-worker-loader.ts";
import { stripYsgpTextHeader } from "../views/app-preview/utils.ts";
import {
  statsFromDecodedFiles,
  statsFromJsonBytes,
  type StatsRelReader,
} from "./stats-core.ts";
import type {
  StatsWorkerRequest,
  StatsWorkerResponse,
  WebModelStats,
  WebModelStatsWithPath,
} from "./stats-protocol.ts";

/** Worker 全局（module worker 下为 DedicatedWorkerGlobalScope；显式声明避免依赖 lib） */
const ctx = self as unknown as {
  postMessage: (msg: StatsWorkerResponse) => void;
  onmessage: ((ev: MessageEvent<StatsWorkerRequest>) => void) | null;
};

const post = (msg: StatsWorkerResponse): void => ctx.postMessage(msg);

const ERROR_STATS: WebModelStats = { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, hasError: true };

/** 读模型主文件字节（/web/<type>/<rest> → IDB file:<type>/<rest>） */
async function readModelBytes(path: string): Promise<Uint8Array | null> {
  const pm = parseWebPath(path);
  if (!pm) return null;
  try {
    const f = await idbGet<{ data: ArrayBuffer }>("files", `file:${pm.type}/${pm.rest}`);
    if (!f?.data) return null;
    return new Uint8Array(f.data);
  } catch {
    return null;
  }
}

/** 相对路径读取器（ysm.json spec 的关联 model/tex 文件，相对主文件所在目录） */
function readRelFor(mainPath: string): StatsRelReader {
  return async (rel: string): Promise<Uint8Array | null> => {
    const pm = parseWebPath(mainPath);
    if (!pm) return null;
    const slash = pm.rest.lastIndexOf("/");
    const dir = slash >= 0 ? pm.rest.slice(0, slash + 1) : "";
    return readModelBytes(`/web/${pm.type}/${dir}${rel}`);
  };
}

/** 单模型统计：.ysm → WASM 解码产物；.json → 直读解析（解压目录入口，ADR-038） */
async function statsOne(path: string): Promise<WebModelStats> {
  const bytes = await readModelBytes(path);
  if (!bytes || !bytes.length) return ERROR_STATS;
  try {
    if (/\.json$/i.test(path)) {
      return statsFromJsonBytes(bytes, readRelFor(path));
    }
    // .ysm：内存直解 → 失败剥文本头部重试（V2 自动 / 强制 V3）→ callMain + MEMFS 兜底
    let files = await decodeYsmInWorker(bytes);
    if (!files?.length) {
      for (const tryVer of [null, 3]) {
        const rebuilt = stripYsgpTextHeader(bytes, tryVer ?? undefined);
        if (rebuilt === bytes || !rebuilt) continue;
        files = await decodeYsmInWorker(rebuilt);
        if (files?.length) break;
      }
    }
    if (!files?.length) {
      files = await decodeYsmInWorkerMemfs(bytes);
    }
    if (!files?.length) return ERROR_STATS;
    return statsFromDecodedFiles(files);
  } catch {
    // 单模型解码异常不拖垮整批：该模型标记 hasError（数值条件过滤时被排除）
    return ERROR_STATS;
  }
}

self.onmessage = async (ev: MessageEvent<StatsWorkerRequest>): Promise<void> => {
  const msg = ev.data as StatsWorkerRequest;
  if (!msg || msg.type !== "stats") return;
  const { requestId, paths } = msg;
  // 防御性校验：协议要求 paths 为 string[]，但 postMessage 可接收任意结构化数据
  // 非数组时 for...of 会抛 TypeError → 被外层 catch 捕获为误导性 "error" 响应
  if (!Array.isArray(paths)) {
    post({ type: "error", requestId, message: "paths 不是数组" });
    return;
  }
  const total = paths.length;
  try {
    // ADR-079 M4：跨源隔离（SharedArrayBuffer 可用）→ pthread 多线程 WASM（WASM 线程池
    // 并行处理本批多模型）；否则单线程 WASM。crossOriginIsolated 在 worker 全局可读。
    // 注意：mt 初始化依赖 COI（coi-sw.ts 网页版 SW 补头 / 桌面 mpr middleware）。
    const mt = typeof crossOriginIsolated === "boolean" && crossOriginIsolated;
    // 预加载 WASM：失败 → 整批 error（主线程据此整体降级，避免每个模型空转浪费）
    // P2（审核修复）：mt init 失败（pthread worker spawn 失败、SAB 被策略回收等瞬态
    // 问题）不直接整批 error——回退单线程 WASM 重试一次，仍失败才交给主线程整体降级，
    // 避免 COI 满足但 pthread 环境异常的设备永久失去数值统计
    let ok: boolean;
    try {
      ok = mt
        ? await initYsmParserInWorkerMt()
        : await initYsmParserInWorker();
    } catch (mtErr) {
      if (!mt) throw mtErr;
      ok = await initYsmParserInWorker();
    }
    if (!ok) {
      post({ type: "error", requestId, message: "YSMParser WASM 初始化失败" });
      return;
    }
    const results: Array<WebModelStatsWithPath> = [];
    let done = 0;
    for (const p of paths) {
      results.push({ path: p, ...(await statsOne(p)) });
      done++;
      // 进度节流：每 10 个或最后一个上报一次（避免消息洪泛）
      if (done % 10 === 0 || done === total) {
        post({ type: "progress", requestId, done, total });
      }
    }
    post({ type: "result", requestId, results });
  } catch (e) {
    post({
      type: "error",
      requestId,
      message: safeErrorMessage(e),
    });
  }
};
