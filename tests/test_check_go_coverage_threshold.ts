#!/usr/bin/env node
/**
 * 契约测试：scripts/check-go-coverage-threshold.ts 的聚合口径。
 *
 * 背景（2026-09 实证）：该门禁曾把「文件内所有函数百分比的**最小值**」当作文件
 * 覆盖率（`if (pct < existing) set(pct)`），再对文件求均值当作包覆盖率。后果是
 * 一个函数 0%（如 watcher.WaitReady——仅供测试调用、生产零调用的辅助方法）
 * 就把**整个包**拖到 0%。实测 19 个包因此被误判失败：go/watcher 报 0% 实为 82.9%，
 * go/instance 报 0% 实为 88.3%，go/scanner 报 0% 实为 90.0%。
 *
 * 正确口径 = **按语句数加权**（Go 官方 `go test -cover` 同口径）：覆盖语句数 / 总语句数。
 * 本测试以合成 profile 锁死该语义，使「一个 0% 函数 ≠ 整包 0%」不再回归。
 *
 * 依赖：node:assert / 被测脚本具名导出 / tests/_lib.mts。
 * 用法：node tests/test_check_go_coverage_threshold.ts
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  aggregateByPackage,
  DEFAULTS,
  parseCoverProfileText,
  resolveThreshold,
} from "../scripts/check-go-coverage-threshold.ts";
import { check, finish, SCRIPTS } from "./_lib.mts";

/** 合成 profile 行（go coverprofile 格式：file:startLine.startCol,endLine.endCol numStmts count）。 */
const row = (file: string, stmts: number, count: number) => `${file}:1.1,2.2 ${stmts} ${count}`;

check("解析 profile 文本：提取文件/语句数/命中数", () => {
  const text = [
    "mode: set",
    row("ysm-model-manager/go/watcher/watcher.go", 10, 1),
    row("ysm-model-manager/go/watcher/watcher.go", 5, 0),
  ].join("\n");
  const parsed = parseCoverProfileText(text);
  assert.strictEqual(parsed.length, 2, "应解析出 2 个覆盖块");
  assert.strictEqual(parsed[0]!.file, "ysm-model-manager/go/watcher/watcher.go");
  assert.strictEqual(parsed[0]!.statements, 10);
  assert.strictEqual(parsed[0]!.count, 1);
});

check("解析 profile 文本：跳过 mode 头与畸形行，不抛错", () => {
  const text = ["mode: set", "garbage line", "", row("a/b/c.go", 3, 1)].join("\n");
  const parsed = parseCoverProfileText(text);
  assert.strictEqual(parsed.length, 1);
});

check("核心断言：单函数 0% 不把整包拖到 0%（回归锁）", () => {
  // 复刻 watcher 真实形态：绝大多数语句被覆盖，仅一个小函数 0%。
  const text = [
    "mode: set",
    row("ysm-model-manager/go/watcher/watcher.go", 90, 1), // 90 条已覆盖
    row("ysm-model-manager/go/watcher/watcher.go", 2, 0), // WaitReady：2 条未覆盖
  ].join("\n");
  const pkgs = aggregateByPackage(parseCoverProfileText(text));
  const watcher = pkgs.get("ysm-model-manager/go/watcher");
  assert.ok(watcher, "应聚合出 go/watcher 包");
  const pct = (watcher!.covered / watcher!.total) * 100;
  // 旧口径会得 0%；正确口径 = 90/92 ≈ 97.8%
  assert.ok(pct > 90, `整包不应被单个 0% 函数拖垮，实际 ${pct.toFixed(1)}%`);
  assert.strictEqual(watcher!.total, 92, "总语句数应为各块之和");
  assert.strictEqual(watcher!.covered, 90, "覆盖语句数应为命中块之和");
});

check("聚合是语句加权，不是文件百分比均值（口径锁）", () => {
  // 文件 A：1 条语句全中（100%）；文件 B：99 条语句全未中（0%）。
  // 文件百分比均值 = (100+0)/2 = 50%；语句加权 = 1/100 = 1%。两者必须可区分。
  const text = ["mode: set", row("pkg/a.go", 1, 1), row("pkg/b.go", 99, 0)].join("\n");
  const pkgs = aggregateByPackage(parseCoverProfileText(text));
  const pkg = pkgs.get("pkg")!;
  const weighted = (pkg.covered / pkg.total) * 100;
  assert.ok(Math.abs(weighted - 1) < 0.001, `应为语句加权 1%，实际 ${weighted}%`);
  assert.notStrictEqual(Math.round(weighted), 50, "不得退化为文件百分比均值");
});

