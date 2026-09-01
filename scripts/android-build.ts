#!/usr/bin/env node
/**
 * 一键构建 Android 调试/生产 APK（Windows/macOS/Linux 宿主通用）。
 * 补齐 android-install.ts 的缺口：它只跑 gradle installDebug（打包 jniLibs 里
 * 已有的旧 libwails.so），本脚本先做前端构建 + NDK 交叉编译 libwails.so + gradle
 * assembleDebug，产出全新 APK。
 * 依赖：Android SDK（ANDROID_HOME/ANDROID_SDK_ROOT，含 NDK）+ Go（cgo 交叉编译）
 *       + JDK 17+（gradle wrapper 自带下载）。
 * 子进程统一走 _lib/proc.ts run()（数组参数，无 shell 拼接，ADR-043）。
 * 用法：
 *   node scripts/android-build.ts                  # 前端 + arm64 Go + gradle，debug 版
 *   node scripts/android-build.ts --arch amd64     # 只编 x86_64（模拟器）
 *   node scripts/android-build.ts --arch all        # arm64 + amd64（fat APK）
 *   node scripts/android-build.ts --production      # 生产版（-tags production,android）
 *   node scripts/android-build.ts --rust-backend          启用 Rust scanner bridge
 *   node scripts/android-build.ts --skip-frontend   # 跳过前端构建（仅重编 Go + gradle）
 *   node scripts/android-build.ts --version vX.Y.Z  # 注入版本到 go/version.Version（缺省读 git 最新 tag，无则 dev）
 *   node scripts/android-build.ts --help
 *   node scripts/android-build.ts --rust-backend        启用 Rust scanner bridge（调试用）
 * 退出码：0 成功；1 环境缺失/构建失败（错误信息直通）。
 * 设计意图：一键构建 Android APK，补齐 android-install.ts 的缺口（只做 installDebug，不重编 libwails.so）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.ts';
import { run } from './_lib/proc.ts';

const ROOT = getRoot();
const ANDROID_DIR = path.join(ROOT, 'build', 'android');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const JNI_BASE = path.join(ANDROID_DIR, 'app', 'src', 'main', 'jniLibs');
const MIN_SDK = '21'; // app/build.gradle minSdk
const OVERLAY = path.join(ROOT, 'build', 'android', 'overlay.json');

/** ABI → GOARCH / NDK target / jniLibs 子目录 */
const ARCHES: Record<string, { goarch: string; ndkTarget: string; abi: string }> = {
  arm64: { goarch: 'arm64', ndkTarget: `aarch64-linux-android${MIN_SDK}`, abi: 'arm64-v8a' },
  amd64: { goarch: 'amd64', ndkTarget: `x86_64-linux-android${MIN_SDK}`, abi: 'x86_64' },
};

/** 宿主 → NDK llvm prebuilt 目录名 */
function hostTag() {
  const p = os.platform();
  if (p === 'win32') return 'windows-x86_64';
  if (p === 'darwin') return os.arch() === 'arm64' ? 'darwin-arm64' : 'darwin-x86_64';
  return 'linux-x86_64';
}

/** Windows 读 User 级环境变量（新开终端不继承，显式读 registry；非 Windows 直接返回空） */
function readUserEnv(name: string) {
  if (process.platform !== 'win32') return '';
  try {
    const r = run('reg', ['query', 'HKCU\\Environment', '/v', name]);
    if (!r.ok) return '';
    // reg query 输出为 tab/多空格分隔的三列：值名 类型(REG_EXPAND_SZ) 值。
    // 末列即值（值内可含空格，逐列拆分后取末段最稳）。类型列是第二列，永不混入。
    for (const l of r.out.split(/\r?\n/)) {
      const cols = l.trim().split(/\s+/);
      if (cols.length >= 3) return cols.slice(2).join(' '); // 第 3 列起都是该 REG 值
    }
    return '';
  } catch { return ''; }
}

