// ===== YSMParser WASM — Web Worker 侧独立加载器 =====
// 与主线程 ysm-parser.ts 同构，但绝不共用其单例（约束：Worker 内 WASM 加载必须独立）。
// 差异点：
//  1. 主线程用 window.Module 注入点；Worker 无 window → 用 globalThis/self。
//  2. 胶水代码 worker 安全：window 仅出现于 `globalThis.window?.prompt`（可选链，
//     Worker 下 globalThis.window 为 undefined 直接跳过）；_scriptName 走
//     `globalThis.document?.currentScript?.src`（同样可选链安全）。
//  3. 数据文件用静态 import（随 Worker chunk 一起打包，Worker 内不支持动态 import()——
//     vite 打包 Worker 为 IIFE，无法 code-splitting）。mt 数据虽捆进 chunk，但 Worker chunk
//     本身是懒加载的（首次数值搜索才下载），且 SW 缓存后二次访问命中缓存。
// 仅被 src/workers/stats.worker.ts 引用（Worker 内），主线程路径不受影响。
// 解码链与 ysm-parser.ts 保持同口径：内存直解 → 失败时由调用方剥文本头部重试 → callMain。
// 无状态公共部分（FS/Module 类型、错误分类、MEMFS 辅助）已收敛至 parser-shared.ts。
import { _getWasmBinary } from "./ysm-wasm-data.js";
import { _getGlueCode } from "./ysm-glue-data.js";
// ADR-079 M3：pthread 多线程版（静态 import 随 Worker chunk 打包，懒加载不额外增加下载次数）
import { _getWasmBinaryMt } from "./ysm-wasm-data-mt.js";
import { _getGlueCodeMt } from "./ysm-glue-data-mt.js";
import {
  classifyWasmError,
  collectOutputFiles,
  ensureDir,
  patchGlueHeapExport,
  resolveWasmFactory,
  wipeDir,
  writeHeapBytes,
  type WasmModuleLike,
  type YsmDecodedFile,
} from "./parser-shared.ts";

/** Worker 全局注入点（Emscripten 胶水代码消费；worker 无 window，用 globalThis） */
interface WorkerModuleConfig {
  wasmBinary: ArrayBuffer;
  print: () => void;
  printErr: () => void;
  noInitialRun: boolean;
  HEAPU8?: Uint8Array;
  /** ADR-079 M4：pthread 版需要——pthread worker 池从该 URL 重新加载主胶水 */
  mainScriptUrlOrBlob?: string;
}

let wasmModule: WasmModuleLike | null = null;
let loading = false;
let waiters: Array<(ok: boolean) => void> = [];

/**
 * Worker 内独立初始化 WASM（懒加载单例，生命周期等同 Worker 本身）。
 * 与主线程 initYSMParser 同构：注入 wasmBinary → patch 胶水导出 HEAPU8 →
 * 间接 eval（仅执行 auto-generated 内嵌胶水代码，可信链，ADR-039 §2.1）→ 调工厂。
 * 失败抛错；成功后 wasmModule 常驻，后续任务复用（Worker 常驻，无需重复加载）。
 */
export async function initYsmParserInWorker(): Promise<boolean> {
  return initParserInWorker(_getWasmBinary() as ArrayBuffer | null, _getGlueCode() as string | null);
}

/**
 * ADR-079 M3/M4：pthread 多线程版初始化（需 crossOriginIsolated=true——SharedArrayBuffer
 * 前提，见 backend/coi-sw.ts）。差异点：
 *  1. 用 mt 数据文件（pthread 编译产物，Atomics/SharedArrayBuffer/PThread）
 *  2. 注入 mainScriptUrlOrBlob（Blob URL）：Emscripten pthread worker 池从该 URL
 *     重新加载主胶水（new Worker(mainScriptUrlOrBlob)，worker 内 ENVIRONMENT_IS_PTHREAD
 *     分支等消息）——与单线程 base64+eval 注入架构的桥接（ADR-079 §4 补注）。
 *  Blob URL 不能 revoke（pthread worker 生命周期内持续使用）。
 */
export async function initYsmParserInWorkerMt(): Promise<boolean> {
  const glue = _getGlueCodeMt() as string | null;
  if (!glue) throw new Error("mt 胶水代码空");
  const blobUrl = URL.createObjectURL(new Blob([glue], { type: "application/javascript" }));
  return initParserInWorker(_getWasmBinaryMt() as ArrayBuffer | null, glue, {
    mainScriptUrlOrBlob: blobUrl,
  });
}

