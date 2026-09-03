// ===== YSMParser WASM — Web Worker 侧独立加载器 =====
// 与主线程 ysm-parser.ts 同构，但绝不共用其单例（约束：Worker 内 WASM 加载必须独立）。
// 差异点：
//  1. 主线程用 window.Module 注入点；Worker 无 window → 用 globalThis/self。
//  2. 胶水代码 worker 安全：window 仅出现于 `globalThis.window?.prompt`（可选链，
//     Worker 下 globalThis.window 为 undefined 直接跳过）；_scriptName 走
//     `globalThis.document?.currentScript?.src`（同样可选链安全）。
//  3. base / mt 两组数据均用动态 import（ADR-153）：二者互斥，按 crossOriginIsolated
//     二选一加载——COI 环境只需 mt，非 COI 只需 base，任一环境都不再携带 ~1.5 MB 死重。
//     base 不可移除：崩溃恢复路径（resetYsmParserInWorker）在 COI 环境下仍走单线程。
//     与主线程 ysm-parser.ts:67-68 的动态 import 口径对齐。
// 仅被 src/workers/stats.worker.ts 引用（Worker 内），主线程路径不受影响。
// 解码链与 ysm-parser.ts 保持同口径：内存直解 → 失败时由调用方剥文本头部重试 → callMain。
// 无状态公共部分（FS/Module 类型、错误分类、MEMFS 辅助）已收敛至 parser-shared.ts。
import {
  classifyWasmError,
  collectOutputFiles,
  createLazyModule,
  ensureDir,
  installYsmModule,
  wipeDir,
  writeHeapBytes,
  type WasmModuleLike,
  type YsmDecodedFile,
  type YsmModuleConfig,
} from "./parser-shared.ts";

// WASM 为 Worker 级常驻单例：initYsmParserInWorker / initYsmParserInWorkerMt 共享同一懒加载
// 状态机（收敛至 parser-shared.createLazyModule），资产来源（base/mt）由各自 init 注入。
const mod = createLazyModule<WasmModuleLike>();
// ADR-153 asset-load promise 缓存：并发首次 init / 崩溃重置后 re-init 去重，
// 避免 N 个并发 caller 各自 import() + _getWasmBinary()（~1.5 MB ArrayBuffer 分配/次）。
let baseAssetsPromise: Promise<ParserAssets> | null = null;
let mtAssetsPromise: Promise<ParserAssets> | null = null;

/**
 * Worker 内独立初始化 WASM（懒加载单例，生命周期等同 Worker 本身）。
 * 与主线程 initYSMParser 同构：注入 wasmBinary → patch 胶水导出 HEAPU8 →
 * 间接 eval（仅执行 auto-generated 内嵌胶水代码，可信链，ADR-039 §2.1）→ 调工厂。
 * 失败抛错；成功后 wasmModule 常驻，后续任务复用（Worker 常驻，无需重复加载）。
 */
export async function initYsmParserInWorker(): Promise<boolean> {
  const { wasm, glue } = await loadBaseAssets();
  return initParserInWorker(wasm, glue);
}

/** ADR-153：WASM 资产组（base / mt 同构，均由动态 import 按需产出） */
interface ParserAssets {
  wasm: ArrayBuffer | null;
  glue: string | null;
}

/**
 * ADR-153：懒加载 base 数据模块（运行时动态 import）。
 * 不可移除——COI 环境下 mt 是主路径，但 WASM 硬崩溃重置单例后
 * （resetYsmParserInWorker，见 decodeYsmInWorker 的 fatal/exit 分支）
 * 恢复路径仍走单线程 init，故 base 必须保留为可按需加载项。
 */
async function loadBaseAssets(): Promise<ParserAssets> {
  if (!baseAssetsPromise) {
    baseAssetsPromise = (async () => {
      const [wasmMod, glueMod] = await Promise.all([
        import("./ysm-wasm-data.js"),
        import("./ysm-glue-data.js"),
      ]);
      return {
        wasm: (wasmMod._getWasmBinary() as ArrayBuffer | null) ?? null,
        glue: (glueMod._getGlueCode() as string | null) ?? null,
      };
    })();
    // 失败时清缓存，避免 rejected promise 永久驻留致 worker 不可恢复
    baseAssetsPromise!.catch(() => { baseAssetsPromise = null; });
  }
  return baseAssetsPromise;
}

/**
 * ADR-153：懒加载 mt 数据模块（运行时动态 import，节省非 COOP-COEP 环境 ~1.5 MB）。
 * 仅在 initYsmParserInWorkerMt 被调用时执行，后续调用复用缓存模块。
 */
async function loadMtAssets(): Promise<ParserAssets> {
  if (!mtAssetsPromise) {
    mtAssetsPromise = (async () => {
      const [wasmMod, glueMod] = await Promise.all([
        import("./ysm-wasm-data-mt.js"),
        import("./ysm-glue-data-mt.js"),
      ]);
      return {
        wasm: (wasmMod._getWasmBinaryMt() as ArrayBuffer | null) ?? null,
        glue: (glueMod._getGlueCodeMt() as string | null) ?? null,
      };
    })();
    // 失败时清缓存，避免 rejected promise 永久驻留致 worker 不可恢复
    mtAssetsPromise!.catch(() => { mtAssetsPromise = null; });
  }
  return mtAssetsPromise;
}

