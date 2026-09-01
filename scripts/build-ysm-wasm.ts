#!/usr/bin/env node
/**
 * 统一 YSMParser WASM 构建（一份 web 产物服务前后端）。
 * build-ysm-wasm.ts — 构建 YSMParser WASM web 产物
 * 设计意图：原「前端版 / Go 版」两份二进制统一为单一 web 产物（Node 能 require web glue，WebView2 反之不行，故保留 web 弃 node）。
 * 依赖：node:child_process / node:fs / node:path / node:url
 * 用法：
 *   node scripts/build-ysm-wasm.ts
 * 退出码：
 *   0 成功 / 1 失败
 */
// build-ysm-wasm.ts — 统一 YSMParser WASM 构建（一份 web 产物服务前后端）
//
// 背景（2026-08-08 统一）：原「前端版 / Go 版」两份不同二进制（导出面不同）已统一为
// 单一 web 产物 —— Node 能 require web glue（实测 callMain 解码成功），WebView2 反之
// 不行（NODERAWFS 依赖 Node fs），故保留 web、弃 node。
//
// 流程：em++ 编译 → upstream/YesSteveModel-Parser/build-unified/
//      → 前端 base64 打包（frontend/src/wasm/ysm-wasm-data.js + ysm-glue-data.js）
//      → Go embed 拷贝（frontend/public/wasm/YSMParser.{js,wasm}）
//
// 用法：
//   node scripts/build-ysm-wasm.ts              # 编译 + 打包 + 拷贝
//   node scripts/build-ysm-wasm.ts --skip-build # 仅用 build-unified/ 现有产物重新打包
//
// 注意：依赖 build-wasm/external/ 下的预编译静态库（zstd/cityhash/xchacha20/AES/md5/
// cpp-base64/zlib/fpng）——首次需先经 CMake 构建（wasm-release preset）或复用既有
// build-wasm 目录。emsdk 路径可用 EMSDK 环境变量覆盖。

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, statSync, renameSync } from "node:fs";
import { join, dirname, basename, delimiter as PATH_DELIM } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { run } from './_lib/proc.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const UPSTREAM = join(ROOT, "upstream", "YesSteveModel-Parser");
const FRONT_SRC = join(ROOT, "frontend", "src", "wasm");
const FRONT_PUBLIC = join(ROOT, "frontend", "public", "wasm");
const OUT_DIR = join(UPSTREAM, "build-unified");
const SKIP_BUILD = process.argv.includes("--skip-build");

// EMSDK 定位（批次4 P1）：不硬编码用户路径。优先环境变量，其次探测常见安装位，
// 全部未命中则 fail-closed 提示设置 EMSDK，避免在别人机器上静默失败/走错 emsdk。
function detectEmsdk() {
  const candidates = [
    process.env.EMSDK,
    join(homedir(), "emsdk"),
    "C:/emsdk",
    "D:/emsdk",
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(join(c as string, "upstream", "emscripten"))) return c;
  }
  return null;
}
const EMSDK = detectEmsdk();
if (!EMSDK) {
  console.error("未找到 emsdk（探测 HOME/emsdk、C:/emsdk、D:/emsdk 均失败）。");
  console.error("  请设置环境变量 EMSDK 指向 emsdk 根目录后重试，如：$env:EMSDK='C:/emsdk'");
  process.exit(1);
}
const EMCC_DIR = join(EMSDK, "upstream", "emscripten");
// em++ 可执行文件名分平台：Windows 下为 em++.bat（Node 自动经 cmd.exe 执行），POSIX 为无扩展名脚本
const EMXX = join(EMCC_DIR, process.platform === "win32" ? "em++.bat" : "em++");

if (!existsSync(UPSTREAM)) {
  console.error(`未找到 upstream/YesSteveModel-Parser: ${UPSTREAM}`);
  process.exit(1);
}

const version = readFileSync(join(UPSTREAM, "version.txt"), "utf8").trim();

