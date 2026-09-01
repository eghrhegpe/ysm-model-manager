#!/usr/bin/env node
/**
 * 编译 Rust scanner bridge 为 staticlib（.a），供 Go CGO 静态链接。
 * 由 build/linux/Taskfile.yml 的 compile:rust 任务调用。
 *
 * 用法：
 *   node scripts/compile-rust-static.ts              # 当前平台 native
 *   node scripts/compile-rust-static.ts --target x86_64-unknown-linux-gnu
 *   node scripts/compile-rust-static.ts --target aarch64-unknown-linux-gnu
 *
 * 依赖：cargo + 目标平台 target（rustup target add <triple>）
 *
 * 退出码：0 成功；1 失败（cargo 缺失、target 未装、编译错误）。
 *
 * 设计意图：Linux 构建链的 Rust 侧单步——编 staticlib 供 Go CGO 静态链接，
 * build/linux/Taskfile.yml 的 compile:rust 任务调用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.ts';
import { run } from './_lib/proc.ts';

const ROOT = getRoot();
const RUST_DIR = path.join(ROOT, 'rust-wails-bridge');
const OUTPUT_DIR = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : path.join(ROOT, 'go', 'rustbridge', 'static-lib');

const targetArg = process.argv.find(a => a.startsWith('--target='))?.split('=')[1]
  ?? (process.argv.indexOf('--target') >= 0 ? process.argv[process.argv.indexOf('--target') + 1] : undefined);

function fail(msg: string) {
  console.error(`[compile-rust-static] ${msg}`);
  process.exit(1);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const cargoArgs = ['build', '--release', '--locked',
  '--manifest-path', path.join(RUST_DIR, 'Cargo.toml'),
  '--lib'];
if (targetArg) cargoArgs.push('--target', targetArg);

console.log(`[compile-rust-static] cargo build` + (targetArg ? ` --target=${targetArg}` : '') + ` → ${OUTPUT_DIR}`);
const r = run('cargo', cargoArgs, { cwd: ROOT, timeout: 120_000 });
if (!r.ok) fail(`cargo build 失败：
${r.out.slice(-800)}`);

// 查找产物：Unix 用 .a，Windows MSVC 用 .lib（统一复制为 .a 供 Go -l: 使用）
const targetDir = targetArg ? path.join(RUST_DIR, 'target', targetArg, 'release') : path.join(RUST_DIR, 'target', 'release');
// .rlib 是 Rust 静态库（Go CGO 可直链）；.a 是 Unix ar 归档；.lib 是 MSVC import lib（太大、不可直链）
const candidateFiles = [
  path.join(targetDir, 'libysm_model_manager_wails_bridge.rlib'),
  path.join(targetDir, 'libysm_model_manager_wails_bridge.a'),
];
const libFile = candidateFiles.find(f => fs.existsSync(f));
if (!libFile) fail(`静态库未找到，已搜索: \n  [REDACTED]`);
// 统一输出为 libysm_model_manager_wails_bridge.a（Go -l: 期望的命名）
const outName = 'libysm_model_manager_wails_bridge.a';
fs.copyFileSync(libFile!, path.join(OUTPUT_DIR, outName));
console.log(`[compile-rust-static] ✅ ${path.join(OUTPUT_DIR, outName)}（源: ${path.basename(libFile!)}，${(fs.statSync(libFile!).size / 1024 / 1024).toFixed(1)} MB）`);