/**
 * ADR-079 M3/M4 + ADR-153：pthread 多线程版初始化（需 crossOriginIsolated=true——SharedArrayBuffer
 * 前提，见 backend/coi-sw.ts）。差异点：
 *  1. 用 mt 数据文件（pthread 编译产物，Atomics/SharedArrayBuffer/PThread）
 *  2. 注入 mainScriptUrlOrBlob（Blob URL）：Emscripten pthread worker 池从该 URL
 *     重新加载主胶水（new Worker(mainScriptUrlOrBlob)，worker 内 ENVIRONMENT_IS_PTHREAD
 *     分支等消息）——与单线程 base64+eval 注入架构的桥接（ADR-079 §4 补注）。
 *  3. mt 数据懒加载（ADR-153）：动态 import，非 COOP-COEP 环境不下载。
 *  Blob URL 不能 revoke（pthread worker 生命周期内持续使用）。
 */
export async function initYsmParserInWorkerMt(): Promise<boolean> {
  const { wasm, glue } = await loadMtAssets();
  if (!glue) throw new Error("mt 胶水代码空");
  const blobUrl = URL.createObjectURL(new Blob([glue], { type: "application/javascript" }));
  // init 失败时 pthread worker 未创建（或已随失败终止），Blob URL 不再被引用；
  // 成功路径按上方注释保留不 revoke（pthread worker 生命周期内持续使用）
  try {
    return await initParserInWorker(wasm, glue, {
      mainScriptUrlOrBlob: blobUrl,
    });
  } catch (e) {
    URL.revokeObjectURL(blobUrl);
    throw e;
  }
}

async function initParserInWorker(
  wasmBinary: ArrayBuffer | null,
  glueCode: string | null,
  extra?: { mainScriptUrlOrBlob?: string },
): Promise<boolean> {
  return mod.ensureInit(async () => {
    // 1. 资产校验（数据文件为自动生成的 base64 常量）
    if (!wasmBinary || !wasmBinary.byteLength) throw new Error("wasmBinary 空");
    if (!glueCode) throw new Error("胶水代码空");

    // 2/3/4/5 组装注入点 + 间接 eval + MODULARIZE 工厂，收敛于 installYsmModule
    //    （ADR-079 M4：pthread 变体额外注入 mainScriptUrlOrBlob Blob URL；ADR-039 §2.1）
    const moduleCfg: YsmModuleConfig = {
      wasmBinary,
      print: () => {},
      printErr: () => {},
      noInitialRun: true,
    };
    if (extra?.mainScriptUrlOrBlob) moduleCfg.mainScriptUrlOrBlob = extra.mainScriptUrlOrBlob;

    const g = globalThis as Record<string, unknown>;
    try {
      return await installYsmModule(g, glueCode, moduleCfg);
    } catch (e) {
      // init 失败清理注入点，避免残留 wasmBinary 配置影响后续重试
      delete g.Module;
      delete g.YSMParserModule;
      throw e;
    }
  });
}

/** 硬崩溃（内存越界/栈溢出等不可捕获 trap）后重置单例，下次调用可重新 init */
function resetYsmParserInWorker(): void {
  mod.reset();
  // 崩溃恢复路径强制重新取资产（base/mt 任一）——缓存清空，与初始 init 口径一致
  baseAssetsPromise = null;
  mtAssetsPromise = null;
  const g = globalThis as Record<string, unknown>;
  delete g.Module;
  delete g.YSMParserModule; // 与 init 失败路径一致，清工厂引用防 re-init 静默失败
}

// classifyWasmError 见 parser-shared.ts（口径差异保留在下方 catch 块）

/** 安全获取最新 WASM HEAPU8（patch 注入到 Module，内存扩容后自动更新） */
function getHeap(): Uint8Array {
  const g = globalThis as { Module?: YsmModuleConfig };
  const h = g.Module?.HEAPU8;
  if (h) return h;
  const m = mod.get();
  if (m?.HEAPU8) return m.HEAPU8;
  throw new Error("无法获取 WASM HEAPU8");
}

/** 将 JS 数据写入 WASM 内存，返回指针（写入算法见 parser-shared.writeHeapBytes） */
function writeHeap(data: Uint8Array): number {
  return writeHeapBytes(data, (len) => mod.get()!._malloc(len), getHeap);
}

// FS 辅助（wipeDir/ensureDir/collectOutputFiles）见 parser-shared.ts（单一事实源）

/**
 * 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组），返回 [{path, data}]。
 * 失败返回 null（不抛错），由调用方决定是否走剥离文本头部重试 / callMain。
 */
export async function decodeYsmInWorker(bytes: Uint8Array): Promise<YsmDecodedFile[] | null> {
  if (!mod.isInited()) {
    // init 失败以 throw 表达（不返回 false），异常自然向上抛由调用方处理
    await initYsmParserInWorker();
  }
  const m = mod.get()!;
  const FS = m.FS;
  const ccall = m.ccall;
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
    if (ptr) mod.get()?._free(ptr);
  }
}

/**
 * callMain + MEMFS 解码 .ysm（回退路径，兼容旧 WASM 编译 / V3 文本头部等格式）。
 * 失败返回空数组（不抛错）。
 */
export async function decodeYsmInWorkerMemfs(bytes: Uint8Array): Promise<YsmDecodedFile[]> {
  if (!mod.isInited()) {
    // init 失败以 throw 表达（不返回 false），异常自然向上抛由调用方处理
    await initYsmParserInWorker();
  }
  const m = mod.get()!;
  const FS = m.FS;
  if (!FS) throw new Error("YSMParser FS 不可用");

  try {
    wipeDir(FS, "/input");
    wipeDir(FS, "/output");
    ensureDir(FS, "/input");
    ensureDir(FS, "/output");
    FS.writeFile("/input/model.ysm", bytes);
    const hasCallMain = typeof m.callMain === "function";
    if (hasCallMain) {
      m.callMain!(["-i", "/input", "-o", "/output"]);
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
