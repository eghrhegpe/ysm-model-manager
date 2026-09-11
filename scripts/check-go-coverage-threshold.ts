#!/usr/bin/env node
/**
 * check-go-coverage-threshold.ts — Go 覆盖率阈值门禁（包级最低函数覆盖率检查）。
 *
 * 依赖：node:child_process（go tool cover）/ node:fs / node:path / node:process +
 * 共享层 _lib/parse-args.ts；运行环境需 Go 工具链（go test -coverprofile 产物）。
 *
 * 检查项：解析 `go tool cover -func=<profile>` 输出 → 按包聚合函数级覆盖率 →
 * 对每包取 DEFAULT_THRESHOLDS 与 --thresholds 的最高阈值比对；SKIP_PACKAGES 命中包跳过。
 *
 * 用法：
 *   node scripts/check-go-coverage-threshold.ts                                # 文本报告，cover-profile 默认 go-cover.out
 *   node scripts/check-go-coverage-threshold.ts --cover-profile go-cover.out --fail-on-below 20
 *   node scripts/check-go-coverage-threshold.ts --thresholds internal/app/:30  # 追加特定包阈值
 *   node scripts/check-go-coverage-threshold.ts --json                         # JSON（CI / 子代理稳定消费）
 *
 * 退出码：有包低于阈值 → 1；否则 0（读取失败同样退 1）。
 * 设计意图：go test -coverprofile 后拦截「改动把某包覆盖率拖低」的静默回归（doctor / pre-push 接线）。
 */

import { execSync } from "node:child_process";
import { exit } from "node:process";

import { parseArgs } from "./_lib/parse-args.ts";
import { toPosix } from "./_lib/to-posix.ts";

interface ThresholdRule {
  pattern: string;
  min: number;
}

interface PkgResult {
  pkg: string;
  pct: number;
  min: number;
  ok: boolean;
  skipped: boolean;
}

const DEFAULT_THRESHOLDS: ThresholdRule[] = [
  { pattern: "internal/app/install/", min: 50 },
  { pattern: "internal/app/", min: 20 },
  { pattern: "go/", min: 50 },
  { pattern: "DEFAULT", min: 20 }, // 全局默认（函数级覆盖率通常低于语句级）
];

// 已知无可测试函数的包（如纯配置、纯 CLI 入口、生成代码等），跳过阈值检查
const SKIP_PACKAGES = [
  "ysm-model-manager/build/android/scripts/deps",
  "ysm-model-manager/cmd/updater",
  "ysm-model-manager/go/download",
  "ysm-model-manager/go/installer",
  "ysm-model-manager/go/internal/testutil",
  "ysm-model-manager/go/launcher",
  "ysm-model-manager/go/litematic/gen",
  "ysm-model-manager/go/paths",
  "ysm-model-manager/go/texture_cache",
  "ysm-model-manager/go/types/registry",
  "ysm-model-manager/go/updater",
  "ysm-model-manager/go/container",
  "ysm-model-manager/go/packs",
  "ysm-model-manager/go/cli",
];

function parseCoverProfile(file: string): Map<string, number> {
  const output = execSync(`go tool cover -func=${file}`, { encoding: "utf-8" });
  const lines = output.split("\n");
  const coverage = new Map<string, number>();

  for (const line of lines) {
    const match = line.match(/^(.+?):\d+:\s+(\S+)\s+([\d.]+)%/);
    if (!match) continue;
    const filePath = match[1]!;
    const pct = parseFloat(match[3]!);
    if (Number.isNaN(pct)) continue;
    const key = toPosix(filePath);
    const existing = coverage.get(key);
    if (existing === undefined || pct < existing) {
      coverage.set(key, pct);
    }
  }
  return coverage;
}

