// ===== stats.worker.ts — 后台批量模型统计 Worker =====
// SearchModels 数值条件的统计来源（ADR-071 审计增强 #6 + 用户「多线程注入」要求）：
//  1. Worker 内 open IndexedDB（同源）读文件字节 —— 免主线程 base64 大字符串传输
//  2. Worker 内独立加载 YSMParser WASM（ysm-worker-loader.ts，不复用主线程 wasmModule 单例）
//  3. 逐个模型解码 → 统计骨骼/立方体/纹理尺寸 → 逐模型 postMessage 流式回包（partial，
//     按 path 对齐 + 主线程静默看门狗侦测信号，ADR-219 D1）→ 循环走完发 result 结束标记
// 主线程编排（批量切分/看门狗/取消/细粒度降级/批级单飞 ADR-218 + ADR-219）见
// backend/web-stats.ts；协议见 stats-protocol.ts。
// 容量/取消：单批上限由主线程 STATS_BATCH_LIMIT 切分；主线程可 terminate 本 Worker 取消。
import { idbGet } from "@/utils/storage/idb.ts";
import { parseWebPath } from "@/utils/base/pure/web-path.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { dbg } from "@/utils/debug/debug.ts";
import {
  initYsmParserInWorker,
  initYsmParserInWorkerMt,
  decodeYsmInWorker,
  decodeYsmInWorkerMemfs,
} from "@/wasm/ysm-worker-loader.ts";
import { stripYsgpTextHeader } from "@/preview-3d/decoder/utils.ts";
import {
  EMPTY_ERROR,
  statsFromDecodedFiles,
  statsFromJsonBytes,
  type StatsRelReader,
} from "./stats-core.ts";
import {
  isCrossOriginIsolated,
  type StatsWorkerRequest,
  type StatsWorkerResponse,
  type WebModelStats,
} from "./stats-protocol.ts";

/** Worker 全局（module worker 下为 DedicatedWorkerGlobalScope；显式声明避免依赖 lib） */
const ctx = self as unknown as {
  postMessage: (msg: StatsWorkerResponse) => void;
  onmessage: ((ev: MessageEvent<StatsWorkerRequest>) => void) | null;
};

const post = (msg: StatsWorkerResponse): void => ctx.postMessage(msg);

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
  if (!bytes || !bytes.length) return EMPTY_ERROR;
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
    if (!files?.length) return EMPTY_ERROR;
    return statsFromDecodedFiles(files);
  } catch (e) {
    // 单模型解码异常不拖垮整批：该模型标记 hasError（数值条件过滤时被排除）。
    // 留痕便于排障（区别于「模型本身无骨骼」的正常 hasError——此处分级为「解码异常」）
    dbg("stats-worker", `模型统计解码异常: ${path}`, safeErrorMessage(e));
    return EMPTY_ERROR;
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
  try {
    // ADR-079 M4：跨源隔离（SharedArrayBuffer 可用）→ pthread 多线程 WASM（WASM 线程池
    // 并行处理本批多模型）；否则单线程 WASM。判定收敛至 stats-protocol.ts 单一事实源
    // （coi-sw.ts 与主线程共用，防两处内联探测漂移）。
    const mt = isCrossOriginIsolated();
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
    for (const p of paths) {
      // ADR-219 D1：逐模型流式回包（主线程按 path 累积 + 静默看门狗侦测信号；
      // 挂死模型会中断 partial 流——这正是主线程区分「挂死」与「正常慢」的依据）
      post({ type: "partial", requestId, result: { path: p, ...(await statsOne(p)) } });
    }
    // 流结束标记（逐模型结果已经 partial 送达；主线程收到后收尾该 chunk，
    // 缺条目按 EMPTY_ERROR 细粒度补位，不再整批降级，ADR-219 D1/D3）。
    // doneCount = 本批已处理模型数（= paths.length，逐模型必回包）——主线程对账信号
    post({ type: "result", requestId, doneCount: paths.length });
  } catch (e) {
    post({
      type: "error",
      requestId,
      message: safeErrorMessage(e),
    });
  }
};
