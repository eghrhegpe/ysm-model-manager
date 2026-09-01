#!/usr/bin/env node
/**
 * 契约测试：check-go-diff-coverage 对平台/标签专属 bridge 文件的豁免行为。
 *
 * 根因：bridge_android/darwin/linux.go 带 `//go:build <os> && rust_backend`，当前宿主裸
 *   `go test` 不带对应 build tags 不编译它们，旧逻辑把 coverprofile 缺数据误判为 0% 覆盖，
 *   导致跨平台改一次桥接就被 pre-push 误拦。根治后用 `go list` 编译集 oracle 豁免：
 *   文件不在当前测试编译单元 = 环境不匹配 = 豁免；在编译单元却 0% = 真裸奔 = 照拦。
 *
 * 本测试动态挑选「非当前 GOOS」的 bridge 文件传入 --files，断言被 envMismatch 豁免且无失败，
 * 跨平台（win/linux/darwin/android）稳定：每平台都有 3 个他平台文件应被豁免。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runNode(args) {
  try { return execFileSync('node', args, { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { return e.stdout ?? ''; }
}
function runGo(args) {
  try { return execFileSync('go', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return process.platform; }
}

const goos = runGo(['env', 'GOOS']);

// 平台 → 桥接文件
const BRIDGE = {
  windows: 'bridge_windows.go',
  linux: 'bridge_linux.go',
  darwin: 'bridge_darwin.go',
  android: 'bridge_android.go',
};
const others = Object.entries(BRIDGE)
  .filter(([os]) => os !== goos)
  .map(([, f]) => `go/rustbridge/${f}`);

if (others.length === 0) {
  console.log('OK: 无他平台 bridge 文件可验（当前 GOOS 覆盖全部）');
  process.exit(0);
}

const out = runNode([
  'scripts/check-go-diff-coverage.ts',
  '--files', others.join(','),
  '--json',
]);
let json;
try {
  json = JSON.parse(out);
} catch {
  console.error(`FAIL: 无法解析 check-go-diff-coverage 输出:\n${out}`);
  process.exit(1);
}

const skipped = json.rows.filter((r) => r.envMismatch);
const failed = json._summary?.failed ?? -1;

if (skipped.length !== others.length) {
  console.error(`FAIL: 期望 ${others.length} 个非当前平台 bridge 被豁免，实际 ${skipped.length}`);
  console.error(`  others=${others.join(', ')}`);
  console.error(`  rows=${JSON.stringify(json.rows)}`);
  process.exit(1);
}
if (failed > 0) {
  console.error(`FAIL: 存在 ${failed} 个失败项（应全豁免）: ${JSON.stringify(json.failures)}`);
  process.exit(1);
}

console.log(`OK: GOOS=${goos} 下 ${skipped.length} 个平台专属 bridge 文件被正确豁免 (envMismatch)，无覆盖率误报拦截。`);
console.log('  ' + skipped.map((s) => s.file).join('\n  '));
process.exit(0);
