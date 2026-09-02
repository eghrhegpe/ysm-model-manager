// ===== YSMParser WASM 封装 =====
// 用 Module.wasmBinary 注入方式加载，规避 WebView2 fetch() 限制
// 优先使用内存解析（ysm_decode_from_memory），回退 callMain + MEMFS
// 无状态公共部分（FS/Module 类型、错误分类、MEMFS 辅助）已收敛至 parser-shared.ts

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

export type { YsmDecodedFile };

declare global {
  interface Window {
    /** Emscripten 模块注入点（initYSMParser 设置，胶水代码消费） */
    Module?: {
      wasmBinary: ArrayBuffer;
      print: () => void;
      printErr: () => void;
      noInitialRun: boolean;
      HEAPU8?: Uint8Array;
    };
  }
}

// FSLike / WasmModuleLike / YsmDecodedFile 类型见 parser-shared.ts（单一事实源）

let wasmModule: WasmModuleLike | null = null;
let loading = false;
let waiters: Array<(ok: boolean) => void> = [];

// 注：WASM 为 app 级常驻单例（initYSMParser 懒加载后生命周期等同应用），
// 无销毁场景——曾提供 destroyYSMParser() 但 _free(0) 无法真正释放 HEAP，
// 且销毁后重新 init 有加载成本，已移除（knip 死代码基线）

// 硬崩溃（内存越界/栈溢出等不可捕获 trap）后重置单例，下次调用可重新 init。
// 仅包内使用（decodeYsmFileFromMemory/decodeYsmFile 的崩溃恢复分支），不导出
//（无外部消费方，deadcode 门禁）
function resetYSMParser(): void {
  wasmModule = null;
  loading = false;
  const w = window as unknown as Record<string, unknown>;
  delete w.Module;
  // 清工厂引用：re-init 时 eval 重新定义 YSMParserModule，
  // 但若胶水代码将来加 `if (typeof YSMParserModule !== 'undefined') return`，
  // 残留工厂会导致 re-init 静默失败。与 ysm-worker-loader.ts:181 口径对齐。
  delete w.YSMParserModule;
}

// classifyWasmError 见 parser-shared.ts（口径差异保留在下方两个 catch 块）

export async function initYSMParser(): Promise<boolean> {
  if (wasmModule) return true;
  if (loading) return new Promise<boolean>((r) => waiters.push(r));
  loading = true;

  try {
    // 1. 从内嵌 JS 拿 .wasm 二进制 + 胶水代码
    // ⚠️ ysm-wasm-data.js / ysm-glue-data.js 为自动生成的 base64 数据文件（保持 .js）
    // P2 修复（审计）：此前注释声称 ysm-glue-data.js 的 _getGlueCode 引用未声明的
    // _cachedWasm（ReferenceError）且返回 ArrayBuffer——已核实数据文件现用 _cachedGlue
    // 且返回 TextDecoder string，bug 已不存在，WASM 路径不再必然回退 Go。
    // 若未来生成脚本变动导致 glue 结构变化，先核对 _getGlueCode 返回值形态再改本段。
    const { _getWasmBinary } = await import("./ysm-wasm-data.js");
    const { _getGlueCode } = await import("./ysm-glue-data.js");
    const wasmBinary = _getWasmBinary() as ArrayBuffer | null;
    const glueCode = _getGlueCode() as string | null;
    if (!wasmBinary || !wasmBinary.byteLength) throw new Error("wasmBinary 空");
    if (!glueCode) throw new Error("胶水代码空");

    // 2. 修改胶水代码：在所有 updateMemoryViews 调用后导出 HEAPU8 到 Module
    const patchedGlue = patchGlueHeapExport(glueCode);

    // 3. 设置 Module.wasmBinary — 胶水代码执行时直接用，关掉 WASM 的 stdout
    window.Module = {
      wasmBinary,
      print: () => {},
      printErr: () => {},
      noInitialRun: true,
    };

    // 4. 间接 eval 执行胶水代码（代替 <script> 注入，快 ~5x）
    //    ⚠️ ADR-039 §2.1 安全边界：eval 仅执行 auto-generated 内嵌胶水代码（可信链），
    //    无外部输入。WebView2/Wails v3 当前无 CSP 配置 API，若未来需 CSP 白名单，
    //    改用 <script> 注入或 Web Worker 沙箱承载（需回归 ADR-029 解码优先级链）。
    (0, eval)(patchedGlue);

    // 5. 调用工厂
    const factory = (window as unknown as { YSMParserModule?: unknown }).YSMParserModule;
    if (!factory) throw new Error("YSMParserModule 未定义");
    const factoryFn = factory as (module: unknown) => unknown | Promise<unknown>;
    wasmModule = await resolveWasmFactory(factoryFn, window.Module);
    loading = false; // 成功后复位，避免 wasmModule 被置空后 loading 恒真 → 永久挂起

    waiters.forEach((r) => r(true));
    waiters = [];
    return true;
  } catch (e) {
    waiters.forEach((r) => r(false));
    waiters = [];
    loading = false;
    // P3-10：init 失败时清理 Module 注入点，避免残留 wasmBinary 配置影响未来模块
    // @ts-expect-error 清理 Emscripten 全局注入点（MODULARIZE 挂载）
    delete (window as Record<string, unknown>).Module;
    throw e;
  }
}

