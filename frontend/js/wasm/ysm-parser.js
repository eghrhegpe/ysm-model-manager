// ===== YSMParser WASM 封装 =====
// 用 Module.wasmBinary 注入方式加载，规避 WebView2 fetch() 限制
// 优先使用内存解析（ysm_decode_from_memory），回退 callMain + MEMFS

let wasmModule = null;
let loading = false;
let waiters = [];

export async function initYSMParser() {
  if (wasmModule) return true;
  if (loading) return new Promise((r) => waiters.push(r));
  loading = true;

  try {
    // 1. 从内嵌 JS 拿 .wasm 二进制 + 胶水代码
    const { _getWasmBinary } = await import("./ysm-wasm-data.js");
    const { _getGlueCode } = await import("./ysm-glue-data.js");
    const wasmBinary = _getWasmBinary();
    let glueCode = _getGlueCode();
    if (!wasmBinary || !wasmBinary.byteLength) throw new Error("wasmBinary 空");
    if (!glueCode) throw new Error("胶水代码空");

    // 2. 修改胶水代码：在 updateMemoryViews 调用后导出 HEAPU8 到 Module
    //    用 ";updateMemoryViews()" 避免误改函数定义
    glueCode = glueCode.replace(
      ";updateMemoryViews()",
      ";updateMemoryViews();Module[\"HEAPU8\"]=HEAPU8",
    );

    // 3. 设置 Module.wasmBinary — 胶水代码执行时直接用
    window.Module = { wasmBinary };

    // 3. 内联脚本注入胶水代码（不通过 src，避免 URL 解析问题）
    const s = document.createElement("script");
    s.textContent = glueCode;
    document.head.appendChild(s);

    // 4. 调用工厂
    const factory = window.YSMParserModule;
    if (!factory) throw new Error("YSMParserModule 未定义");
    const mod = factory(window.Module);
    wasmModule = mod instanceof Promise ? await mod : mod;

    waiters.forEach((r) => r(true));
    waiters = [];
    return true;
  } catch (e) {
    waiters.forEach((r) => r(false));
    waiters = [];
    loading = false;
    throw e;
  }
}

/** 安全获取最新的 WASM HEAPU8（patch 注入到 Module 上，内存扩容后自动更新） */
function _getHeap() {
  // 每次从 window.Module.HEAPU8 取最新的（内存扩容后 updateMemoryViews 会更新它）
  const h = window.Module?.HEAPU8;
  if (h) return h;
  // 兜底：取 wasmModule 上的（老版本 Emscripten）
  if (wasmModule?.HEAPU8) return wasmModule.HEAPU8;
  throw new Error("无法获取 WASM HEAPU8");
}

/** 将 JS 数据写入 WASM 内存，返回指针 */
function _writeHeap(data) {
  // data 现在是 Uint8Array（已在 _decodeYsmViaWasm 中从 base64 解码）
  const src = data instanceof Uint8Array ? data : new Uint8Array(data);
  const len = src.length;
  const ptr = wasmModule._malloc(len);
  if (!ptr) throw new Error("malloc 失败 (" + len + " bytes)");
  const heap = _getHeap();
  heap.set(src, ptr);
  return ptr;
}

/**
 * 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组）
 * 返回 [{path, data}]，失败返回 null
 */
export async function decodeYsmFileFromMemory(bytes) {
  if (!wasmModule) {
    const ok = await initYSMParser();
    if (!ok) throw new Error("YSMParser WASM 未就绪");
  }

  const FS = wasmModule.FS;
  const ccall = wasmModule.ccall;
  if (!ccall) throw new Error("ccall 不可用，请重新编译 WASM");

  // 准备输出目录
  wipeDir(FS, "/output");
  ensureDir(FS, "/output");

  // 使用辅助函数分配内存并写入数据
  const ptr = _writeHeap(bytes);

  try {
    const len = bytes.byteLength || bytes.length;
    const success = ccall(
      "ysm_decode_from_memory",
      "number",
      ["number", "number", "string"],
      [ptr, len, "/output"],
    );

    if (!success) return null;
    return collectOutputFiles(FS, "/output");
  } finally {
    wasmModule._free(ptr);
  }
}

/**
 * 诊断：打印 .ysm 文件头信息到控制台
 */
export function diagYsmHeader(bytes) {
  if (!wasmModule) throw new Error("YSMParser WASM 未就绪");
  const ccall = wasmModule.ccall;
  if (!ccall) return;

  const ptr = _writeHeap(bytes);
  try {
    ccall("ysm_diag_header", null, ["number", "number"], [ptr, bytes.byteLength || bytes.length]);
  } finally {
    wasmModule._free(ptr);
  }
}

/**
 * 检测 .ysm 文件版本（不解析，仅检查文件头）
 * 返回: 0=未知, 1=V1, 2=V2, 3=V3
 */
export function detectYsmVersion(bytes) {
  if (!wasmModule) throw new Error("YSMParser WASM 未就绪");
  const ccall = wasmModule.ccall;
  if (!ccall) return -1;

  const ptr = _writeHeap(bytes);
  try {
    return ccall("ysm_detect_version", "number", ["number", "number"], [ptr, bytes.byteLength || bytes.length]);
  } finally {
    wasmModule._free(ptr);
  }
}

/**
 * 通过 callMain + MEMFS 解码 .ysm（回退路径）
 * 保留以兼容旧的 WASM 编译
 */
export async function decodeYsmFile(bytes) {
  if (!wasmModule) {
    const ok = await initYSMParser();
    if (!ok) throw new Error("YSMParser WASM 未就绪");
  }
  const FS = wasmModule.FS;
  if (!FS) throw new Error("YSMParser FS 不可用");

  wipeDir(FS, "/input");
  wipeDir(FS, "/output");
  ensureDir(FS, "/input");
  ensureDir(FS, "/output");

  FS.writeFile("/input/model.ysm", bytes);

  const hasCallMain = typeof wasmModule.callMain === "function";

  try {
    if (hasCallMain) {
      wasmModule.callMain(["-i", "/input", "-o", "/output"]);
    }
  } catch (err) {
    const errStr = String(err?.name || err);
    if (errStr.includes("ExitStatus")) {
      if (typeof err?.status === "number" && err.status !== 0) {
        throw new Error("YSMParser exit code " + err.status);
      }
    } else {
      throw err;
    }
  }

  return collectOutputFiles(FS, "/output");
}

function wipeDir(FS, dir) {
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

function ensureDir(FS, dir) {
  let cur = "";
  for (const p of dir.split("/").filter(Boolean)) {
    cur += "/" + p;
    try {
      FS.mkdir(cur);
    } catch (_) {}
  }
}

function collectOutputFiles(FS, root) {
  const r = [];
  (function w(d, rel) {
    for (const e of FS.readdir(d).filter((n) => n !== "." && n !== "..")) {
      const f = d + "/" + e;
      const rp = rel ? rel + "/" + e : e;
      if (FS.isDir(FS.stat(f).mode)) w(f, rp);
      else r.push({ path: rp, data: FS.readFile(f) });
    }
  })(root, "");
  return r;
}