async function initParserInWorker(
  wasmBinary: ArrayBuffer | null,
  glueCode: string | null,
  extra?: { mainScriptUrlOrBlob?: string },
): Promise<boolean> {
  if (wasmModule) return true;
  if (loading) return new Promise<boolean>((r) => waiters.push(r));
  loading = true;

  const g = globalThis as Record<string, unknown>;
  try {
    // 1. 从内嵌 JS 拿 .wasm 二进制 + 胶水代码（数据文件为自动生成的 base64 常量）
    if (!wasmBinary || !wasmBinary.byteLength) throw new Error("wasmBinary 空");
    if (!glueCode) throw new Error("胶水代码空");

    // 2. 修改胶水代码：在所有 updateMemoryViews 调用后导出 HEAPU8 到 Module
    const patchedGlue = patchGlueHeapExport(glueCode);

    // 3. 设置 Module.wasmBinary（worker 全局，替代主线程的 window.Module）；
    //    ADR-079 M4：pthread 变体额外注入 mainScriptUrlOrBlob（Blob URL）
    const moduleCfg: WorkerModuleConfig = {
      wasmBinary,
      print: () => {},
      printErr: () => {},
      noInitialRun: true,
    };
    if (extra?.mainScriptUrlOrBlob) moduleCfg.mainScriptUrlOrBlob = extra.mainScriptUrlOrBlob;
    g.Module = moduleCfg;

    // 4. 间接 eval 执行胶水代码（worker 全局作用域，var YSMParserModule → g.YSMParserModule）
    (0, eval)(patchedGlue);

    // 5. 调用工厂（胶水为 MODULARIZE 产物：async factory(moduleArg)）
    const factory = g.YSMParserModule as ((module: unknown) => unknown | Promise<unknown>) | undefined;
    if (!factory) throw new Error("YSMParserModule 未定义");
    wasmModule = await resolveWasmFactory(factory, moduleCfg);
    loading = false; // 成功后复位，避免 wasmModule 被置空后 loading 恒真 → 永久挂起
    waiters.forEach((r) => r(true));
    waiters = [];
    return true;
  } catch (e) {
    waiters.forEach((r) => r(false));
    waiters = [];
    loading = false;
    // init 失败清理注入点，避免残留 wasmBinary 配置影响后续重试
    delete g.Module;
    delete g.YSMParserModule;
    throw e;
  }
}

/** 硬崩溃（内存越界/栈溢出等不可捕获 trap）后重置单例，下次调用可重新 init */
function resetYsmParserInWorker(): void {
  wasmModule = null;
  loading = false;
  const g = globalThis as Record<string, unknown>;
  delete g.Module;
}

// classifyWasmError 见 parser-shared.ts（口径差异保留在下方 catch 块）

/** 安全获取最新 WASM HEAPU8（patch 注入到 Module，内存扩容后自动更新） */
function getHeap(): Uint8Array {
  const g = globalThis as { Module?: WorkerModuleConfig };
  const h = g.Module?.HEAPU8;
  if (h) return h;
  if (wasmModule?.HEAPU8) return wasmModule.HEAPU8;
  throw new Error("无法获取 WASM HEAPU8");
}

/** 将 JS 数据写入 WASM 内存，返回指针（写入算法见 parser-shared.writeHeapBytes） */
function writeHeap(data: Uint8Array): number {
  return writeHeapBytes(data, (len) => wasmModule!._malloc(len), getHeap);
}

// FS 辅助（wipeDir/ensureDir/collectOutputFiles）见 parser-shared.ts（单一事实源）

/**
 * 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组），返回 [{path, data}]。
 * 失败返回 null（不抛错），由调用方决定是否走剥离文本头部重试 / callMain。
 */
export async function decodeYsmInWorker(bytes: Uint8Array): Promise<YsmDecodedFile[] | null> {
  if (!wasmModule) {
    const ok = await initYsmParserInWorker();
    if (!ok) throw new Error("YSMParser WASM 未就绪");
  }
  const FS = wasmModule!.FS;
  const ccall = wasmModule!.ccall;
  if (!ccall) throw new Error("ccall 不可用，请重新编译 WASM");

  let ptr = 0;
  try {
    wipeDir(FS, "/output");
    ensureDir(FS, "/output");
    ptr = writeHeap(bytes);
    const len = bytes.byteLength || bytes.length;
    const success = ccall(
      "ysm_decode_from_memory",
      "number",
      ["number", "number", "string"],
      [ptr, len, "/output"],
    );
    if (!success) return null;
    return collectOutputFiles(FS, "/output");
  } catch (err) {
    // 硬崩溃恢复：_malloc/FS 操作同样可能触发 trap → 重置单例，否则 wasmModule 恒非空 → 永久失败
    const cls = classifyWasmError(err);
    if (cls.kind === "fatal" || cls.kind === "exit") {
      resetYsmParserInWorker();
    }
    throw err;
  } finally {
    if (ptr) wasmModule?._free(ptr);
  }
}

/**
 * callMain + MEMFS 解码 .ysm（回退路径，兼容旧 WASM 编译 / V3 文本头部等格式）。
 * 失败返回空数组（不抛错）。
 */
export async function decodeYsmInWorkerMemfs(bytes: Uint8Array): Promise<YsmDecodedFile[]> {
  if (!wasmModule) {
    const ok = await initYsmParserInWorker();
    if (!ok) throw new Error("YSMParser WASM 未就绪");
  }
  const FS = wasmModule!.FS;
  if (!FS) throw new Error("YSMParser FS 不可用");

  try {
    wipeDir(FS, "/input");
    wipeDir(FS, "/output");
    ensureDir(FS, "/input");
    ensureDir(FS, "/output");
    FS.writeFile("/input/model.ysm", bytes);
    const hasCallMain = typeof wasmModule!.callMain === "function";
    if (hasCallMain) {
      wasmModule!.callMain!(["-i", "/input", "-o", "/output"]);
    }
  } catch (err) {
    const cls = classifyWasmError(err);
    if (cls.kind === "exit") {
      if (cls.exitCode !== undefined && cls.exitCode !== 0) {
        return [];
      }
    } else {
      if (cls.kind === "fatal") {
        resetYsmParserInWorker();
      }
      throw err;
    }
  }
  const files = collectOutputFiles(FS, "/output");
  wipeDir(FS, "/output");
  wipeDir(FS, "/input");
  return files;
}
