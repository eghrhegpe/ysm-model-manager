#!/usr/bin/env node
/**
 * check-go-coverage-threshold.ts — Go 覆盖率阈值门禁（包级最低函数覆盖率检查）。
 *
 * 依赖：node:child_process（go tool cover）/ node:fs / node:path / node:process +
 * 共享层 _lib/parse-args.ts；运行环境需 Go 工具链（go test -coverprofile 产物）。
 *
 * 检查项：解析 coverprofile 原文 → **按语句数加权**聚合到包 → 对每包取
 * DEFAULT_THRESHOLDS 与 --thresholds 的最高阈值比对；SKIP_PACKAGES 命中包跳过。
 *
 * ⚠️ 口径史（2026-09 修正，勿回退）：本门禁原用 `go tool cover -func` 的**逐函数百分比**，
 * 且把「文件内函数百分比的最小值」当文件分，再对文件求均值当包分。后果：一个 0% 函数
 * 就把整包拖到 0%——实测 19 个包被误判失败（go/watcher 报 0% 实为 82.9%，
 * go/instance 报 0% 实为 88.3%，go/scanner 报 0% 实为 90.0%）。
 * 现改为读 profile 原文按**语句数加权**（与 Go 官方 `go test -cover` 同口径），
 * 一个未覆盖的小函数不再代表整包。契约锁见 tests/test_check_go_coverage_threshold.ts。
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

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

export const DEFAULT_THRESHOLDS: ThresholdRule[] = [
  // 注意：包路径以包名结尾（无尾斜杠），故 install 规则须匹配 "internal/app/install" 本身
  // 及其子包——原 `"internal/app/install/"` 带尾斜杠，永远匹配不到该包自身，
  // 致其长期误用 internal/app/ 的 20% 而非此处意图的 50%（2026-09 修正）。
  { pattern: "internal/app/install", min: 50 },
  { pattern: "internal/app", min: 20 },
  { pattern: "go/", min: 50 },
  { pattern: "DEFAULT", min: 20 }, // 全局默认（无更具体规则命中时的下限）
];

/** 测试与 main 共用的默认阈值表别名。 */
export const DEFAULTS = DEFAULT_THRESHOLDS;

/** 一个 profile 覆盖块：归属文件 + 语句数 + 命中次数。 */
export interface CoverBlock {
  file: string;
  statements: number;
  count: number;
}

/** 包级语句加权聚合结果。 */
export interface PkgStatements {
  covered: number;
  total: number;
}

/**
 * 解析 coverprofile 原文为覆盖块列表。
 *
 * 格式（go test -coverprofile）：首行 `mode: set|count|atomic`，其后每行
 * `file:startLine.startCol,endLine.endCol numStmts count`。
 * 读**语句数**而非百分比，是语句加权聚合的前提（-func 输出不含语句数）。
 * 畸形行静默跳过——覆盖率产物不应让门禁崩在解析上。
 */
export function parseCoverProfileText(text: string): CoverBlock[] {
  const blocks: CoverBlock[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("mode:")) continue;
    // file:1.1,2.2 10 1 —— 文件路径可能含冒号（Windows 盘符）故用贪婪取到最后一个冒号段
    const match = trimmed.match(/^(.+):\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)$/);
    if (!match) continue;
    const statements = Number.parseInt(match[2]!, 10);
    const count = Number.parseInt(match[3]!, 10);
    if (Number.isNaN(statements) || Number.isNaN(count)) continue;
    blocks.push({ file: toPosix(match[1]!), statements, count });
  }
  return blocks;
}

/**
 * 按包聚合语句覆盖率（覆盖语句数 / 总语句数）。
 *
 * 包路径 = 文件路径去掉最后一段（ysm-model-manager/go/a/b.go → ysm-model-manager/go/a）。
 * 语句数跨文件累加——这是与 Go 官方 `go test -cover` 对齐的口径，
 * 也是「单个 0% 函数不拖垮整包」的保证。
 */
export function aggregateByPackage(blocks: CoverBlock[]): Map<string, PkgStatements> {
  const result = new Map<string, PkgStatements>();
  for (const b of blocks) {
    const parts = b.file.split("/");
    if (parts.length < 2) continue;
    const pkg = parts.slice(0, parts.length - 1).join("/");
    const acc = result.get(pkg) ?? { covered: 0, total: 0 };
    acc.total += b.statements;
    if (b.count > 0) acc.covered += b.statements;
    result.set(pkg, acc);
  }
  return result;
}