check("多文件同包：语句数跨文件累加", () => {
  const text = ["mode: set", row("pkg/a.go", 10, 1), row("pkg/b.go", 10, 0)].join("\n");
  const pkg = aggregateByPackage(parseCoverProfileText(text)).get("pkg")!;
  assert.strictEqual(pkg.total, 20);
  assert.strictEqual(pkg.covered, 10);
});

check("包路径 = 文件路径去掉最后一段", () => {
  const text = ["mode: set", row("ysm-model-manager/internal/app/install/q.go", 1, 1)].join("\n");
  const pkgs = aggregateByPackage(parseCoverProfileText(text));
  assert.ok(pkgs.has("ysm-model-manager/internal/app/install"));
});

check("阈值解析：最长/优先模式生效，且阈值取高", () => {
  // internal/app/install/ 比 internal/app/ 更具体，应命中 50 而非 20
  assert.strictEqual(resolveThreshold("ysm-model-manager/internal/app/install", DEFAULTS, 20), 50);
  assert.strictEqual(resolveThreshold("ysm-model-manager/internal/app", DEFAULTS, 20), 20);
  assert.strictEqual(resolveThreshold("ysm-model-manager/go/watcher", DEFAULTS, 20), 50);
  // 无特定规则命中 → 回落到 DEFAULT
  assert.strictEqual(resolveThreshold("ysm-model-manager/other", DEFAULTS, 20), 20);
});

check("阈值解析：--fail-on-below 抬高全局下限", () => {
  assert.strictEqual(resolveThreshold("ysm-model-manager/go/watcher", DEFAULTS, 80), 80);
  // 更具体规则高于全局时仍取高值
  assert.strictEqual(resolveThreshold("ysm-model-manager/other", DEFAULTS, 5), 20);
});

check("空 profile → 空聚合（不抛错、不产生假包）", () => {
  assert.strictEqual(aggregateByPackage(parseCoverProfileText("mode: set")).size, 0);
});

// ── 退出码契约（端到端 spawn，锁「用法错误退 1 而非崩溃」）──────────────────────
// 回归背景：本脚本改为具名导出后，若仍用 process.exit(N)，Windows 上会在句柄清理
// 阶段触发 libuv 断言（进程码 0xC0000409 = 3221226505），把「拼错 flag」这类用法
// 错误变成崩溃。改用 process.exitCode + 自然返回后四类路径稳定。本组断言即为此锁。
const SCRIPT = path.join(SCRIPTS, "check-go-coverage-threshold.ts");
const runGate = (...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf-8" });

check("退出码：缺 profile 文件 → 1（非崩溃码）", () => {
  const r = runGate("--cover-profile", "definitely-not-here.out");
  assert.strictEqual(r.status, 1, `应为 1，实际 ${r.status}`);
});

check("退出码：拼错 flag → 1（非崩溃码）", () => {
  const r = runGate("--definitely-bogus-flag");
  assert.strictEqual(r.status, 1, `应为 1，实际 ${r.status}`);
  assert.ok((r.stderr || "").includes("未知参数"), "应给出未知参数提示（白名单拦截）");
});

check("退出码：阈值抬到 99 → 1（真实未达标路径）", () => {
  const r = runGate("--fail-on-below", "99");
  assert.strictEqual(r.status, 1, `应为 1，实际 ${r.status}`);
});

check("无崩溃码：用法错误路径都不得返回 0xC0000409", () => {
  const CRASH = 3221226505; // STATUS_STACK_BUFFER_OVERRUN（libuv 断言）
  for (const args of [
    ["--cover-profile", "definitely-not-here.out"],
    ["--definitely-bogus-flag"],
  ]) {
    const r = runGate(...args);
    assert.notStrictEqual(r.status, CRASH, `${args.join(" ")} 崩溃（libuv 断言）`);
  }
});

finish("check-go-coverage-threshold 聚合口径契约");