if (!SKIP_BUILD) {
  const src = [
    "YSMParser/parsers/YSMParser.cpp",
    "YSMParser/parsers/YSMParserV1.cpp",
    "YSMParser/parsers/YSMParserV2.cpp",
    "YSMParser/parsers/v3/YSMParserV3.cpp",
    "YSMParser/algorithms/CryptoAlgorithms.cpp",
    "ysm-wasm-bridge.cpp",
    "YSMParser/main.cpp",
  ];

  // include 修正：json 在 external/json、city 头在 external/cityhash/src（build-wasi.ps1 漏了这两项）
  const inc = [
    "-I.", "-Iexternal", "-Iexternal/json", "-Iexternal/zlib",
    "-Iexternal/zstd/lib", "-Iexternal/zstd/lib/common", "-Iexternal/cityhash/src",
    "-Iexternal/xchacha20/src", "-Iexternal/AES/src", "-Iexternal/md5",
    "-Iexternal/cpp-base64", "-Iexternal/fpng/src",
  ];

  // 库路径修正：预编译静态库在 build-wasm/external/ 下（build-wasi.ps1 写 external/ 不存在）
  const libs = [
    "build-wasm/external/zstd/build_out/lib/libzstd.a",
    "build-wasm/external/cityhash/libcityhash.a",
    "build-wasm/external/xchacha20/libxchacha20.a",
    "build-wasm/external/AES/libAES.a",
    "build-wasm/external/md5/libmd5.a",
    "build-wasm/external/cpp-base64/libbase64.a",
    "build-wasm/external/zlib/libz.a",
    "build-wasm/libfpng.a",
  ];
  for (const lib of libs) {
    if (!existsSync(join(UPSTREAM, lib))) {
      console.error(`缺少依赖库: ${lib}（需先 CMake 构建 wasm 依赖）`);
      process.exit(1);
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const args = [
    "-std=c++20", "-O3", "-DNDEBUG", "-fexceptions",
    `-DYSM_PARSER_VERSION="${version}"`,
    "-sFORCE_FILESYSTEM=1", "-sALLOW_MEMORY_GROWTH=1", "-sMAXIMUM_MEMORY=536870912",
    "-sEXIT_RUNTIME=0", "-sINVOKE_RUN=0",
    "-sENVIRONMENT=web", "-sMODULARIZE=1", "-sEXPORT_NAME=YSMParserModule",
    "-sEXPORTED_RUNTIME_METHODS=['FS','callMain','ccall','cwrap']",
    "-sEXPORTED_FUNCTIONS=['_main','_ysm_decode_from_memory','_ysm_detect_version','_ysm_diag_header','_malloc','_free']",
    "-o", join(OUT_DIR, "YSMParser.js"),
    ...src, ...inc, ...libs,
  ];
  console.log("[build] em++ 编译中...");
  const r = run(EMXX, args, {
    cwd: UPSTREAM,
    stdio: "inherit",
    env: { ...process.env, PATH: `${EMCC_DIR}${PATH_DELIM}${process.env.PATH}`, EMSDK },
  });
  if (!r.ok) {
    console.error("[build] ❌ em++ 编译失败:", r.err || `rc=${r.rc}`);
    process.exit(1);
  }
  console.log(`[build] ✅ 编译完成: ${OUT_DIR}`);
} else {
  if (!existsSync(join(OUT_DIR, "YSMParser.js"))) {
    console.error("--skip-build 但 build-unified/ 无产物");
    process.exit(1);
  }
  console.log("[build] ⏭ 跳过编译，复用 build-unified/");
}

// 锚点前置校验（批次4 P3）：任何打包/拷贝前先确认编译产物含 Go embed 补丁锚点。
// 缺锚点直接 fail——避免编译完才发现、且半坏产物已拷进 frontend/public|dist（wasm_decoder.go 依赖）。
const glueProbe = readFileSync(join(OUT_DIR, "YSMParser.js"), "utf8");
if (!glueProbe.includes(";updateMemoryViews()")) {
  console.error("glue 缺少 ;updateMemoryViews() 补丁锚点（wasm_decoder.go 依赖），拒绝打包/拷贝");
  process.exit(1);
}
console.log("[verify] ✅ glue 补丁锚点存在；建议跑 node scripts/_attic/test-decode-from-memory.mjs 实测解码");

// 前端 base64 打包（与 pack-wasm.ps1 同格式）
// wasm 文件：_getWasmBinary 返回 ArrayBuffer；glue 文件：_getGlueCode 返回 string
//（ysm-parser.ts 把 glue 当 JS 源码 eval，必须 TextDecoder 解码，不能返回 ArrayBuffer）
function toDataFile(filePath, fnName, comment, isGlue) {
  const b64 = readFileSync(filePath).toString("base64");
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const decode =
    isGlue
      ? `  const raw = atob(b64);\n  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));\n  return new TextDecoder().decode(bytes);\n`
      : `  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));\n  return bin.buffer;\n`;
  return (
    `// 自动生成：${comment} (base64)\n` +
    `// 编译时间: ${now}\n` +
    `export function ${fnName}() {\n` +
    `  const b64 = "${b64}";\n` +
    decode +
    `}\n`
  );
}
const wasmData = toDataFile(join(OUT_DIR, "YSMParser.wasm"), "_getWasmBinary", "YSMParser.wasm", false);
const glueData = toDataFile(join(OUT_DIR, "YSMParser.js"), "_getGlueCode", "YSMParser.js 胶水代码", true);
// P3-3（code_review）：原子写（临时文件 + renameSync）——直接 writeFileSync 在断点/失败时
// 留下半截 base64 产物，前端 eval 直接坏；rename 同目录原子替换，产物要么旧要么完整
function atomicWrite(target, content) {
  const tmp = join(dirname(target), `.${basename(target)}.tmp`);
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, target);
}
atomicWrite(join(FRONT_SRC, "ysm-wasm-data.js"), wasmData);
atomicWrite(join(FRONT_SRC, "ysm-glue-data.js"), glueData);
console.log(`[pack] ✅ 前端 data: ${statSync(join(FRONT_SRC, "ysm-wasm-data.js")).size}B / ${statSync(join(FRONT_SRC, "ysm-glue-data.js")).size}B`);

// Go embed 拷贝（temp+rename 原子写，防中途留半截产物）
const atomicCopy = (src, dst) => {
  const tmp = `${dst}.tmp`;
  copyFileSync(src, tmp);
  renameSync(tmp, dst);
};
atomicCopy(join(OUT_DIR, "YSMParser.js"), join(FRONT_PUBLIC, "YSMParser.js"));
atomicCopy(join(OUT_DIR, "YSMParser.wasm"), join(FRONT_PUBLIC, "YSMParser.wasm"));
console.log(`[pack] ✅ Go 拷贝: ${statSync(join(FRONT_PUBLIC, "YSMParser.wasm")).size}B / ${statSync(join(FRONT_PUBLIC, "YSMParser.js")).size}B`);

// P3-4（code_review）：Go embed 实际嵌入 frontend/dist/wasm/（embed.go:12 是
// `//go:embed frontend/dist/wasm/YSMParser.wasm`，不是 public/）——只跑本脚本后
// 立刻 `go build` 时 dist 缺失会报 no matching files、存在则内嵌旧二进制。
// 显式同步 dist，保证「上游更新后重跑一次」的承诺成立。
const FRONT_DIST_WASM = join(ROOT, "frontend", "dist", "wasm");
mkdirSync(FRONT_DIST_WASM, { recursive: true });
atomicCopy(join(OUT_DIR, "YSMParser.wasm"), join(FRONT_DIST_WASM, "YSMParser.wasm"));
console.log(`[pack] ✅ Go embed 源已同步: frontend/dist/wasm/YSMParser.wasm`);
console.log("[done] 建议跑 node scripts/_attic/test-decode-from-memory.mjs 实测解码");