/** 包级语句加权百分比（total 为 0 时返回 0，避免 NaN 扩散进门禁判定）。 */
export function pkgPercent(s: PkgStatements): number {
  return s.total === 0 ? 0 : (s.covered / s.total) * 100;
}

/**
 * 解析某包的适用阈值：命中的**最具体**规则 与 全局下限取高值。
 * 规则表按具体度降序排列，首个命中即最具体（internal/app/install/ 先于 internal/app/）。
 */
export function resolveThreshold(
  pkg: string,
  thresholds: ThresholdRule[] = DEFAULT_THRESHOLDS,
  globalMin = 20,
): number {
  let min = globalMin;
  for (const rule of thresholds) {
    if (rule.pattern === "DEFAULT") continue;
    if (pkg.includes(rule.pattern)) {
      min = Math.max(min, rule.min);
      break;
    }
  }
  const defaultRule = thresholds.find((r) => r.pattern === "DEFAULT");
  if (defaultRule) min = Math.max(min, defaultRule.min);
  return min;
}

// 已知无可测试函数的包（如纯配置、纯 CLI 入口、生成代码等），跳过阈值检查
const SKIP_PACKAGES = [
  "ysm-model-manager/build/android/scripts/deps",
  "ysm-model-manager/cmd/updater",
  // 根包 = 桌面/CLI 入口（main.go 起 Wails 应用，测试内不可达）；可测部分
  // （mainWindowOptions / customJSMiddleware）已由 main_test.go 覆盖，
  // 但 main() 本体必然 0%，会把整包压到 10.5%——与 cmd/updater 同类，豁免。
  "ysm-model-manager",
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

/** 读 profile 文件并聚合为包级语句统计；读取失败抛出（由 main 兜底为 exit 1）。 */
function loadPackageStats(file: string): Map<string, PkgStatements> {
  return aggregateByPackage(parseCoverProfileText(readFileSync(file, "utf-8")));
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
    process.exitCode = 1;
    return;
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
    const pkgStats = loadPackageStats(coverFile);

    const results: PkgResult[] = [];
    for (const [pkg, stat] of pkgStats) {
      const pct = pkgPercent(stat);
      const skipped = SKIP_PACKAGES.includes(pkg);
      const minThreshold = skipped ? globalMin : resolveThreshold(pkg, thresholds, globalMin);
      results.push({ pkg, pct, min: minThreshold, ok: skipped || pct >= minThreshold, skipped });
    }

    // 总体 = 全仓语句加权（非包百分比均值——大包应有权重）
    let coveredTotal = 0;
    let statementsTotal = 0;
    for (const stat of pkgStats.values()) {
      coveredTotal += stat.covered;
      statementsTotal += stat.total;
    }
    const overall = statementsTotal === 0 ? 0 : (coveredTotal / statementsTotal) * 100;
    const hasFailure = results.some((r) => !r.ok);

    if (asJSON) {
      const failures = results
        .filter((r) => !r.ok)
        .map((r) => `${r.pkg}: ${r.pct.toFixed(1)}% < ${r.min}%`);
      console.log(JSON.stringify({ ok: !hasFailure, overall, packages: results, failures }));
      process.exitCode = hasFailure ? 1 : 0;
      return;
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
      process.exitCode = 1;
      return;
    }
    console.log("\n✅ 所有包覆盖率达标");
    process.exitCode = 0;
  } catch (e) {
    console.error("读取覆盖率文件失败:", e);
    process.exitCode = 1;
  }
}

// 直接 node 运行本文件时执行主逻辑；被测试 import 时只暴露具名导出（契约定点，
// 与 check-layering / check-menu-health 同惯例）。
//
// ⚠️ 退出方式：本脚本用 `process.exitCode = N` + 自然返回，**不用 process.exit(N)**。
// 具名导出使本模块可被契约测试 import（不再是 import 即跑完即退的裸 main()），
// 此时在 Windows 上 `exit()` 会在句柄清理阶段触发 libuv 断言
// （`!(handle->flags & UV_HANDLE_CLOSING)`，进程码 0xC0000409），
// 把「用法错误应退 1」变成崩溃。置 exitCode 让 Node 正常跑完退出流程，四类路径
// （达标 0 / 未达标 1 / 拼错 flag 1 / 文件缺失 1）均稳定。
const isMain =
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1] as string).href === import.meta.url;
if (isMain) main();
