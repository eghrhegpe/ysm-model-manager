#!/usr/bin/env node
/**
 * 契约测试：check-a11y.ts — a11y 覆盖基线守卫（ADR-308 D3）。
 *
 * 覆盖：
 *   1. 纯核直测（防真实树碰巧绿时空转假绿，同 test_check_layering 惯例）：
 *      stripA11yNoise 注释剥除/字符串保留/行号不变；countCoverage 各指标判定；
 *      scatterHits 单双引号与行号；基线比较内核（deficits / regressions / isTightening）
 *   2. 真仓 CLI：--json 退出码 0、_summary 契约齐全、key-router.ts 豁免在册、
 *      coverage 非空转（aria-label>0）、基线存在且与当前扫描一致
 *
 * 零依赖（仅 node:assert / node:fs / node:path / node:child_process / node:url）。
 * 运行：node tests/test_check_a11y.ts
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 静态 import：check-a11y.ts 带 invokedDirectly 守卫，被 import 时不执行 main()
import {
  countCoverage,
  coverageDeficits,
  isTightening,
  scatterHits,
  scatterRegressions,
  stripA11yNoise,
} from "../scripts/check-a11y.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function check(name, fn) {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.error("✗", name, "-", e.message);
  }
}

function runA11y(args) {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-a11y.ts"), ...args],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

/* ---------- 1. 纯核直测 ---------- */

check("stripA11yNoise：行/块注释置空格、字符串与模板串保留、行号不变", () => {
  const src = [
    "const a = 1; // aria-label 在行注释里",
    "/* 块注释 aria-hidden */",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 夹具须保留字面 ${} 源码形态（测试对象即模板串帧机）
    'const tpl = `<div aria-label="${t("x")}">`;',
    "const s = 'aria-selected';",
  ].join("\n");
  const clean = stripA11yNoise(src);
  assert.equal(clean.split("\n").length, src.split("\n").length, "行数必须不变");
  assert.equal(clean.length, src.length, "等长替换（行号/列号一致）");
  assert.ok(!clean.includes("注释里"), "行注释内容应被剥除");
  assert.ok(!clean.includes("块注释"), "块注释内容应被剥除");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 断言串需含字面 ${}（同上夹具理由）
  assert.ok(clean.includes('aria-label="${t("x")}"'), "模板串内容应保留");
  assert.ok(clean.includes("aria-selected"), "单引号串内容应保留");
});

check("stripA11yNoise：未闭合单引号不吞全文（行尾强制终止）", () => {
  const src = "const a = 'unclosed;\nconst b = 2; // aria-label";
  const clean = stripA11yNoise(src);
  assert.ok(clean.includes("const b = 2;"), "第二行代码不得被吞");
  assert.ok(!clean.includes("aria-label"), "行尾终止后恢复 code 帧，第二行行注释应被剥");
});

