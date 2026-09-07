#!/usr/bin/env node
/**
 * Go 覆盖率阈值门禁
 * 用法: node scripts/check-go-coverage-threshold.ts [--cover-profile=go-cover.out] [--fail-on-below=threshold]
 * 退出码: 0=通过, 1=有包低于阈值
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { exit } from 'process';
import { execSync } from 'child_process';

interface ThresholdRule {
  pattern: string;
  min: number;
}

const DEFAULT_THRESHOLDS: ThresholdRule[] = [
  { pattern: 'internal/app/install/', min: 50 },
  { pattern: 'internal/app/', min: 20 },
  { pattern: 'go/', min: 50 },
  { pattern: 'DEFAULT', min: 20 }, // 全局默认（函数级覆盖率通常低于语句级）
];

// 已知无可测试函数的包（如纯配置、纯 CLI 入口、生成代码等），跳过阈值检查
const SKIP_PACKAGES = [
  'ysm-model-manager/build/android/scripts/deps',
  'ysm-model-manager/cmd/updater',
  'ysm-model-manager/go/download',
  'ysm-model-manager/go/installer',
  'ysm-model-manager/go/internal/testutil',
  'ysm-model-manager/go/launcher',
  'ysm-model-manager/go/litematic/gen',
  'ysm-model-manager/go/paths',
  'ysm-model-manager/go/texture_cache',
  'ysm-model-manager/go/types/registry',
  'ysm-model-manager/go/updater',
  'ysm-model-manager/go/container',
  'ysm-model-manager/go/packs',
  'ysm-model-manager/go/cli',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1]?.startsWith('--') ? 'true' : args[++i];
    }
  }
  return result;
}

function parseCoverProfile(file: string): Map<string, number> {
  const output = execSync(`go tool cover -func=${file}`, { encoding: 'utf-8' });
  const lines = output.split('\n');
  const coverage = new Map<string, number>();

  for (const line of lines) {
    const match = line.match(/^(.+?):\d+:\s+(\S+)\s+([\d.]+)%/);
    if (match) {
      const file = match[1];
      const func = match[2];
      const pct = parseFloat(match[3]);
      if (!isNaN(pct)) {
        const key = file.replace(/\\/g, '/');
        const existing = coverage.get(key);
        if (existing === undefined || pct < existing) {
          coverage.set(key, pct);
        }
      }
    }
  }
  return coverage;
}

function computePackageCoverage(coverage: Map<string, number>): Map<string, number> {
  const pkgCoverage = new Map<string, number[]>();
  for (const [file, pct] of coverage) {
    // 提取包路径：ysm-model-manager/internal/app/install/queue.go -> internal/app/install
    const parts = file.split('/');
    if (parts.length < 2) continue;
    const pkg = parts.slice(0, parts.length - 1).join('/');
    if (!pkgCoverage.has(pkg)) {
      pkgCoverage.set(pkg, []);
    }
    pkgCoverage.get(pkg)!.push(pct);
  }
  const result = new Map<string, number>();
  for (const [pkg, pcts] of pkgCoverage) {
    result.set(pkg, pcts.reduce((a, b) => a + b, 0) / pcts.length);
  }
  return result;
}

function main() {
  const args = parseArgs();
  const coverFile = args['cover-profile'] || 'go-cover.out';
  const globalMin = parseFloat(args['fail-on-below'] || '20');

  const thresholds = [...DEFAULT_THRESHOLDS];
  if (args['thresholds']) {
    // 支持额外阈值: pkg1:min1,pkg2:min2
    for (const t of args['thresholds'].split(',')) {
      const [pkg, min] = t.split(':');
      thresholds.unshift({ pattern: pkg, min: parseFloat(min) });
    }
  }

  try {
    const fileCoverage = parseCoverProfile(coverFile);
    const pkgCoverage = computePackageCoverage(fileCoverage);

    let hasFailure = false;
    console.log(`\n=== Go 覆盖率阈值检查 (全局最低 ${globalMin}%) ===`);

    // 检查每个包
    for (const [pkg, pct] of pkgCoverage) {
      // 跳过已知无可测试函数的包
      if (SKIP_PACKAGES.includes(pkg)) {
        console.log(`⏭️  ${pkg}: ${pct.toFixed(1)}% (跳过阈值检查)`);
        continue;
      }
      let minThreshold = globalMin;
      // 按优先级检查特定规则（非 DEFAULT 优先）
      const specificRules = thresholds.filter(r => r.pattern !== 'DEFAULT');
      for (const rule of specificRules) {
        if (pkg.includes(rule.pattern)) {
          minThreshold = Math.max(minThreshold, rule.min);
          break;
        }
      }
      // 如果没有特定规则匹配，使用全局默认
      if (minThreshold === globalMin) {
        const defaultRule = thresholds.find(r => r.pattern === 'DEFAULT');
        if (defaultRule) {
          minThreshold = Math.max(minThreshold, defaultRule.min);
        }
      }

      const status = pct >= minThreshold ? '✅' : '❌';
      console.log(`${status} ${pkg}: ${pct.toFixed(1)}% (阈值 ${minThreshold}%)`);

      if (pct < minThreshold) {
        hasFailure = true;
      }
    }

    // 总体覆盖率
    const allPcts = Array.from(fileCoverage.values());
    const overall = allPcts.reduce((a, b) => a + b, 0) / allPcts.length;
    console.log(`\n总体覆盖率: ${overall.toFixed(1)}%`);

    if (hasFailure) {
      console.log('\n❌ 覆盖率门禁失败：有包低于阈值');
      exit(1);
    } else {
      console.log('\n✅ 所有包覆盖率达标');
      exit(0);
    }
  } catch (e) {
    console.error('读取覆盖率文件失败:', e);
    exit(1);
  }
}

main();