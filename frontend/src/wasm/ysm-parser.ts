// ===== YSMParser WASM 封装 =====
// 用 Module.wasmBinary 注入方式加载，规避 WebView2 fetch() 限制
// 优先使用内存解析（ysm_decode_from_memory），回退 callMain + MEMFS
// 无状态公共部分（FS/Module 类型、错误分类、MEMFS 辅助）已收敛至 parser-shared.ts

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
// wasmModule/loading/waiters 懒加载单例状态机已收敛至 parser-shared.createLazyModule

// 注：WASM 为 app 级常驻单例（initYSMParser 懒加载后生命周期等同应用），
// 无销毁场景——曾提供 destroyYSMParser() 但 _free(0) 无法真正释放 HEAP，
// 且销毁后重新 init 有加载成本，已移除（knip 死代码基线）
const mod = createLazyModule<WasmModuleLike>();

// 硬崩溃（内存越界/栈溢出等不可捕获 trap）后重置单例，下次调用可重新 init。
// 仅包内使用（decodeYsmFileFromMemory/decodeYsmFile 的崩溃恢复分支），不导出
//（无外部消费方，deadcode 门禁）
function resetYSMParser(): void {
  mod.reset();
  const w = window as unknown as Record<string, unknown>;
  delete w.Module;
  // 清工厂引用：re-init 时 eval 重新定义 YSMParserModule，
  // 但若胶水代码将来加 `if (typeof YSMParserModule !== 'undefined') return`，
  // 残留工厂会导致 re-init 静默失败。与 ysm-worker-loader.ts 口径对齐。
  delete w.YSMParserModule;
}

// classifyWasmError 见 parser-shared.ts（口径差异保留在下方两个 catch 块）

export async function initYSMParser(): Promise<boolean> {
  return mod.ensureInit(async () => {
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

    // 注入 point：window.Module；间接 eval + MODULARIZE 工厂组装收敛于 installYsmModule
    //（ADR-039 §2.1 可信链：仅执行 auto-generated 内嵌胶水代码，无外部输入）
    const host = window as unknown as Record<string, unknown>;
    try {
      return await installYsmModule(host, glueCode, {
        wasmBinary,
        print: () => {},
        printErr: () => {},
        noInitialRun: true,
      });
    } catch (e) {
      // P3-10：init 失败清理 Module 注入点，避免残留 wasmBinary 配置影响未来模块
      delete host.Module;
      throw e;
    }
  });
}

/** 安全获取最新的 WASM HEAPU8（patch 注入到 Module 上，内存扩容后自动更新） */
function _getHeap(): Uint8Array {
  // 每次从 window.Module.HEAPU8 取最新的（内存扩容后 updateMemoryViews 会更新它）
  const h = (window.Module as { HEAPU8?: Uint8Array } | undefined)?.HEAPU8;
  if (h) return h;
  // 兜底：取 wasmModule 上的（老版本 Emscripten）
  const m = mod.get();
  if (m?.HEAPU8) return m.HEAPU8;
  throw new Error("无法获取 WASM HEAPU8");
}

/** 将 JS 数据写入 WASM 内存，返回指针（写入算法见 parser-shared.writeHeapBytes） */
function _writeHeap(data: Uint8Array): number {
  return writeHeapBytes(data, (len) => mod.get()!._malloc(len), _getHeap);
}

/**
 * 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组）
 * 返回 [{path, data}]，失败返回 null
 */
export async function decodeYsmFileFromMemory(
  bytes: Uint8Array,
): Promise<YsmDecodedFile[] | null> {
  if (!mod.isInited()) {
    const ok = await initYSMParser();
    if (!ok) throw new Error("YSMParser WASM 未就绪");
  }

  const m = mod.get()!;
  const FS = m.FS;
  const ccall = m.ccall;
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
    if (ptr) mod.get()?._free(ptr);
  }
}

/**
 * 通过 callMain + MEMFS 解码 .ysm（回退路径）
 * 保留以兼容旧的 WASM 编译
 */
export async function decodeYsmFile(
  bytes: Uint8Array,
): Promise<YsmDecodedFile[]> {
  if (!mod.isInited()) {
    const ok = await initYSMParser();
    if (!ok) throw new Error("YSMParser WASM 未就绪");
  }
  const m = mod.get()!;
  const FS = m.FS;
  if (!FS) throw new Error("YSMParser FS 不可用");

  try {
    // 这些 FS 操作同样可能触发 trap，纳入 catch 确保重置单例
    wipeDir(FS, "/input");
    wipeDir(FS, "/output");
    ensureDir(FS, "/input");
    ensureDir(FS, "/output");

    FS.writeFile("/input/model.ysm", bytes);

    const hasCallMain = typeof m.callMain === "function";
    if (!hasCallMain) {
      console.warn("[YSM] WASM 无 callMain，MEMFS 路径不可用");
    }

    if (hasCallMain) {
      m.callMain!(["-i", "/input", "-o", "/output"]);
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