check("countCoverage：模板串 aria 命中、注释不计、data-role 前缀不计", () => {
  const src = [
    "const tpl = `<button aria-label='关' role='tab' tabindex='0'>`;",
    "el.setAttribute('aria-live', 'polite');",
    "const cfg = { role: 'dialog' };",
    "el.tabIndex = 0;",
    "// aria-label aria-label aria-label（注释噪音不得计数）",
    "row.dataset.role = 'x'; // data-role 前缀不得计入 role",
  ].join("\n");
  const c = countCoverage(src);
  assert.equal(c["aria-label"], 1, `aria-label 应为 1，实际 ${c["aria-label"]}`);
  assert.equal(c["aria-live"], 1, "setAttribute 形态应命中");
  assert.equal(c.role, 2, `role 模板串+对象形态应为 2，实际 ${c.role}`);
  assert.equal(c.tabindex, 2, `tabindex + tabIndex 应为 2，实际 ${c.tabindex}`);
  assert.equal(c["prefers-reduced-motion"], undefined, "无命中不得造 0 键");
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: 用例名需描述字面 ${} 帧恢复行为
check("countCoverage：模板串 ${} 插值内注释正确恢复 code 帧", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 夹具须保留字面 ${} 源码形态
  const src = "const tpl = `<div aria-hidden>${1 /* aria-hidden */}</div>`;";
  const c = countCoverage(src);
  assert.equal(c["aria-hidden"], 1, `应为 1，实际 ${c["aria-hidden"]}`);
});

check("scatterHits：单双引号命中且行号正确", () => {
  const src = [
    "x();",
    'document.addEventListener("keydown", h);',
    "y();",
    "document.addEventListener('keydown', h2);",
    "// document.addEventListener('keydown', fake) 注释不计",
  ].join("\n");
  assert.deepEqual(scatterHits(src), [2, 4]);
});

check("基线比较内核：coverage 缺口 / scatter 回归 / 收紧判定", () => {
  assert.deepEqual(
    coverageDeficits({ "aria-label": 3, "aria-live": 1 }, { "aria-label": 2 }).sort((a, b) =>
      a.key.localeCompare(b.key),
    ),
    [
      { key: "aria-label", baseline: 3, current: 2 },
      { key: "aria-live", baseline: 1, current: 0 },
    ],
    "计数下降判缺口；键消失（0<1）同判",
  );
  assert.deepEqual(
    scatterRegressions({ "a.ts": 2 }, { "a.ts": 2, "b.ts": 1 }),
    [{ file: "b.ts", baseline: 0, current: 1 }],
    "新文件散点即回归",
  );
  assert.equal(
    isTightening(
      { _comment: "", generatedAt: "", coverage: { "aria-label": 3 }, scatter: { "a.ts": 2 } },
      { coverage: { "aria-label": 4 }, scatter: { "a.ts": 1 } },
    ),
    true,
    "coverage 升 + scatter 降 = 收紧",
  );
  assert.equal(
    isTightening(
      { _comment: "", generatedAt: "", coverage: { "aria-label": 3 }, scatter: {} },
      { coverage: { "aria-label": 2 }, scatter: {} },
    ),
    false,
    "coverage 降 = 放松",
  );
  assert.equal(
    isTightening(
      { _comment: "", generatedAt: "", coverage: {}, scatter: { "a.ts": 1 } },
      { coverage: {}, scatter: { "a.ts": 2 } },
    ),
    false,
    "scatter 升 = 放松",
  );
});

/* ---------- 2. 真仓 CLI ---------- */

check("--json 输出合法 JSON 且 _summary 契约齐全，当前树基线内 rc=0", () => {
  const { rc, out } = runA11y(["--json"]);
  const data = JSON.parse(out);
  assert.ok(data._summary, "缺 _summary");
  for (const k of [
    "files",
    "coverageTotal",
    "coverageKeys",
    "scatterTotal",
    "deficits",
    "regressions",
  ]) {
    assert.equal(typeof data._summary[k], "number", `_summary.${k} 应为 number`);
  }
  assert.ok(Array.isArray(data.coverage_deficits), "coverage_deficits 应为数组");
  assert.ok(Array.isArray(data.scatter_regressions), "scatter_regressions 应为数组");
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}: ${out.slice(0, 400)}`);
  assert.equal(data._summary.deficits, 0, "coverage 不得有缺口");
  assert.equal(data._summary.regressions, 0, "scatter 不得有回归");
});

check("coverage 非空转（真仓 aria-label/role/tabindex 必有命中）", () => {
  const { out } = runA11y(["--json"]);
  const data = JSON.parse(out);
  for (const k of ["aria-label", "role", "tabindex"]) {
    assert.ok((data.coverage[k] ?? 0) > 0, `真仓 ${k} 应 >0（防空转假绿）`);
  }
  assert.ok(
    (data.coverage["prefers-reduced-motion"] ?? 0) >= 2,
    "reduced-motion 并轨点应 ≥2（ui-prefs + 通配桥注释外实码）",
  );
});

check("key-router.ts 是唯一 scatter 豁免出口（在册散点不含它）", () => {
  const { out } = runA11y(["--json"]);
  const data = JSON.parse(out);
  assert.ok(
    !Object.keys(data.scatter).some((f) => f === "utils/dom/key-router.ts"),
    "key-router.ts 不应入册（ADR-308 D1 唯一合法出口）",
  );
  assert.ok(data._summary.scatterTotal >= 1, "在册散点应非空（否则豁免名单失真）");
});

check("基线文件存在且 generatedAt 非空", () => {
  const p = path.join(ROOT, "docs", ".a11y-baseline.json");
  assert.ok(fs.existsSync(p), "docs/.a11y-baseline.json 应存在");
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.ok(data.generatedAt, "generatedAt 应非空");
  assert.ok(data._comment.includes("只增不减"), "_comment 应说明 floor 语义");
});

if (fails.length > 0) {
  console.error(`\n${fails.length} 项失败:`);
  for (const f of fails) console.error("  -", f);
  process.exit(1);
}
console.log("\n全部通过");
