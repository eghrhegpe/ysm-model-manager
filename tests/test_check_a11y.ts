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
    // 成功（rc=0）：stdout 必须是无前缀纯 JSON——只取 stdout，绝不拼 stderr，
    // 否则守卫明细（往 stderr 打）会污染 JSON.parse（D10 复现的
    // "Unexpected non-whitespace character after JSON" 真源）。
    return { rc: 0, out, err: "" };
  } catch (e) {
    // 失败（rc≠0）：**stdout 仍是纯 JSON**——脚本在 --json 下先无条件打印报告
    // （check-a11y.ts main 的 parsed.json 分支），守卫明细才走 stderr。
    // 故此处同样不得拼接：把两者分开返回，`out` 供 JSON.parse、`err` 仅供
    // 断言消息展示。此前拼接导致「守卫一旦失败，所有 --json 用例一起炸在
    // Unexpected non-whitespace」——真缺陷被降级成 3 条同款 JSON 解析假象，
    // 掩盖了真正该报的那一条（2026-10-15 修复）。
    return { rc: e.status ?? 1, out: e.stdout || "", err: e.stderr || "" };
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

// ⚠️ 上面那条抓不住本缺陷：夹具写在**一行内**，串尾即文件尾——「回到 tpl 帧」与
// 「卡在 code 帧」两种状态得到同一个计数结果，断言无判别力（假绿灯形状）。
// 真实现漏掉 `}` 出帧后，多行模板之后的注释会被当字符串留着 → 噪音计数。
check("countCoverage：多行模板的 ${} 结束后，其后行注释必须回到 code 帧被剥", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 夹具须保留字面 ${} 源码形态
  const src = [
    "const tpl = [",
    '  `<button aria-label="1">`,',
    '    `${esc("k")}`,',
    "  `</button>`,",
    '].join("");',
    "// aria-label aria-label（模板结束后的行注释不得计数）",
    "/* aria-label 块注释同样不得计数 */",
  ].join("\n");
  const c = countCoverage(src);
  assert.equal(
    c["aria-label"],
    1,
    `aria-label 应为 1（只有模板内那处真命中），实际 ${c["aria-label"]}——插值 \${} 未出帧，注释被当字符串留着`,
  );
});

check("countCoverage：${} 内含对象字面量花括号不得提前出帧（嵌套深度须计数）", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 夹具须保留字面 ${} 源码形态
  const src = [
    "const tpl = `${ { ariaLabel: \"x\" }.ariaLabel }`;",
    "// aria-hidden 注释不计",
  ].join("\n");
  const c = countCoverage(src);
  assert.equal(
    c["aria-hidden"],
    undefined,
    `插值内的对象字面量 } 不得被当作出帧点，否则注释行留在 code 帧外被计数：实际 ${c["aria-hidden"]}`,
  );
});

check("countCoverage：ARIA_ATTR 常量引用形态计数（D12 收编不假跌）", () => {
  // 收编后渲染层写 setAttribute(ARIA_ATTR.label, …)——字面量在契约声明处、
  // 引用在消费处。两种形态都必须计入同一指标，否则「收编 = 覆盖率下降」假红。
  const src = [
    "el.setAttribute(ARIA_ATTR.label, t('x'));",
    "header.setAttribute(ARIA_ATTR.expanded, String(v));",
    "header.setAttribute(ARIA_ATTR.role, ROLE.button);",
    "const bar = ARIA_ATTR.valuenow;",
    "el.setAttribute(ARIA_ATTR.live, 'polite'); // ARIA_ATTR.dead 注释不计",
  ].join("\n");
  const c = countCoverage(src);
  assert.equal(c["aria-label"], 1, "ARIA_ATTR.label → aria-label");
  assert.equal(c["aria-expanded"], 1, "ARIA_ATTR.expanded → aria-expanded");
  assert.equal(c["aria-valuenow"], 1, "ARIA_ATTR.valuenow → aria-valuenow");
  assert.equal(c["aria-live"], 1, "代码位 ARIA_ATTR.live 计数（注释位不增计）");
  assert.equal(c.role, 1, "ARIA_ATTR.role 并入 role 汇总（不建 aria-role 野键）");
  assert.equal(c["aria-role"], undefined, "role 不得建 aria- 前缀键");
  assert.equal(c["aria-dead"], undefined, "注释内引用不得计数");
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
  const { rc, out, err } = runA11y(["--json"]);
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
  // 失败消息走 stderr（stdout 在 --json 下恒为纯 JSON，见 runA11y 注）
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}: ${err || out}`.slice(0, 600));
  assert.equal(data._summary.deficits, 0, "coverage 不得有缺口");
  assert.equal(data._summary.regressions, 0, "scatter 不得有回归");
});

check("coverage 非空转（真仓 aria-* 必有命中且 tabindex/role 中性指标有记录）", () => {
  const { out } = runA11y(["--json"]);
  const data = JSON.parse(out);
  // aria-* 覆盖度（守基线的硬指标）不得空转
  for (const k of ["aria-label", "aria-selected", "aria-expanded"]) {
    assert.ok((data.coverage[k] ?? 0) > 0, `真仓 ${k} 应 >0（防空转假绿）`);
  }
  // 中性指标只记录、不守基线，但仍应在真仓有真实命中（防空转）
  assert.ok((data.coverageNeutral.tabindex ?? 0) > 0, "真仓 tabindex 应 >0（记为中性指标）");
  assert.ok((data.coverageNeutral.role ?? 0) > 0, "真仓 role 应 >0（记为中性指标）");
  assert.ok(
    (data.coverageNeutral["prefers-reduced-motion"] ?? 0) >= 2,
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
  assert.ok(
    data._comment.includes("只增不减") || data._comment.includes("fail-open"),
    "_comment 应说明 floor 语义（coverage 只增不减 / coverageNeutral fail-open）",
  );
});

if (fails.length > 0) {
  console.error(`\n${fails.length} 项失败:`);
  for (const f of fails) console.error("  -", f);
  process.exit(1);
}
console.log("\n全部通过");
