#!/usr/bin/env node
/**
 * 契约测试：check-redlines R15 纯核 redlineCodeGapHits —— CODE_KEYS 漂移前向闸判别力。
 *
 * 背景（第三轮审计 D4 拍板批的机器哨兵，2026-10-12 立法）：Go `Code: types.ErrX`
 * 产出的错误码若不在前端 CODE_KEYS 映射表内，到 friendlyError 必走「Reason 中文透传」
 * ——en/ja 泄漏中文（D1 的 D4 侧残余成因）。本闸两侧解析（前端映射集 / Go 常量名→
 * 蛇形键表）任一退化即静默假绿，故必须独立重导对账（同 test_redlines_changed_files /
 * innerhtml-hygiene 惯例，不依赖真仓碰巧绿）。
 *
 * 零依赖（node:assert / node:child_process / node:fs / node:path / node:url）。
 * 运行：node tests/test_redlines_code_gap.ts
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redlineCodeGapHits } from "../scripts/check-redlines.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    fails.push(`${name}: ${(e as Error).message}`);
    console.error("✗", name, "-", (e as Error).message);
  }
}

// —— 独立重导（不走被测纯核的代码路径，仅共享同一事实源文件）——
function mappedKeys(): Set<string> {
  const fe = fs.readFileSync(path.join(ROOT, "frontend/src/utils/dom/errors.ts"), "utf-8");
  const block = fe.match(/const CODE_KEYS[^{]*\{([\s\S]*?)\n\};/);
  assert.ok(block, "CODE_KEYS 块解析失效（闸的头一种死法：前端映射集读空 → 恒不命中假绿）");
  const set = new Set<string>();
  for (const m of block![1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)) set.add(m[1]!);
  assert.ok(set.size >= 8, `映射集应 ≥8 键，实得 ${set.size}（骤降 = 正则失配）`);
  return set;
}
function constToKey(): Map<string, string> {
  const gt = fs.readFileSync(path.join(ROOT, "go/types/types.go"), "utf-8");
  const map = new Map<string, string>();
  for (const m of gt.matchAll(/(Err\w+)\s+ErrorCode\s*=\s*"([A-Z][A-Z0-9_]*)"/g)) {
    map.set(m[1]!, m[2]!);
  }
  assert.ok(map.size >= 15, `types.go 常量表应 ≥15 码，实得 ${map.size}（骤降 = 表解析失效）`);
  return map;
}
function productionSites(): Array<{ file: string; line: number; constName: string }> {
  // rg 直扫产出点（与纯核同款模式、独立调用）
  const out = execFileSync(
    "rg",
    [
      "--no-heading",
      "-n",
      "--path-separator",
      "/",
      "Code: (types\\.)?Err\\w+",
      "go",
      "internal/app",
      "-g",
      "*.go",
    ],
    { cwd: ROOT, encoding: "utf-8" },
  );
  const rows: Array<{ file: string; line: number; constName: string }> = [];
  for (const l of out.split("\n")) {
    if (!l.trim()) continue;
    const idx1 = l.indexOf(":");
    const idx2 = l.indexOf(":", idx1 + 1);
    if (idx1 < 0 || idx2 < 0) continue;
    const file = l.slice(0, idx1);
    const line = Number(l.slice(idx1 + 1, idx2));
    if (file.includes("_test.go")) continue;
    const rest = l.slice(idx2 + 1);
    if (/^\s*(?:\/\/|\*|\/\*)/.test(rest)) continue; // 注释行
    const m = rest.match(/Code: (?:types\.)?(Err\w+)/);
    if (m) rows.push({ file, line, constName: m[1]! });
  }
  return rows;
}

/* ---------- 1. 独立重导 ↔ 被测纯核 对账 ---------- */

check("对账：纯核命中集 == 独立重导的「产出键 − 映射键」集（逐行等值）", () => {
  const mapped = mappedKeys();
  const table = constToKey();
  const expected = productionSites()
    .filter((s) => {
      const key = table.get(s.constName);
      return key !== undefined && !mapped.has(key);
    })
    .map((s) => `${s.file}:${s.line}`)
    .sort();
  const got = redlineCodeGapHits()
    .map((l) => {
      const i = l.indexOf(":");
      const j = l.indexOf(":", i + 1);
      return `${l.slice(0, i)}:${l.slice(i + 1, j)}`;
    })
    .sort();
  assert.deepEqual(got, expected, "命中集与独立推导不一致（任一侧解析漂移即红）");
  // 注：不断言「命中非空」——7 差集码若被全量映射（D1/D4 终局清偿），零命中是合法
  // 终态而非空转；防空转职责在两侧解析的显式下限（mapped ≥8 / table ≥15）与 rg
  // 直扫失败即抛，不靠存量数字（硬计数必腐，ADR-162 精神）。
});

check("已映射码零误报 + 注释/测试排除", () => {
  const mapped = mappedKeys();
  const table = constToKey();
  const hits = redlineCodeGapHits();
  for (const l of hits) {
    const m = l.match(/Code: (?:types\.)?(Err\w+)/);
    assert.ok(m, `命中行必含 Code: ErrX（${l.slice(0, 60)}）`);
    const key = table.get(m![1]!);
    assert.ok(key && !mapped.has(key), `命中键 ${key} 竟在映射集内 = 误报`);
    assert.ok(!l.includes("_test.go"), "测试文件不得命中");
    assert.ok(!/:\d+:\s*(?:\/\/|\*|\/\*)/.test(l), "注释行不得命中");
  }
});

check("判别力方向：给已映射码加产出点不误报（哨兵只盯差集）", () => {
  // INVALID_PATH（D4 主战场、已映射）在 app_files.go 有产出——必须不在命中集
  const hits = redlineCodeGapHits();
  assert.ok(
    !hits.some((l) => l.includes("ErrInvalidPath")),
    "已映射 ErrInvalidPath 被报 = 映射集解析失效",
  );
});

if (fails.length > 0) {
  console.error(`\n${fails.length} 项失败:`);
  for (const f of fails) console.error("  -", f);
  process.exit(1);
}
console.log("\n全部通过");
