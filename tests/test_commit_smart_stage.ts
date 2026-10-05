#!/usr/bin/env node
/**
 * test_commit_smart_stage.ts — pre-commit「智能 stage」块契约测试（ADR-323 阶段 2）。
 *
 * 覆盖：
 *   1. 后缀剥离语义（含**已知缺陷等价性锚点**：`.d.ts` → `foo.d`，见 ADR-323 §4）
 *   2. 不套娃（测试/规格文件自身不参与推导）
 *   3. 仅当对应测试文件**存在**才纳入（防误 stage）
 *   4. 双扩展名优先级（.test.ts 与 .test.js 并存时按序全收）
 *   5. 去重与顺序稳定
 *   6. 空输入 / 无命中 → 空清单（钩子静默，无噪音）
 */
import {
  deriveTestTargets,
  isTestOrSpecFile,
  stripSourceSuffix,
} from "../scripts/_lib/commit-blocks/smart-stage.ts";

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

console.log("=== pre-commit 智能 stage 块契约 ===");

// ── 1. 后缀剥离（含缺陷锚点）──────────────────────────
check("stripSourceSuffix：常规 .ts/.js", () => {
  assert(stripSourceSuffix("foo.ts") === "foo", stripSourceSuffix("foo.ts"));
  assert(stripSourceSuffix("plain.js") === "plain", stripSourceSuffix("plain.js"));
});
check("stripSourceSuffix：多段点号保留", () => {
  assert(stripSourceSuffix("a.b.ts") === "a.b", stripSourceSuffix("a.b.ts"));
});
check("stripSourceSuffix：非剥离集后缀原样", () => {
  assert(stripSourceSuffix("mod.mts") === "mod.mts", stripSourceSuffix("mod.mts"));
  assert(stripSourceSuffix("view.tsx") === "view.tsx", stripSourceSuffix("view.tsx"));
});
check("⚠️ 已知缺陷锚点：.d.ts 剥成 foo.d（ADR-323 §4 刻意保留，修复另立项）", () => {
  // 旧 shell base="${f%.ts}" 最短匹配 → foo.d；本断言把该行为锁死，
  // 使「修复」必须是一次显式的测试变更，而非静默漂移。
  assert(stripSourceSuffix("foo.d.ts") === "foo.d", stripSourceSuffix("foo.d.ts"));
});

// ── 2. 不套娃 ─────────────────────────────────────────
check("isTestOrSpecFile：测试/规格文件识别", () => {
  assert(isTestOrSpecFile("a.test.ts"), "a.test.ts 应识别");
  assert(isTestOrSpecFile("b.spec.js"), "b.spec.js 应识别");
  assert(!isTestOrSpecFile("c.ts"), "c.ts 不应识别");
});
check("deriveTestTargets：测试文件自身不再推导", () => {
  const out = deriveTestTargets(["x.test.ts"], () => true);
  assert(out.length === 0, `测试文件不应套娃，实际 ${JSON.stringify(out)}`);
});

// ── 3. 仅存在者纳入 ───────────────────────────────────
check("deriveTestTargets：测试文件不存在则不纳入", () => {
  const out = deriveTestTargets(["src/a.ts"], () => false);
  assert(out.length === 0, `不存在不应纳入，实际 ${JSON.stringify(out)}`);
});
check("deriveTestTargets：存在则纳入", () => {
  const out = deriveTestTargets(["src/a.ts"], (p) => p === "src/a.test.ts");
  assert(JSON.stringify(out) === JSON.stringify(["src/a.test.ts"]), JSON.stringify(out));
});

// ── 4. 双扩展名 ───────────────────────────────────────
check("deriveTestTargets：.test.ts 与 .test.js 并存时按序全收", () => {
  const out = deriveTestTargets(["src/a.ts"], (p) =>
    p === "src/a.test.ts" || p === "src/a.test.js",
  );
  assert(
    JSON.stringify(out) === JSON.stringify(["src/a.test.ts", "src/a.test.js"]),
    JSON.stringify(out),
  );
});

// ── 5. 去重与顺序 ─────────────────────────────────────
check("deriveTestTargets：重复源推导同一测试只保留一次", () => {
  const out = deriveTestTargets(["src/a.ts", "src/a.ts"], (p) => p === "src/a.test.ts");
  assert(out.length === 1, `应去重，实际 ${JSON.stringify(out)}`);
});
check("deriveTestTargets：保持输入顺序", () => {
  // 每源仅 .test.ts 存在，避免双扩展名混入干扰顺序断言
  const out = deriveTestTargets(["src/b.ts", "src/a.ts"], (p) => p.endsWith(".test.ts"));
  assert(
    JSON.stringify(out) === JSON.stringify(["src/b.test.ts", "src/a.test.ts"]),
    JSON.stringify(out),
  );
});

// ── 6. 空输入 ─────────────────────────────────────────
check("deriveTestTargets：空输入 → 空清单", () => {
  assert(deriveTestTargets([], () => true).length === 0, "空输入应为空");
});

console.log(fails.length === 0 ? "\n✅ 全部通过" : `\n❌ ${fails.length} 组失败`);
if (fails.length > 0) process.exit(1);