/** 定位 NDK 根：$ANDROID_NDK_HOME，或 $SDK/ndk/<最新版本>（进程级→User 级→非 Windows 兜底） */
function findNdk() {
  const home =
    process.env.ANDROID_NDK_HOME ||
    readUserEnv('ANDROID_NDK_HOME');
  if (home) {
    const ndkHome = home.replace(/"/g, '');
    if (fs.existsSync(ndkHome)) return ndkHome;
  }
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    readUserEnv('ANDROID_HOME') ||
    readUserEnv('ANDROID_SDK_ROOT') ||
    (fs.existsSync('C:\\Android\\Sdk') ? 'C:\\Android\\Sdk' : '');
  if (sdk) {
    const ndkDir = path.join(sdk.replace(/"/g, ''), 'ndk');
    if (fs.existsSync(ndkDir)) {
      const versions = fs
        .readdirSync(ndkDir)
        .filter((d) => fs.statSync(path.join(ndkDir, d)).isDirectory())
        .sort();
      if (versions.length > 0) return path.join(ndkDir, versions[versions.length - 1]!);
    }
  }
  return null;
}

function fail(msg: string): never {
  console.error(`[android-build] ${msg}`);
  process.exit(1);
}

// ---- 参数解析 ----
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log(`用法:
  node scripts/android-build.ts                 前端 + arm64 Go + gradle，debug 版
  node scripts/android-build.ts --arch amd64    只编 x86_64（模拟器）
  node scripts/android-build.ts --arch all       arm64 + amd64（fat APK）
  node scripts/android-build.ts --production     生产版（-tags production,android）
  node scripts/android-build.ts --skip-frontend  跳过前端构建
  node scripts/android-build.ts --version vX.Y.Z 注入版本（缺省读 git 最新 tag，无则 dev）
前置：ANDROID_HOME（含 NDK）+ Go 1.25+（cgo）+ JDK 17+。
产物：build/android/app/build/outputs/apk/debug/app-debug.apk（或 release/）`);
  process.exit(0);
}
const archIdx = argv.indexOf("--arch");
const archArg =
  argv.find((a) => a.startsWith("--arch="))?.split("=")[1] ??
  (archIdx >= 0 ? argv[archIdx + 1] : undefined) ??
  "arm64";
const production = argv.includes('--production');
const skipFrontend = argv.includes('--skip-frontend');
const versionArg =
  argv.find((a) => a.startsWith("--version="))?.split("=")[1] ??
  (argv.indexOf("--version") >= 0 ? argv[argv.indexOf("--version") + 1] : undefined);
if (!(archArg in ARCHES) && archArg !== 'all') fail(`未知架构: ${archArg}（可选 arm64/amd64/all）`);
const arches = archArg === 'all' ? Object.keys(ARCHES) : [archArg];

/** 解析注入版本：显式 --version 优先，否则取 git 最新 tag，兜底 dev */
function resolveVersion() {
  if (versionArg) return versionArg;
  const git = run('git', ['describe', '--tags', '--abbrev=0'], { cwd: ROOT });
  return git.ok ? git.out.trim() : 'dev';
}

// ---- 前置检查 ----
if (!fs.existsSync(OVERLAY)) {
  // 缺则自动生成（内含本机绝对路径，不入库——ADR-047）；生成失败再 hard fail
  console.log(`[android-build] 缺少 overlay.json，自动执行 wails3 android overlay:gen …`);
  const gen = run('wails3', ['android', 'overlay:gen', '-out', OVERLAY, '-config', path.join(ROOT, 'build', 'config.yml')], { cwd: ROOT, timeout: 0 });
  if (!gen.ok) fail(`overlay 自动生成失败（可手动执行 wails3 android overlay:gen）：\n${gen.out.slice(-800)}`);
}
const ndk = findNdk();
if (!ndk) fail(`未找到 NDK：设 ANDROID_NDK_HOME，或 ANDROID_HOME/ndk 下存在 NDK（当前: ${process.env.ANDROID_HOME || '未设置'}）`);
console.log(`[android-build] NDK: ${ndk}`);

// ---- 1. 前端构建（APK assets 需要最新 dist）----
if (!skipFrontend) {
  console.log('[android-build] 前端构建（build:dev = gen:locales && vite build）…');
  // npm 无扩展名 shim：Windows 需 shell（proc.mjs 注释）
  const fe = run('npm', ['run', 'build:dev'], { cwd: FRONTEND_DIR, timeout: 0, shell: os.platform() === 'win32' });
  if (!fe.ok) fail(`前端构建失败：\n${fe.out.slice(-800)}`);
}


// ---- 1.5. Rust scanner bridge 交叉编译（staticlib，供 Go CGO 静态链接）----
// 仅在 rust_backend tag 启用时构建（与 Windows 生产构建一致：-tags production,rust_backend）。
// debug 模式下可选：GO_RUST_BACKEND=1 node scripts/android-build.ts 触发。
const rustBackend = argv.includes('--rust-backend') || production || process.env.GO_RUST_BACKEND === '1';
if (rustBackend) {
  console.log('[android-build] 编译 Rust scanner bridge（Android staticlib）…');
  const rustScripts = run('node', ['scripts/compile-android-rust.ts', '--arch', archArg], { cwd: ROOT, timeout: 0 });
  if (!rustScripts.ok) fail(`Rust bridge 编译失败：
${rustScripts.out.slice(-800)}`);
  console.log('[android-build] ✅ Rust bridge 就绪');
} else {
  console.log('[android-build] Rust bridge 跳过（加 --rust-backend 或设 GO_RUST_BACKEND=1 启用）');
}

// ---- 2. Go 交叉编译 libwails.so（per ABI）----
const toolchain = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', hostTag());
if (!fs.existsSync(toolchain)) fail(`NDK 工具链缺失: ${toolchain}`);
const version = resolveVersion();
const ldflag = `-X ysm-model-manager/go/version.Version=${version}`;
const RUST_LIB_DIR = path.join(ROOT, 'go', 'rustbridge', 'android-lib');
// ---- 2. Go 交叉编译 libwails.so（per ABI）----
console.log(`[android-build] 版本注入: ${version}`);
for (const arch of arches) {
  const a = ARCHES[arch]!;
  const cc = path.join(toolchain, 'bin', a.ndkTarget + '-clang');
  if (!fs.existsSync(cc)) fail(`缺少编译器: ${cc}`);
  const out = path.join(JNI_BASE, a.abi, 'libwails.so');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log(`[android-build] Go 交叉编译 ${arch}（${a.abi}）…`);
  const archFlags = rustBackend
    ? [`-extldflags=-L${RUST_LIB_DIR} -l:libysm_model_manager_wails_bridge.a`]
    : [];
  const goTags = (production ? ['production', 'android'] : ['android', 'debug'])
    .concat(rustBackend ? ['rust_backend'] : [])
    .join(',');
  const archBuildFlags = production
    ? ['-tags', goTags, '-trimpath', '-buildvcs=false', `-ldflags=-w -s ${ldflag}`, ...archFlags]
    : ['-tags', goTags, '-buildvcs=false', '-gcflags=all=-l', `-ldflags=${ldflag}`, ...archFlags];
  const r = run('go', ['build', '-buildmode=c-shared', `-overlay=${OVERLAY}`, ...archBuildFlags, '-o', out, '.'], {
    cwd: ROOT,
    timeout: 0,
    env: {
      CC: cc,
      CGO_ENABLED: '1',
      GOOS: 'android',
      GOARCH: a.goarch,
    },
  });
  if (!r.ok) fail(`Go 交叉编译 ${arch} 失败：
${r.out.slice(-1000)}`);
  console.log(`[android-build] ✅ ${out}（${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB）`);
}
// ---- 3. gradle assembleDebug/release ----
const task = production ? 'assembleRelease' : 'assembleDebug';
console.log(`[android-build] gradle ${task}…（首次可能下载 gradle 发行版，较慢）`);
const gradlew = os.platform() === 'win32' ? 'gradlew.bat' : 'gradlew';
const gradlewPath = path.join(ANDROID_DIR, gradlew);
if (!fs.existsSync(gradlewPath)) fail(`缺少 ${gradlew}（Android 工程未初始化？）`);
if (os.platform() !== 'win32') {
  try {
    fs.chmodSync(gradlewPath, 0o755);
  } catch { /* 忽略 */ }
}
const g = run(gradlew, [`:app:${task}`], {
  cwd: ANDROID_DIR,
  timeout: 0,
  shell: os.platform() === 'win32', // gradlew.bat 非原生 exe，Windows 必须 shell
});
if (!g.ok) fail(`gradle ${task} 失败：\n${g.out.slice(-1200)}`);

const apkDir = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', production ? 'release' : 'debug');
const apk = path.join(apkDir, `app-${production ? 'release' : 'debug'}.apk`);
console.log(`[android-build] ✅ 完成：${apk}（${fs.existsSync(apk) ? (fs.statSync(apk).size / 1024 / 1024).toFixed(1) : '?'} MB）`);
console.log('[android-build] 装到设备：node scripts/android-install.ts');