function computePackageCoverage(coverage: Map<string, number>): Map<string, number> {
  const pkgCoverage = new Map<string, number[]>();
  for (const [file, pct] of coverage) {
    // 提取包路径：ysm-model-manager/internal/app/install/queue.go -> internal/app/install
    const parts = file.split("/");
    if (parts.length < 2) continue;
    const pkg = parts.slice(0, parts.length - 1).join("/");
    if (!pkgCoverage.has(pkg)) {
      pkgCoverage.set(pkg, []);
    }
    pkgCoverage.get(pkg)?.push(pct);
  }
  const result = new Map<string, number>();
  for (const [pkg, pcts] of pkgCoverage) {
    result.set(pkg, pcts.reduce((a, b) => a + b, 0) / pcts.length);
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ["json"],
    strings: ["cover-profile", "fail-on-below", "thresholds"],
    defaults: { "cover-profile": "go-cover.out", "fail-on-below": "20" },
  });
  const coverFile = (args["cover-profile"] as string) || "go-cover.out";
  const globalMin = parseFloat((args["fail-on-below"] as string) || "20");
  const asJSON = args.json === true;

  // 未知参数白名单拦截（对齐致命陷阱 #12）：拼错 flag 立即失败而非静默走默认
  if (args.unknown.length > 0) {
    console.error(`未知参数: ${args.unknown.join(", ")}`);
    exit(1);
  }

  const thresholds = [...DEFAULT_THRESHOLDS];
  const extraThresholds = args.thresholds as string | null;
  if (extraThresholds) {
    // 支持额外阈值: pkg1:min1,pkg2:min2
    for (const t of extraThresholds.split(",")) {
      const parts = t.split(":");
      if (parts.length < 2) continue;
      thresholds.unshift({ pattern: parts[0]!, min: parseFloat(parts[1]!) });
    }
  }

  try {
    const fileCoverage = parseCoverProfile(coverFile);
    const pkgCoverage = computePackageCoverage(fileCoverage);

    const results: PkgResult[] = [];
    for (const [pkg, pct] of pkgCoverage) {
      const skipped = SKIP_PACKAGES.includes(pkg);
      let minThreshold = globalMin;
      if (!skipped) {
        // 按优先级检查特定规则（非 DEFAULT 优先）
        for (const rule of thresholds) {
          if (rule.pattern !== "DEFAULT" && pkg.includes(rule.pattern)) {
            minThreshold = Math.max(minThreshold, rule.min);
            break;
          }
        }
        // 没有特定规则匹配 → 使用 DEFAULT 阈值
        if (minThreshold === globalMin) {
          const defaultRule = thresholds.find((r) => r.pattern === "DEFAULT");
          if (defaultRule) {
            minThreshold = Math.max(minThreshold, defaultRule.min);
          }
        }
      }
      results.push({ pkg, pct, min: minThreshold, ok: skipped || pct >= minThreshold, skipped });
    }

    const allPcts = Array.from(fileCoverage.values());
    const overall = allPcts.length === 0 ? 0 : allPcts.reduce((a, b) => a + b, 0) / allPcts.length;
    const hasFailure = results.some((r) => !r.ok);

    if (asJSON) {
      const failures = results
        .filter((r) => !r.ok)
        .map((r) => `${r.pkg}: ${r.pct.toFixed(1)}% < ${r.min}%`);
      console.log(JSON.stringify({ ok: !hasFailure, overall, packages: results, failures }));
      exit(hasFailure ? 1 : 0);
    }

    console.log(`\n=== Go 覆盖率阈值检查 (全局最低 ${globalMin}%) ===`);
    for (const r of results) {
      if (r.skipped) {
        console.log(`⏭️  ${r.pkg}: ${r.pct.toFixed(1)}% (跳过阈值检查)`);
      } else {
        const status = r.ok ? "✅" : "❌";
        console.log(`${status} ${r.pkg}: ${r.pct.toFixed(1)}% (阈值 ${r.min}%)`);
      }
    }
    console.log(`\n总体覆盖率: ${overall.toFixed(1)}%`);

    if (hasFailure) {
      console.log("\n❌ 覆盖率门禁失败：有包低于阈值");
      exit(1);
    }
    console.log("\n✅ 所有包覆盖率达标");
    exit(0);
  } catch (e) {
    console.error("读取覆盖率文件失败:", e);
    exit(1);
  }
}

main();
