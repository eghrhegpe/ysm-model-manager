// ===== YSMParser 共享核心（主线程 ysm-parser.ts 与 Worker ysm-worker-loader.ts 的无状态公共部分）=====
// 原两处逐字同构副本收敛于此，消除「需同步避免口径漂移」的人肉同步负担。
// 边界：仅共享无状态纯函数与类型；单例状态（wasmModule/loading/waiters）与全局
// 注入点差异（主线程 window.Module vs Worker globalThis.Module）不在此共享——
// Worker 内 WASM 加载必须独立于主线程单例（stats.worker.ts 约束）。

/** 解码输出文件 */
export interface YsmDecodedFile {
  path: string;
  data: Uint8Array;
}

/** Emscripten FS 最小接口（WASM 导出） */
export interface FSLike {
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  readFile(path: string): Uint8Array;
  writeFile(path: string, data: Uint8Array): void;
  mkdir(path: string): void;
  rmdir(path: string): void;
  unlink(path: string): void;
}

/** Emscripten Module 最小接口（WASM 实例） */
export interface WasmModuleLike {
  _malloc(len: number): number;
  _free(ptr: number): void;
  ccall(
    fn: string,
    ret: string | null,
    args: string[],
    params: Array<number | string>,
  ): number | null;
  FS: FSLike;
  HEAPU8?: Uint8Array;
  callMain?: (args: string[]) => void;
}

/**
 * WASM 错误分类：收敛 decodeYsmFileFromMemory / decodeYsmFile / decodeYsmInWorker /
 * decodeYsmInWorkerMemfs 四个 catch 块的重复判定。
 * 口径差异保留在调用方：内存路径 ExitStatus 一并重置；callMain 路径按 exit code 细分。
 *
 * 判定材料（2026-08 修复：旧版只看 err.name，而真实崩溃全是 WebAssembly.RuntimeError
 * ——Emscripten abort() 抛 `Aborted(...). Build with -sASSERTIONS...`，原生 trap 抛
 * "memory access out of bounds"，name 均为 "RuntimeError"，关键词只在 message → 全漏判
 * 为 unknown，硬崩溃重置链永不触发 → ABORT=true 的死模块永久占坑）：
 * - 裸字符串 throw 用全文；Error 对象用 name + message；
 * - instanceof WebAssembly.RuntimeError 兜底无关键词 trap（unreachable / stack overflow），
 *   能逃逸到 catch 的 RuntimeError 必然意味着模块状态可疑，重置是安全且廉价的自愈；
 * - name+message 关键词兜底结构化克隆丢原型的跨 Worker 场景。
 * @returns fatal=abort/trap/oOM 硬崩溃；exit=ExitStatus（调用方查 exitCode）；unknown=其他
 */
export function classifyWasmError(err: unknown): {
  kind: "fatal" | "exit" | "unknown";
  exitCode?: number | undefined;
} {
  const errObj = err as { name?: string; message?: string; status?: unknown };
  const errText =
    typeof err === "string"
      ? err
      : `${errObj?.name ?? ""} ${errObj?.message ?? ""}${
          err instanceof WebAssembly.RuntimeError ? " wasm-runtime-error" : ""
        }`;
  if (errText.includes("ExitStatus")) {
    return {
      kind: "exit",
      exitCode: typeof errObj?.status === "number" ? errObj.status : undefined,
    };
  }
  if (/abort|trap|out of memory|out of bounds|wasm-runtime-error/i.test(errText)) {
    return { kind: "fatal" };
  }
  return { kind: "unknown" };
}

export function wipeDir(FS: FSLike, dir: string): void {
  try {
    for (const e of FS.readdir(dir).filter((n) => n !== "." && n !== "..")) {
      const f = dir + "/" + e;
      if (FS.isDir(FS.stat(f).mode)) {
        wipeDir(FS, f);
        FS.rmdir(f);
      } else {
        FS.unlink(f);
      }
    }
  } catch (_) {}
}

export function ensureDir(FS: FSLike, dir: string): void {
  let cur = "";
  for (const p of dir.split("/").filter(Boolean)) {
    cur += "/" + p;
    try {
      FS.mkdir(cur);
    } catch (_) {}
  }
}

export function collectOutputFiles(FS: FSLike, root: string): YsmDecodedFile[] {
  const r: YsmDecodedFile[] = [];
  (function w(d: string, rel: string): void {
    for (const e of FS.readdir(d).filter((n) => n !== "." && n !== "..")) {
      const f = d + "/" + e;
      const rp = rel ? rel + "/" + e : e;
      if (FS.isDir(FS.stat(f).mode)) w(f, rp);
      else r.push({ path: rp, data: FS.readFile(f) });
    }
  })(root, "");
  return r;
}

/**
 * 将 JS 数据写入 WASM 内存，返回指针。
 * @param malloc 模块 _malloc（可能触发 WASM 内存增长）
 * @param getHeap 取最新 HEAPU8 的闭包——⚠️ _malloc 可能触发 growMemory，此时 HEAPU8 被
 *   新的 ArrayBuffer 替换（旧 buffer 被分离/detached）。必须在写入前重新获取最新 HEAPU8，
 *   而非在 malloc 之前缓存——否则 heap.set() 写入已分离的 buffer，数据丢失且不报错
 *   （静默损坏：WASM 解码输出全乱，前端渲染花屏/白屏，难以定位）。
 */
export function writeHeapBytes(
  data: Uint8Array,
  malloc: (len: number) => number,
  getHeap: () => Uint8Array,
): number {
  const src = data instanceof Uint8Array ? data : new Uint8Array(data);
  const len = src.length;
  const ptr = malloc(len);
  if (!ptr) throw new Error("malloc 失败 (" + len + " bytes)");
  getHeap().set(src, ptr);
  return ptr;
}

/**
 * 修改 Emscripten 胶水代码：在所有 updateMemoryViews 调用后导出 HEAPU8 到 Module。
 * 主线程（ysm-parser.ts）与 Worker（ysm-worker-loader.ts）共用，消除逐字重复。
 * 用 ";updateMemoryViews()" 避免误改函数定义；replaceAll 确保所有调用点都被 patch。
 */
export function patchGlueHeapExport(glueCode: string): string {
  return glueCode.replaceAll(
    ";updateMemoryViews()",
    ';updateMemoryViews();Module["HEAPU8"]=HEAPU8',
  );
}

/**
 * 解析 Emscripten 胶水工厂返回值（MODULARIZE 产物：可能返回 Promise）并校验 ccall。
 * 主线程 / Worker 两处 init 共用；成功返回 WasmModuleLike，异常值抛错。
 * @param factory 胶水暴露的工厂（async factory(moduleArg)）
 * @param moduleArg 注入的 Module 配置（主线程 window.Module / Worker globalThis.Module）
 */
export async function resolveWasmFactory(
  factory: (module: unknown) => unknown | Promise<unknown>,
  moduleArg: unknown,
): Promise<WasmModuleLike> {
  const mod = factory(moduleArg);
  const resolved = mod instanceof Promise ? await mod : mod;
  if (!resolved || typeof (resolved as WasmModuleLike).ccall !== "function") {
    throw new Error("YSMParserModule 工厂返回异常值");
  }
  return resolved as WasmModuleLike;
}
