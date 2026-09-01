#!/usr/bin/env node
/**
 * 编译 Rust scanner bridge 为 Android staticlib（.a），供 Go CGO 链接。
 * 由 android-build.ts 在 Go 交叉编译之前调用。
 *
 * 依赖：cargo + aarch64-linux-android target（rustup target add aarch64-linux-android）
 *       NDK21+（只需 clang ar，实际用 rustup 的 rust-ar）
 *
 * 用法：
 *   node scripts/compile-android-rust.ts          # arm64（真机）
 *   node scripts/compile-android-rust.ts --arch amd64  # x86_64（模拟器）
 *   node scripts/compile-android-rust.ts --arch all    # fat（两者都编）
 *
 * 退出码：0 成功；1 失败（cargo/NDK 缺失、编译错误）。
 *
 * 设计意图：Android 构建链的 Rust 侧单步——把 scanner bridge 编成 .a 静态库
 * 供 Go CGO 链接，android-build.ts 在交叉编译前自动调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.ts';
import { run } from './_lib/proc.ts';

const ROOT = getRoot();
const RUST_DIR = path.join(ROOT, 'rust-wails-bridge');
const OUTPUT_DIR = path.join(ROOT, 'go', 'rustbridge', 'android-lib');
const JNI_BASE = path.join(ROOT, 'build', 'android', 'app', 'src', 'main', 'jniLibs');

// ABI → Rust target triple
const ARCHES = {
  arm64: { rustTarget: 'aarch64-linux-android', abi: 'arm64-v8a' },
  amd64: { rustTarget: 'x86_64-linux-android', abi: 'x86_64' },
};

function fail(msg) {
  console.error(`[compile-android-rust] ${msg}`);
  process.exit(1);
}

// ---- 参数解析 ----
const argv = process.argv.slice(2);
if (argv.includes('--help')) {
  console.log(`用法:
  node scripts/compile-android-rust.ts               arm64（真机）
  node scripts/compile-android-rust.ts --arch amd64  x86_64（模拟器）
  node scripts/compile-android-rust.ts --arch all    fat APK（两者）`);
  process.exit(0);
}
const archArg = argv.find(a => a.startsWith('--arch='))?.split('=')[1] ?? (argv.indexOf('--arch') >= 0 ? argv[argv.indexOf('--arch') + 1] : undefined) ?? 'arm64';
if (!(archArg in ARCHES) && archArg !== 'all') fail(`未知架构: ${archArg}（可选 arm64/amd64/all）`);
const arches = archArg === 'all' ? Object.keys(ARCHES) : [archArg];

// ---- 前置：确保 rustup target 已安装 ----
console.log('[compile-android-rust] 检查 Rust Android targets …');
const targets = run('rustup', ['target', 'list', '--installed'], { cwd: ROOT });
for (const arch of arches) {
  const target = ARCHES[arch].rustTarget;
  if (!targets.out.includes(target)) {
    console.log(`[compile-android-rust] 安装 target: ${target}`);
    const r = run('rustup', ['target', 'add', target], { cwd: ROOT, timeout: 60_000 });
    if (!r.ok) fail(`rustup target add ${target} 失败：
${r.out.slice(-400)}`);
  }
}

// ---- 编译 ----
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
for (const arch of arches) {
  const a = ARCHES[arch];
  const outLib = path.join(OUTPUT_DIR, `libysm_model_manager_wails_bridge_${a.abi}.a`);
  console.log(`[compile-android-rust] 编译 ${arch}（${a.rustTarget}）…`);
  const r = run('cargo', [
    'build', '--release', '--locked',
    '--manifest-path', path.join(RUST_DIR, 'Cargo.toml'),
    '--target', a.rustTarget,
    '--lib',  // 只编 lib（staticlib crate type），不编 cdylib
  ], {
    cwd: ROOT,
    timeout: 120_000,
    env: { CARGO_TARGET_DIR: path.join(RUST_DIR, 'target') },
  });
  if (!r.ok) fail(`cargo build ${arch} 失败：
${r.out.slice(-800)}`);

  // cargo 产出路径: rust-wails-bridge/target/<target-triple>/release/libysm_model_manager_wails_bridge.a
  const cargoOut = path.join(RUST_DIR, 'target', a.rustTarget, 'release', 'libysm_model_manager_wails_bridge.a');
  if (!fs.existsSync(cargoOut)) fail(`静态库未找到: ${cargoOut}`);

  fs.copyFileSync(cargoOut, outLib);
  console.log(`[compile-android-rust] ✅ ${outLib}（${(fs.statSync(outLib).size / 1024).toFixed(1)} KB）`);
}

// ---- 同步到 jniLibs（供 gradle 打包时直接可见，调试用）----
for (const arch of arches) {
  const a = ARCHES[arch];
  const src = path.join(OUTPUT_DIR, `libysm_model_manager_wails_bridge_${a.abi}.a`);
  const dst = path.join(JNI_BASE, a.abi, 'libysm_model_manager_wails_bridge.a');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`[compile-android-rust] 📋 ${dst}`);
}

console.log('[compile-android-rust] ✅ 完成，Go 交叉编译时 -L' + OUTPUT_DIR + ' 链接。');
