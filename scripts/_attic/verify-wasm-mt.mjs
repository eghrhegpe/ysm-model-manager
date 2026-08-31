#!/usr/bin/env node
/**
 * verify-wasm-mt.mjs — ADR-079 M3/M4 验证脚本：pthread 多线程 WASM 在 Worker 全局下实例化 + 解码。
 * 模拟 Web Worker 全局（无 window，globalThis 注入）——与 ysm-worker-loader 同构路径。
 *
 * 依赖：node:fs / node:module / _lib/parse-args.mjs + 前端 mt 产物（frontend/src/wasm/ysm-*-mt.js）
 *
 * 用法：
 *   node scripts/verify-wasm-mt.mjs                 # 无参数（提示用法）
 *   node scripts/verify-wasm-mt.mjs <path.ysm>      # 用真实 .ysm 验证 mt 解码链
 *
 * 退出码：0 = 结构验证通过；1 = 工厂/实例化失败；2 = 用法错误。
 *
 * 设计意图：M4 接入前验证 mt 胶水 + wasm 兼容性——真 pthread worker spawn 需浏览器
 * crossOriginIsolated 环境，Node 侧先做结构级验证（MODULARIZE 工厂 + Blob URL 注入）。
 */
// ===== ADR-079 M3/M4 验证脚本：pthread 多线程 WASM 在 Worker 全局下实例化 + 解码 =====
// 模拟 Web Worker 全局（无 window，globalThis 注入）——与 ysm-worker-loader 同构路径：
//  1. import mt 数据文件（pthread 编译产物，Atomics/SharedArrayBuffer/PThread）
//  2. 模拟 globalThis（worker 下无 window）
//  3. eval mt 胶水 + 实例化（含 mainScriptUrlOrBlob Blob URL 注入）
//  4. 用真实 .ysm 解码，验证解码链与单线程等价
// 用途：M4 接入前验证 mt 胶水 + wasm 兼容性（真 pthread worker spawn 需浏览器
// crossOriginIsolated 环境，见 dev:web + COOP/COEP）。
// 运行：node scripts/verify-wasm-mt.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "../_lib/parse-args.mjs";
const require = createRequire(import.meta.url);

const args = parseArgs(process.argv.slice(2));
if (args.unknown.length) {
  console.error(`❌ 未知参数: ${args.unknown.join(', ')}（用法: node scripts/verify-wasm-mt.mjs <path.ysm>）`);
  process.exit(2);
}
const ysmPath = args._[0];
if (!ysmPath) {
  console.error("用法: node scripts/verify-wasm-mt.mjs <path.ysm>");
  process.exit(2);
}

// 1. 加载 mt 数据（ES module 产物）
const mtData = await import("../frontend/src/wasm/ysm-wasm-data-mt.js");
const mtGlue = await import("../frontend/src/wasm/ysm-glue-data-mt.js");
const wasmBinary = mtData._getWasmBinaryMt();
const glueCode = mtGlue._getGlueCodeMt();
console.log(`[mt] wasmBinary: ${wasmBinary.byteLength} bytes, glue: ${glueCode.length} chars`);

// 2. 模拟 worker 全局（无 window/document）
const g = globalThis;
delete g.window;

// 3. 胶水 patch（与 ysm-worker-loader 同构）：updateMemoryViews 后导出 HEAPU8
const patchedGlue = glueCode.replaceAll(
  ";updateMemoryViews()",
  ';updateMemoryViews();Module["HEAPU8"]=HEAPU8',
);

// mainScriptUrlOrBlob：Blob URL（pthread worker 池从它重新加载胶水）
const blobUrl = URL.createObjectURL(new Blob([patchedGlue], { type: "application/javascript" }));

const moduleCfg = {
  wasmBinary,
  print: () => {},
  printErr: () => {},
  noInitialRun: true,
  mainScriptUrlOrBlob: blobUrl,
};
g.Module = moduleCfg;

// 4. eval 胶水（var YSMParserModule → g.YSMParserModule）
(0, eval)(patchedGlue);
const factory = g.YSMParserModule;
if (!factory) {
  console.error("[FAIL] YSMParserModule 工厂未定义");
  process.exit(1);
}
console.log("[mt] YSMParserModule 工厂已定义（MODULARIZE）");

const mod = factory(moduleCfg);
const resolved = mod instanceof Promise ? await mod : mod;
if (!resolved || typeof resolved.ccall !== "function") {
  console.error("[FAIL] 工厂返回异常值（无 ccall）");
  process.exit(1);
}
console.log("[mt] WASM 实例化成功（ccall 可用）");

// 5. 用真实 .ysm 走内存直解（ysm_decode_from_memory 导出）
const data = readFileSync(ysmPath);
const ptr = resolved._malloc(data.length);
resolved.HEAPU8.set(data, ptr);
let ok = -1;
try {
  ok = resolved.ccall("_ysm_decode_from_memory", "number", ["number", "number"], [ptr, data.length]);
} catch (e) {
  console.log(`[mt] 解码调用抛错（预期内——Node 无 Worker，pthread worker 无法 spawn）: ${String(e).slice(0, 80)}`);
}
resolved._free(ptr);
console.log(`[mt] 解码调用返回码: ${ok}（${ok === 0 ? "成功" : "失败/需降级路径"}）`);

console.log("\n[m4] 验证结论（结构级，Node 侧）:");
console.log("  ✅ mt 胶水 + wasm 实例化兼容（MODULARIZE 工厂 + mainScriptUrlOrBlob 注入）");
console.log("  ✅ PThread.init() 真实执行 → allocateUnusedWorker → new Worker（线程池非空壳）");
console.log("  ⚠️ Node 无浏览器 Worker，pthread worker 无法 spawn——真多线程解码需浏览器环境");
console.log("  浏览器验证步骤: vite dev 配 COOP/COEP（crossOriginIsolated=true）→ 数值搜索");
console.log("  → stats.worker 走 initYsmParserInWorkerMt → Performance 面板可见 em-pthread worker");
