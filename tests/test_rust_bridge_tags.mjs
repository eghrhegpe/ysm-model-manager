#!/usr/bin/env node
/**
 * 契约测试：Rust bridge 跨平台 build tag 与 Entries 类型一致性。
 *
 * 背景（2026-08-25 修复）：bridge_darwin.go 曾误写 linux tag 导致 Linux 构建
 * redeclared / macOS 无实现；darwin/linux 的 Entries 兜底曾用 []interface{}{}
 * 与 types.ScanResponse.Entries（[]types.ModelEntry）不匹配，非 Windows 平台必编译错。
 * 本地 go build 只验 Windows 平台文件，此类漂移靠本测试拦截。
 * 2026-08-31 治理（ADR-139）：scanner 四平台变体 rust_backend_<os>.go 逐字相同，
 * 合并为单一 rust_backend.go（//go:build rust_backend 覆盖四端）；linux bridge 显式
 * 排除 android（GOOS=android 同时满足 linux 约束，否则安卓构建 redeclared）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_DIR = path.join(ROOT, 'go', 'rustbridge');
const SCANNER_DIR = path.join(ROOT, 'go', 'scanner');

// 各平台 bridge 文件的预期 build tag。linux 须显式排除 android：Go 的
// GOOS=android 同时满足 `linux` 构建约束，若不排除，安卓构建会同时纳入
// bridge_linux 与 bridge_android → nativeBuffer/Scan 等符号 redeclared（ADR-139）。
// 该预期值直接锁定 !android 守卫，任何人误删即被本测试拦截。
const BRIDGE_TAGS = {
  windows: 'windows && rust_backend',
  linux: 'linux && !android && rust_backend',
  darwin: 'darwin && rust_backend',
  android: 'android && rust_backend',
};

const errors = [];
const seenTags = new Map();

function firstLine(fp) {
  return fs.readFileSync(path.join(ROOT, fp), 'utf-8').split('\n')[0].trim();
}

// bridge 跨平台 build tag 校验（首行即 tag）
for (const [os, tag] of Object.entries(BRIDGE_TAGS)) {
  const rel = `go/rustbridge/bridge_${os}.go`;
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) {
    errors.push(`MISSING: ${rel}`);
    continue;
  }
  const got = firstLine(rel);
  if (got !== `//go:build ${tag}`) {
    errors.push(`${rel}: 首行 tag 应为 "//go:build ${tag}"，实际 "${got}"`);
  }
  // redeclared 只在同包内发生：按所在目录（包）判重
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
  ...Object.keys(BRIDGE_TAGS).map((os) => `go/rustbridge/bridge_${os}.go`),
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
