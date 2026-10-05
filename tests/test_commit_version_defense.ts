#!/usr/bin/env node
/**
 * test_commit_version_defense.ts — pre-commit「版本防御」块契约测试（ADR-323 阶段 1）。
 *
 * 下沉自 `.githooks/pre-commit` 内联 shell 段。本测试的存在本身即是本次下沉的收益：
 * 旧形态（sh 内联）无法被断言，边界只能靠注释提醒。
 *
 * 覆盖：
 *   1. `$` 开头文件名判定（行首 / 路径段 / 非行首 $ 不误报）
 *   2. Go 覆盖率 profile 首行判定（set/count/atomic 命中；其他 mode 与非 mode 行不误报）
 *   3. 跨层夹带计数（frontend/ + go/ 同时 >0 才报）
 *   4. 纯判定用注入读取器（b 项可在无真实文件下单测）
 *   5. 渲染文案含关键标识（防文案静默漂移导致钩子输出退化）
 *   6. 行为等价锚点：无发现时 hasFindings 为 false（钩子不输出噪音）
 */
import {
  detectVersionDefense,
  hasFindings,
  isDollarLeadingPath,
  isGoCoverageProfileFirstLine,
  renderVersionDefense,
} from "../scripts/_lib/commit-blocks/version-defense.ts";

const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails.push(name);
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

console.log("=== pre-commit 版本防御块契约 ===");

// ── 1. $ 开头文件名 ───────────────────────────────────
check("isDollarLeadingPath：行首 $ 命中", () => {
  assert(isDollarLeadingPath("$tmp"), "$tmp 应命中");
});
check("isDollarLeadingPath：路径段 $ 命中", () => {
  assert(isDollarLeadingPath("docs/$tmp"), "docs/$tmp 应命中");
});
check("isDollarLeadingPath：尾部 $ 不命中", () => {
  assert(!isDollarLeadingPath("docs/a$.md"), "非行首/段首 $ 不应命中");
});
check("isDollarLeadingPath：普通路径不命中", () => {
  assert(!isDollarLeadingPath("scripts/doctor.ts"), "普通路径不应命中");
});

// ── 2. Go 覆盖率 profile 首行 ─────────────────────────
check("isGoCoverageProfileFirstLine：三种 mode 命中", () => {
  for (const m of ["set", "count", "atomic"]) {
    assert(isGoCoverageProfileFirstLine(`mode: ${m}`), `mode: ${m} 应命中`);
  }
});
check("isGoCoverageProfileFirstLine：非覆盖率行不命中", () => {
  assert(!isGoCoverageProfileFirstLine("mode: foo"), "未知 mode 不应命中");
  assert(!isGoCoverageProfileFirstLine("package main"), "Go 源码首行不应命中");
  assert(!isGoCoverageProfileFirstLine("  mode: set"), "缩进行不应命中（须行首）");
  assert(!isGoCoverageProfileFirstLine(null), "null（文件不存在）不应命中");
});

// ── 3. 跨层夹带计数 ───────────────────────────────────
check("跨层夹带：frontend + go 同时 >0 才报", () => {
  const both = detectVersionDefense(["frontend/a.ts", "go/b.go"]);
  assert(both.frontendCount === 1 && both.goCount === 1, JSON.stringify(both));
  const onlyFront = detectVersionDefense(["frontend/a.ts"]);
  assert(!hasFindings(onlyFront), "仅前端改动不应有任何发现");
  const onlyGo = detectVersionDefense(["go/b.go"]);
  assert(!hasFindings(onlyGo), "仅 Go 改动不应有任何发现");
});

// ── 4. 注入读取器单测 b 项 ────────────────────────────
check("detectVersionDefense：注入读取器识别覆盖率 profile", () => {
  const files = ["profile.out", "main.go"];
  const contents: Record<string, string> = {
    "profile.out": "mode: atomic",
    "main.go": "package main",
  };
  const f = detectVersionDefense(files, (p) => contents[p] ?? null);
  assert(
    f.coverageProfiles.length === 1 && f.coverageProfiles[0] === "profile.out",
    JSON.stringify(f.coverageProfiles),
  );
});
check("detectVersionDefense：不传读取器则跳过 b 项（等价旧 shell 无文件跳过）", () => {
  const f = detectVersionDefense(["profile.out"]);
  assert(f.coverageProfiles.length === 0, "未注入读取器不应误报覆盖率 profile");
});

// ── 5. 渲染文案 ───────────────────────────────────────
check("renderVersionDefense：三查文案齐备", () => {
  const lines = renderVersionDefense({
    dollarFiles: ["$tmp"],
    coverageProfiles: ["coverage.out"],
    frontendCount: 2,
    goCount: 3,
  });
  const text = lines.join("\n");
  assert(text.includes("$ 开头文件名"), "应含 a 项标题");
  assert(text.includes("Go 覆盖率 profile"), "应含 b 项标题");
  assert(text.includes("frontend/(+2)") && text.includes("go/(+3)"), "应含 c 项计数");
});
check("renderVersionDefense：无发现时输出空", () => {
  const lines = renderVersionDefense({
    dollarFiles: [],
    coverageProfiles: [],
    frontendCount: 1,
    goCount: 0,
  });
  assert(lines.length === 0, `无发现应渲染为空，实际 ${JSON.stringify(lines)}`);
});

// ── 6. 行为等价：空集不产生噪音 ───────────────────────
check("hasFindings：空集为 false", () => {
  assert(
    !hasFindings({ dollarFiles: [], coverageProfiles: [], frontendCount: 0, goCount: 0 }),
    "空集应无发现",
  );
});

console.log(fails.length === 0 ? "\n✅ 全部通过" : `\n❌ ${fails.length} 组失败`);
if (fails.length > 0) process.exit(1);
