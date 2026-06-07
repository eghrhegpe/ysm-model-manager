// ===== YSMParser WASM 封装 =====
// 用 Module.wasmBinary 注入方式加载，规避 WebView2 fetch() 限制

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
    const glueCode = _getGlueCode();
    if (!wasmBinary || !wasmBinary.byteLength) throw new Error("wasmBinary 空");
    if (!glueCode) throw new Error("胶水代码空");

    // 2. 设置 Module.wasmBinary — 胶水代码执行时直接用
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

  // 检查 callMain 是否存在
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

  // 收集输出（不论 callMain 是否成功）
  const result = collectOutputFiles(FS, "/output");
  return result;

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
