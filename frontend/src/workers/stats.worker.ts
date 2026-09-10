// ===== stats.worker.ts — 后台批量模型统计 Worker =====
// SearchModels 数值条件的统计来源（ADR-071 审计增强 #6 + 用户「多线程注入」要求）：
//  1. Worker 内 open IndexedDB（同源）读文件字节 —— 免主线程 base64 大字符串传输
//  2. Worker 内独立加载 YSMParser WASM（ysm-worker-loader.ts，不复用主线程 wasmModule 单例）
//  3. 泵式有界并发（STATS_CONCURRENCY）逐模型解码 → 统计骨骼/立方体/纹理尺寸 →
//     逐模型 postMessage 流式回包（partial，按 path 对齐 + 主线程静默看门狗侦测信号，
//     ADR-219 D1；I/O 与同步 WASM 解码重叠，峰值内存与批大小无关）→ 全批走完发 result 结束标记
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
  isValidStatsRequest,
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
    // 相对路径归一化：ysm.json spec 可能声明 Windows 风格路径分隔符（反斜杠），统一转正斜杠
    // 后再拼接，避免经 parseWebPath 切出的 IDB key 与 stats-core 侧补前缀后的正斜杠声明错位。
    const relNorm = rel.replace(/\\/g, "/");
    return readModelBytes(`/web/${pm.type}/${dir}${relNorm}`);
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

/** 泵式并发数：I/O（idbGet）与同步 WASM 解码重叠——模型 N+1 的字节读取在模型 N 解码期间完成。
 *  峰值内存 = 在途 ≤ 此数的模型字节 + 解码产物，与批大小无关；更大 N 收益递减
 *  （同步 WASM 关键区在单 JS 线程天然串行），4 为保守默认。 */
const STATS_CONCURRENCY = 4;

self.onmessage = async (ev: MessageEvent<StatsWorkerRequest>): Promise<void> => {
  // 协议结构守卫（stats-protocol.isValidStatsRequest，类型谓词窄化 ev.data）：
  // postMessage 可接收任意结构化数据——requestId 非数字 / paths 非 string[] 等畸形消息
  // 一律 error 拒收，防类型漂移进入 partial 累积 / 看门狗计数（主线程按 requestId 对账）。
  // requestId=-1 哨兵：主线程 onmessage 的 `data.requestId !== 在途值` 过滤会丢弃本消息，
  // chunk 经静默窗自愈（web-stats.ts）——生产路径主线程 postMessage 恒良构，此分支仅
  // 异常通道 / 手工探测可触达，无数据丢失（重试重放本批 paths，统计幂等）。
  if (!isValidStatsRequest(ev.data)) {
    post({ type: "error", requestId: -1, message: "非法请求（isValidStatsRequest）" });
    return;
  }
  const { requestId, paths } = ev.data;
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
    // 泵式有界并发（STATS_CONCURRENCY）：多泵按 nextIdx 领号，各自 while 领到批尾。
    // 重叠收益：模型 N+1 的 idbGet I/O 在模型 N 的同步 WASM 解码期间完成。
    // 安全论证：decodeYsmInWorker 的同步关键区（wipeDir→ccall→collectOutputFiles，
    // 全程无 await）在单 JS 线程天然串行，共享 /output 目录不交叉污染；
    // 峰值内存 = 在途 ≤ STATS_CONCURRENCY 的模型字节 + 解码产物（stats-protocol 批上限
    // 注释的内存口径）。
    // 逐模型 .then 回 partial（ADR-219 D1 活性信号）：每完成一模型即回包——挂死模型
    // 中断 partial 流，主线程静默看门狗侦测语义不变；回包序不承担契约（ADR-218 D2，
    // 主线程按 path 累积）。
    // 注意禁用裸 Promise.all(paths)：全批原始字节同时驻留内存，违反「峰值与批大小无关」。
    let nextIdx = 0;
    const pump = async (): Promise<void> => {
      while (nextIdx < paths.length) {
        const p = paths[nextIdx++];
        post({ type: "partial", requestId, result: { path: p, ...(await statsOne(p)) } });
      }
    };
    const settled = await Promise.allSettled(
      Array.from({ length: Math.min(STATS_CONCURRENCY, paths.length) }, pump),
    );
    // 防御深度（非主路径，当前实际不可达）：statsOne 对单模型异常全路径 try/catch 恒吞为
    // EMPTY_ERROR（stats.worker.ts 第 72-96 行）→ pump 正常恒 fulfilled，settled 内通常无 rejected。
    // 此分支仅兜底 postMessage 结构化克隆失败（DataCloneError，未来 WebModelStats 引入不可克隆
    // 字段时可达）；触发则整批 error，主线程 terminate 本 worker 并在专属 replacement 上重放剩余
    // 模型（ADR-219 D2，统计幂等无副作用）。原注释「WASM 硬崩溃 rethrow」与实现不符（statsOne
    // 不 rethrow），已纠正。
    const failure = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (failure) {
      post({ type: "error", requestId, message: safeErrorMessage(failure.reason) });
      return;
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
