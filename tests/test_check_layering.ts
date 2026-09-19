#!/usr/bin/env node
/**
 * 契约测试：check-layering.mjs 分层守护。
 *
 * 覆盖：
 *   1. --json 输出必须是合法 JSON，且 _summary 含 zero_tolerance / tracked / regressions 键
 *   2. 基线存在（docs/.layering-baseline.json），当前扫描结果 tracked 应与基线一致
 *   3. --json 退出码：零容忍违规或超基线 → 1；否则 0（当前基线内应 0）
 *
 * 零依赖（仅 node:fs / node:path / node:child_process）。
 * 运行：node tests/test_check_layering.mjs
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 静态 import：check-layering.mjs 带 invokedDirectly 守卫，被 import 时不执行 main()
import { matchImports, menuSubOf, r7EdgeViolates } from "../scripts/check-layering.ts";

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

function runLayering(args) {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-layering.ts"), ...args],
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

check("--json 输出合法 JSON 且 _summary 契约齐全", () => {
  const { rc, out } = runLayering(["--json"]);
  const data = JSON.parse(out);
  assert.ok(data._summary, "缺 _summary");
  assert.equal(typeof data._summary.zero_tolerance, "number");
  assert.equal(typeof data._summary.tracked, "number");
  assert.equal(typeof data._summary.regressions, "number");
  assert.ok(Array.isArray(data.debt), "debt 应为数组");
  // 当前基线内：零容忍 0、无新增回归 → 应通过（rc 0）
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}`);
  assert.equal(
    data._summary.zero_tolerance,
    0,
    `zero_tolerance 应为 0，实际 ${data._summary.zero_tolerance}：${(data.zero_tolerance_violations ?? []).map((v) => `[${v.rule}] ${v.from}:${v.line} → ${v.to}`).join(", ")}`,
  );
  assert.equal(
    data._summary.regressions,
    0,
    `regressions 应为 0，实际 ${data._summary.regressions}：${(data.regressions ?? []).map((v) => `[${v.rule}] ${v.from}:${v.line} → ${v.to}`).join(", ")}`,
  );
});

// R5（ADR-208 D1）：features/views 生产文件禁直接 import backend/app.ts（*-deps.ts 白名单）。
// 2026-09-10 自 features 扩展至 views（消除 views 直连后端的法外之地）：
// 迁移后仓库应零 R5 违规；任何 features|views 新增直引 backend/app.ts 即 rc=1 阻断。
check("R5 零 R5 违规（features/views→backend/app.ts 仅经 *-deps.ts seam）", () => {
  const { out } = runLayering(["--json"]);
  const data = JSON.parse(out);
  const r5 = (data.zero_tolerance_violations ?? []).filter((v) => v.rule === "R5");
  assert.equal(
    r5.length,
    0,
    `R5 违规 ${r5.length} 条：${r5.map((v) => `${v.from}:${v.line}`).join(", ")}`,
  );
});

// R6（ADR-189 D4 引擎无关内核）：core/** 测试文件禁止 import backend/*（运行时或 type-only）。
// 主循环 SCAN_OPTS.skipFile 豁免所有测试文件（防 R5 误伤 features/views 测试），
// 故 R6 单独扫 core/** 下的 .test.ts/.spec.ts。当前仓库应零 R6 违规；
// 任何 core 测试新增直引 backend/*（含 import type）即 rc=1 阻断。
check("R6 零 R6 违规（core 测试文件→backend/*，引擎无关对 type 感知不成立）", () => {
  const { out } = runLayering(["--json"]);
  const data = JSON.parse(out);
  const r6 = (data.zero_tolerance_violations ?? []).filter((v) => v.rule === "R6");
  assert.equal(
    r6.length,
    0,
    `R6 违规 ${r6.length} 条：${r6.map((v) => `${v.from}:${v.line} → ${v.to}`).join(", ")}`,
  );
});

// R7（ADR-270 menu 目录物理分层）：preview-3d/menu/ 子目录内部分层守护。
// 两层断言，缺一不可：
//   1. 集成——当前仓库应零 R7 违规（任何 panels→engine / render→engine|panels / 叶→上层 即 rc 非 0）。
//   2. 非空转（纯核）——r7EdgeViolates/menuSubOf 直测，证明 rank 表真会判违规；
//      否则「assert 0 违规」在 MENU_SUB_RANK 被误清空时永远空转假绿（这正是锐评指出的缺口）。
check("R7 零 R7 违规（menu 子目录禁运行时向上依赖，ADR-270）", () => {
  const { out } = runLayering(["--json"]);
  const data = JSON.parse(out);
  const r7 = (data.zero_tolerance_violations ?? []).filter((v) => v.rule === "R7");
  assert.equal(
    r7.length,
    0,
    `R7 违规 ${r7.length} 条：${r7.map((v) => `${v.from}:${v.line} → ${v.to}`).join(", ")}`,
  );
});

check("R7 纯核非空转：向上边判违规、下行/同层放行", () => {
  // 向上（严格高 rank）= 违规
  assert.equal(r7EdgeViolates("panels", "engine"), true, "panels→engine 必须判违规");
  assert.equal(r7EdgeViolates("render", "engine"), true, "render→engine 必须判违规");
  assert.equal(r7EdgeViolates("render", "panels"), true, "render→panels 必须判违规");
  assert.equal(r7EdgeViolates("schema", "panels"), true, "叶 schema→panels 必须判违规");
  // 下行 / 同层 = 合法（铰链 render 被 panels/engine 向下依赖正是设计内）
  assert.equal(r7EdgeViolates("engine", "panels"), false, "engine→panels 下行放行");
  assert.equal(r7EdgeViolates("engine", "render"), false, "engine→render 下行放行（铰链）");
  assert.equal(r7EdgeViolates("panels", "render"), false, "panels→render 下行放行");
  assert.equal(r7EdgeViolates("schema", "style"), false, "schema↔style 同 rank(0) 放行");
  assert.equal(r7EdgeViolates("panels", "panels"), false, "同层放行");
  // 未知子层不参与判定（返回 false，交由 menuSubOf 过滤）
  assert.equal(r7EdgeViolates("panels", "nonexistent"), false, "未知目标不判违规");
});

check("R7 menuSubOf：子层归属解析 + 根散文件/非 menu 返回 null", () => {
  assert.equal(menuSubOf("preview-3d/menu/panels/env.ts"), "panels");
  assert.equal(menuSubOf("preview-3d/menu/engine/core.ts"), "engine");
  assert.equal(menuSubOf("preview-3d/menu/render/render.ts"), "render");
  // menu 根散文件（如 fixtures）无子层归属 → null（R7 双向隐形，符合设计）
  assert.equal(menuSubOf("preview-3d/menu/menu-test-fixtures.ts"), null);
  // 非 menu 路径 → null
  assert.equal(menuSubOf("core/i18n/t.ts"), null);
});

check("基线文件存在且 tracked 与基线一致（防漂移）", () => {
  const basePath = path.join(ROOT, "docs", ".layering-baseline.json");
  assert.ok(fs.existsSync(basePath), "缺基线文件");
  const baseline = JSON.parse(fs.readFileSync(basePath, "utf8"));
  assert.ok(Array.isArray(baseline.entries));
  const { out } = runLayering(["--json"]);
  const data = JSON.parse(out);
  // debt = 当前基线内反向边；应与基线 entries 集合一致（未 --update 时不允许漂移）
  const debtSet = new Set(data.debt);
  for (const e of baseline.entries) assert.ok(debtSet.has(e), `基线条目 ${e} 不在当前扫描结果`);
});

check("--update 生成合法基线（幂等性：连续两次 update 后 tracked 数量稳定）", () => {
  const before = runLayering(["--json"]).out;
  const dataBefore = JSON.parse(before);
  if (fails.length) return; // 先前用例已失败：不再执行 --update，避免改写受跟踪基线
  const { rc } = runLayering(["--update"]);
  assert.equal(rc, 0, "--update 应退 0");
  const after = runLayering(["--json"]).out;
  const dataAfter = JSON.parse(after);
  assert.equal(
    dataAfter._summary.tracked,
    dataBefore._summary.tracked,
    "update 不应改变 tracked 数量",
  );
  assert.equal(dataAfter._summary.regressions, 0, "update 后不应有回归");
});

// ── matchImports 纯函数（多行 import / type-only 豁免 / 模板字符串剥离）──
check("matchImports 捕获单行 import 并正确标记 type-only", () => {
  const r = matchImports(
    'import { a } from "./views/foo.ts";\nimport type { B } from "./services/bar.ts";',
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].spec, "./views/foo.ts");
  assert.equal(r[0].typeOnly, false);
  assert.equal(r[1].spec, "./services/bar.ts");
  assert.equal(r[1].typeOnly, true);
});

check("matchImports 捕获多行具名 import（from 在后续行），行号为起始行", () => {
  const text = 'import {\n  type A,\n  b,\n} from "./views/foo.ts";\nconst x = 1;\n';
  const r = matchImports(text);
  assert.equal(r.length, 1, "多行 import 应被捕获（修复前漏报）");
  assert.equal(r[0].spec, "./views/foo.ts");
  assert.equal(r[0].line, 1, "行号应为 import 起始行");
});

check("matchImports 多行全 type 具名 import 判定为 type-only（豁免）", () => {
  const text = 'import {\n  type A,\n  type B as C,\n} from "./views/foo.ts";\n';
  const r = matchImports(text);
  assert.equal(r.length, 1);
  assert.equal(r[0].typeOnly, true, "多行全 type 具名 import 应豁免运行时耦合");
});

check("matchImports 剥离模板字面量/注释内的 import 形状文本（防幽灵违规）", () => {
  const text = [
    "const s = `",
    "  import {",
    "    a,",
    "  } from './views/foo.ts';",
    "`;",
    '// import { x } from "./features/bar.ts";',
    'import { real } from "./core/real.ts";',
  ].join("\n");
  const r = matchImports(text);
  assert.equal(r.length, 1, "模板字面量/注释内的 import 形状文本不应被捕获");
  assert.equal(r[0].spec, "./core/real.ts");
});

check('matchImports 捕获副作用导入（import "x"）并标记运行时', () => {
  const r = matchImports('import "./styles.css";\n');
  assert.equal(r.length, 1);
  assert.equal(r[0].spec, "./styles.css");
  assert.equal(r[0].typeOnly, false);
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 个用例失败：`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✅ 全部用例通过");
