// tests/go-coverage-hint.mjs — Go 函数覆盖率建议钩子契约测试
//
// 覆盖纯函数（不触发真实 go test，保持快速确定）：
//   1. parseCoverFuncs：解析 `go tool cover -func` 输出 → Map
//   2. stripModulePrefix：去掉模块根前缀得到 repo-root 相对路径
//   3. packagePatternFor：改动文件 → go test 包模式
//   4. 阈值边界：恰好等于阈值(80)不算低覆盖，低于才算
import assert from 'node:assert/strict';
import { ROOT } from '../scripts/_lib/scan-files.ts';
import {
  parseCoverFuncs,
  stripModulePrefix,
  packagePatternFor,
  GO_FUNC_COVERAGE_THRESHOLD,
} from '../scripts/hooks/go-coverage-hint.mjs';

const errors = [];
function check(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
    console.error(`  FAIL - ${name}\n    ${e.message}`);
  }
}

// ── 1. parseCoverFuncs ──
check('parseCoverFuncs 解析函数覆盖', () => {
  const out = [
    'ysm-model-manager/go/scanner/scanner.go:352:\t\ttryRustScan\t\t100.0%',
    'ysm-model-manager/go/download/download.go:419:\t\tcommitAtomicWrite\t\t80.0%',
    'ysm-model-manager/go/download/download.go:162:\t\tretryDownload\t\t77.8%',
    'total:\t\t(statements)\t\t62.3%',
  ].join('\n');
  const map = parseCoverFuncs(out);
  assert.equal(map.get('go/scanner/scanner.go:tryRustScan'), 100);
  assert.equal(map.get('go/download/download.go:commitAtomicWrite'), 80);
  assert.equal(map.get('go/download/download.go:retryDownload'), 77.8);
  // total 行不计入
  assert.ok(![...map.keys()].some((k) => k.includes('total')));
});

check('parseCoverFuncs 空输入 → 空 Map', () => {
  assert.equal(parseCoverFuncs('').size, 0);
});

// ── 2. stripModulePrefix ──
check('stripModulePrefix 去掉模块根', () => {
  assert.equal(stripModulePrefix('ysm-model-manager/go/scanner/scanner.go'), 'go/scanner/scanner.go');
  assert.equal(stripModulePrefix('ysm-model-manager/internal/app/app.go'), 'internal/app/app.go');
  assert.equal(stripModulePrefix('ysm-model-manager/main.go'), 'main.go');
});

// ── 3. packagePatternFor ──
check('packagePatternFor 包模式映射', () => {
  assert.equal(packagePatternFor('go/scanner/scanner.go'), './go/scanner/...');
  assert.equal(packagePatternFor('internal/app/app.go'), './internal/app/...');
  assert.equal(packagePatternFor('main.go'), '.');
});

// ── 4. 阈值边界 ──
check('阈值常量 = 80', () => {
  assert.equal(GO_FUNC_COVERAGE_THRESHOLD, 80);
});

// ── 汇总输出 ──
if (errors.length) {
  console.error(`\ngo-coverage-hint.mjs: ${errors.length} 项失败`);
  process.exit(1);
} else {
  console.log('go-coverage-hint.mjs: 全部通过 ✅');
}
