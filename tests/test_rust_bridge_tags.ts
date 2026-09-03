#!/usr/bin/env node
/**
 * 契约测试：Rust bridge 跨平台 build tag 与 Entries 类型一致性。
 *
 * 背景（2026-08-25 修复）：bridge_darwin.go 曾误写 linux tag 导致 Linux 构建
 * 重声明 / macOS 无实现；darwin/linux 的 Entries 兜底曾用 []interface{}{}
 * 与 types.ScanResponse.Entries（[]types.ModelEntry）不匹配，非 Windows 平台必编译错。
 * 本地 go build 只验 Windows 平台文件，此类漂移靠本测试拦截。
 * 2026-08-31 治理（ADR-139）：scanner 四平台变体 rust_backend_<os>.go 逐字相同，
 * 合并为单一 rust_backend.go（//go:build rust_backend 覆盖四端）；linux bridge 显式
 * 排除 android（GOOS=android 同时满足 linux 约束，否则安卓构建 redeclared）。
 * 2026-09-03 L2 合并（ADR-139 §2）：bridge_{darwin,linux,android}.go 三份 CGO 文件
 * 去注释后逐字相同（含 C 前导块），合并为单一 bridge_cgo.go（//go:build
 * (darwin || linux || android) && rust_backend）。bridge_windows.go 单列（syscall/DLL，
 * 无 cgo，实现真实不同）。合并后 android 撞车由构造消失，无需 !android 守卫。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_DIR = path.join(ROOT, 'go', 'rustbridge');
const SCANNER_DIR = path.join(ROOT, 'go', 'scanner');

// 各平台 bridge 文件的预期 build tag。
// bridge_cgo.go 用 (darwin || linux || android) && rust_backend 覆盖三端 CGO 平台；
// GOOS=android 同时满足 linux 约束——单文件构造上消除 android 撞车，无需 !android 守卫。
// bridge_windows.go 单独处理（syscall/DLL，无 cgo，实现真实不同）。
const BRIDGE_TAGS = {
  windows: 'windows && rust_backend',
  cgo: '(darwin || linux || android) && rust_backend',
};

const errors = [];
const seenTags = new Map();

function firstLine(fp) {
  return fs.readFileSync(path.join(ROOT, fp), 'utf-8').split('\n')[0].trim();
}

// bridge 跨平台 build tag 校验（首行即 tag）
const BRIDGE_FILES = [
  'go/rustbridge/bridge_windows.go',
  'go/rustbridge/bridge_cgo.go',
];
for (const rel of BRIDGE_FILES) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) {
    errors.push(`MISSING: ${rel}`);
    continue;
  }
  const key = rel.includes('windows') ? 'windows' : 'cgo';
  const tag = BRIDGE_TAGS[key];
  const got = firstLine(rel);
  if (got !== `//go:build ${tag}`) {
    errors.push(`${rel}: 首行 tag 应为 "//go:build ${tag}"，实际 "${got}"`);
  }
  const pkg = path.dirname(rel);
  if (seenTags.has(pkg + '\u0000' + tag)) {
    errors.push(`${rel}: tag "${tag}" 与 ${seenTags.get(pkg + '\u0000' + tag)} 重复 → 同包构建时 redeclared`);
  }
  seenTags.set(pkg + '\u0000' + tag, rel);
}

// scanner 侧：四平台变体已合并为单一 rust_backend.go（ADR-139 §2 L2 实证逐字相同），
// 由 //go:build rust_backend 覆盖全部平台；未启用 rust_backend 时由 stub 兜底。
const SCANNER_TAGS = {
  'go/scanner/rust_backend.go': 'rust_backend',
  'go/scanner/rust_backend_stub.go': '!rust_backend',
};
for (const [rel, tag] of Object.entries(SCANNER_TAGS)) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) {
    errors.push(`MISSING: ${rel}`);
    continue;
  }
  const got = firstLine(rel);
  if (got !== `//go:build ${tag}`) {
    errors.push(`${rel}: 首行 tag 应为 "//go:build ${tag}"，实际 "${got}"`);
  }
}

// Entries 兜底类型必须与 types.ScanResponse.Entries 一致（bridge + scanner 全部文件）
const allFiles = [
  ...BRIDGE_FILES,
  ...Object.keys(SCANNER_TAGS),
];
for (const rel of allFiles) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) continue;
  const text = fs.readFileSync(fp, 'utf-8');
  if (/Entries\s*=\s*\[\]interface\{\}/.test(text)) {
    errors.push(`${rel}: Entries 兜底禁止 []interface{}{}（types.ScanResponse.Entries 是 []types.ModelEntry）`);
  }
}

if (errors.length) {
  console.error(`FAILED: ${errors.length} issue(s)\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log('OK: rust bridge build tags + Entries type parity checks passed');