/** 安全获取最新的 WASM HEAPU8（patch 注入到 Module 上，内存扩容后自动更新） */
function _getHeap(): Uint8Array {
  // 每次从 window.Module.HEAPU8 取最新的（内存扩容后 updateMemoryViews 会更新它）
  const h = (window.Module as { HEAPU8?: Uint8Array } | undefined)?.HEAPU8;
  if (h) return h;
  // 兜底：取 wasmModule 上的（老版本 Emscripten）
  if (wasmModule?.HEAPU8) return wasmModule.HEAPU8;
  throw new Error("无法获取 WASM HEAPU8");
}

/** 将 JS 数据写入 WASM 内存，返回指针（写入算法见 parser-shared.writeHeapBytes） */
function _writeHeap(data: Uint8Array): number {
  return writeHeapBytes(data, (len) => wasmModule!._malloc(len), _getHeap);
}

/**
 * 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组）
 * 返回 [{path, data}]，失败返回 null
 */
export async function decodeYsmFileFromMemory(
  bytes: Uint8Array,
): Promise<YsmDecodedFile[] | null> {
  if (!wasmModule) {
    const ok = await initYSMParser();
    if (!ok) throw new Error("YSMParser WASM 未就绪");
  }

  const FS = wasmModule!.FS;
  const ccall = wasmModule!.ccall;
  if (!ccall) throw new Error("ccall 不可用，请重新编译 WASM");

  let ptr = 0;
  try {
    // 准备输出目录
    wipeDir(FS, "/output");
    ensureDir(FS, "/output");

    // 使用辅助函数分配内存并写入数据
    ptr = _writeHeap(bytes);

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
    // P2 硬崩溃恢复：_malloc/FS 操作同样可能触发 trap，
    // 一并纳入 catch 确保重置单例（否则 wasmModule 恒非空 → 永久失败）
    const cls = classifyWasmError(err);
    if (cls.kind === "fatal" || cls.kind === "exit") {
      resetYSMParser();
    }
    throw err;
  } finally {
    // 崩溃恢复已置空 wasmModule —— 判空后再 _free，避免 null 掩盖原始错误
    if (ptr) wasmModule?._free(ptr);
  }
}

/**
 * 通过 callMain + MEMFS 解码 .ysm（回退路径）
 * 保留以兼容旧的 WASM 编译
 */
export async function decodeYsmFile(
  bytes: Uint8Array,
): Promise<YsmDecodedFile[]> {
  if (!wasmModule) {
    const ok = await initYSMParser();
    if (!ok) throw new Error("YSMParser WASM 未就绪");
  }
  const FS = wasmModule!.FS;
  if (!FS) throw new Error("YSMParser FS 不可用");

  try {
    // 这些 FS 操作同样可能触发 trap，纳入 catch 确保重置单例
    wipeDir(FS, "/input");
    wipeDir(FS, "/output");
    ensureDir(FS, "/input");
    ensureDir(FS, "/output");

    FS.writeFile("/input/model.ysm", bytes);

    const hasCallMain = typeof wasmModule!.callMain === "function";
    if (!hasCallMain) {
      console.warn("[YSM] WASM 无 callMain，MEMFS 路径不可用");
    }

    if (hasCallMain) {
      wasmModule!.callMain!(["-i", "/input", "-o", "/output"]);
    }
  } catch (err) {
    const cls = classifyWasmError(err);
    if (cls.kind === "exit") {
      if (cls.exitCode !== undefined && cls.exitCode !== 0) {
        throw new Error("YSMParser exit code " + cls.exitCode);
      }
    } else {
      // P2 硬崩溃恢复：abort/trap/out of memory 等不可捕获信号 → 重置单例
      if (cls.kind === "fatal") {
        resetYSMParser();
      }
      throw err;
    }
  }

  const files = collectOutputFiles(FS, "/output");
  // 读取后立即清理 MEMFS，避免 WASM HEAP 残留
  wipeDir(FS, "/output");
  wipeDir(FS, "/input");
  return files;
}

