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
import {
  htmlLiteralHits,
  matchImports,
  menuSubOf,
  p3dSubOf,
  r10EdgeViolates,
  r10TargetAllowed,
  r7EdgeViolates,
  r9EdgeViolates,
  R10_WHITELIST_FILES,
  R10_WHITELIST_PREFIXES,
} from "../scripts/check-layering.ts";

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

// R8（ADR-190 D1a / ADR-208 D2「HTML 模板归 views」执法闸）：features 生产文件不得含 HTML 字面量。
// 两层断言缺一不可：
//   1. 非空转（纯核）——htmlLiteralHits 合成样本直测（模板/字符串命中、注释/泛型/插值/allow 行豁免）；
//   2. 集成——当前仓库零增量违规（存量走 docs/.layering-baseline.json 防回退基线，ADR-208「改动即顺手收敛」
//      反对 big-bang，故 R8 是防回退而非零容忍）；基线必须含存量条目，否则扫描器在真实树上空转。
check("R8 纯核 htmlLiteralHits：模板/字符串 HTML 命中，注释/泛型/插值/allow 行豁免", () => {
  const text = [
    'const a = `<div style="x">hi</div>`;', // 1 模板开标签
    'container.innerHTML = "";', // 2 空串无标签
    'const el = box.querySelector<HTMLElement>(".k");', // 3 泛型参数不在字符串内
    "// const b = `<b>comment</b>`;", // 4 行注释剥离
    'const c = "</button>" + "x";', // 5 闭合标签
    "const d = `${UI_ICONS.refresh} plain`;", // 6 纯插值无标签
    "const e = `<div>x</div>`; // layering-allow: html", // 7 allow 尾注豁免
    "const f = `<div>", // 8 多行模板起点（命中记起始行）
    "  <span>inner</span>", // 9 同一模板续行不重复记
    "</div>`;", // 10
    "/* const g = `<i>block</i>`; */", // 11 块注释剥离
  ].join("\n");
  assert.deepEqual(
    htmlLiteralHits(text).map((h) => h.line),
    [1, 5, 8],
    "命中行应为 1/5/8（多行模板只记一次），实报 " + JSON.stringify(htmlLiteralHits(text)),
  );
});

check("R8 集成：features 零新增 HTML 字面量（存量在基线，增量阻断）+ 扫描器非空转", () => {
  const { out } = runLayering(["--json"]);
  const data = JSON.parse(out);
  const r8reg = (data.regressions ?? []).filter((v) => v.rule === "R8");
  assert.equal(
    r8reg.length,
    0,
    `R8 新增违规 ${r8reg.length} 条：${r8reg.map((v) => `${v.from}:${v.line}`).join(", ")}`,
  );
  // 防扫描器空转：R8 html-literal 存量已全清（ADR-190 D1a tpl 注入收口），基线债务可合法为 0；
  // 扫描器非空转由上方「R8 纯核 htmlLiteralHits」合成样本用例保证，此处只断言扫描确实产出结构。
  assert.ok(
    Array.isArray(data.debt),
    "check-layering --json 未产出 debt 数组——扫描疑似未运行",
  );
});

// R9（ADR-270-d1 preview-3d 内部分层方向闸，R7 自 menu/ 扩至全区）：
// 底层子目录 { state, infra, decoder, shader-patches } 生产文件禁运行时 import 上层
// { adapters, caps, menu }（type-only 豁免；测试文件经 skipFile 豁免）。
// 两层断言同 R7/R8 惯例：
//   1. 非空转（纯核）——r9EdgeViolates/p3dSubOf 直测，rank 表被误清空即红；
//   2. 集成——新增反向边超基线即 rc=1 阻断；基线含存量条目的软断言防扫描器空转。
check("R9 零新增（preview-3d 底层→上层运行时反向边，超基线即阻断，ADR-270-d1）", () => {
  const { out } = runLayering(["--json"]);
  const data = JSON.parse(out);
  const r9reg = (data.regressions ?? []).filter((v) => v.rule === "R9");
  assert.equal(
    r9reg.length,
    0,
    `R9 新增反向边 ${r9reg.length} 条：${r9reg.map((v) => `${v.from}:${v.line} → ${v.to}`).join(", ")}`,
  );
  // R9 债务可真实清零（2026-10-07 锐评：env-state-schema→caps 反向边下沉 state 叶子后归零）。
  // 债务为空时的扫描器非空转由「R9 纯核 r9EdgeViolates」合成样本用例（本文件 217 行）独立保证；
  // 此处不再做「债务非空」的集成级软断言——债务清零会误报扫描器空转（历史断言已删）。
});

check("R9 纯核 r9EdgeViolates：底层→上层判违规，下行/同层/越界放行", () => {
  assert.equal(r9EdgeViolates("state", "caps"), true, "state→caps 必须判违规");
  assert.equal(r9EdgeViolates("state", "adapters"), true, "state→adapters 必须判违规");
  assert.equal(r9EdgeViolates("infra", "adapters"), true, "infra→adapters 必须判违规");
  assert.equal(r9EdgeViolates("infra", "menu"), true, "infra→menu 必须判违规");
  assert.equal(r9EdgeViolates("decoder", "caps"), true, "decoder→caps 必须判违规");
  assert.equal(r9EdgeViolates("shader-patches", "caps"), true, "shader-patches→caps 必须判违规");
  assert.equal(r9EdgeViolates("adapters", "state"), false, "adapters→state 下行放行");
  assert.equal(r9EdgeViolates("caps", "infra"), false, "caps→infra 下行放行");
  assert.equal(r9EdgeViolates("state", "state"), false, "同层放行");
  assert.equal(r9EdgeViolates("menu", "caps"), false, "越界（menu 非底层）不判违规");
  assert.equal(r9EdgeViolates("mesh", "caps"), false, "越界（mesh 非射程子目录）不判违规——R9.x 扩围前保持隐形");
});

check("R9 p3dSubOf：子目录归属解析 + 根散文件/非 preview-3d 返回 null", () => {
  assert.equal(p3dSubOf("preview-3d/state/env-state.ts"), "state");
  assert.equal(p3dSubOf("preview-3d/infra/render-host.ts"), "infra");
  assert.equal(p3dSubOf("preview-3d/decoder/geometry.ts"), "decoder");
  assert.equal(p3dSubOf("preview-3d/shader-patches/patch-guard.ts"), "shader-patches");
  assert.equal(p3dSubOf("preview-3d/menu/engine/core.ts"), "menu");
  // preview-3d 根散文件（ring-log.ts 等）无子目录归属 → null（R9 双向隐形，与 R7 menu 根散文件同形）
  assert.equal(p3dSubOf("preview-3d/ring-log.ts"), null);
  assert.equal(p3dSubOf("views/app-nav/index.ts"), null, "非 preview-3d 不参与 R9 判定");
});

// R10（ADR-270-d2 views→preview-3d 入口面白名单闸）：views 生产文件运行时 import
// preview-3d/ 仅许经入口面（adapters/ 装配入口面目录前缀 + infra 值域/公共通道精确文件
// + state/preview-state.ts 公开面）；内部细节穿透（decoder/mesh/model/texture/screenshot/
// menu panels）入基线（key=from:to），新增边即阻断。type-only 豁免；测试文件经 skipFile 豁免。
// 两层断言同 R7/R8/R9 惯例：1. 非空转（纯核）；2. 集成（超基线 rc=1 + 存量债务非空守卫）。
check("R10 零新增（views→preview-3d 内部细节穿透，超基线即阻断，ADR-270-d2）", () => {
  const { out } = runLayering(["--json"]);
  const data = JSON.parse(out);
  const r10reg = (data.regressions ?? []).filter((v) => v.rule === "R10");
  assert.equal(
    r10reg.length,
    0,
    `R10 新增穿透边 ${r10reg.length} 条：${r10reg.map((v) => `${v.from}:${v.line} → ${v.to}`).join(", ")}`,
  );
  // ADR-270-d6 收尾：R10 存量已全清（截图编排 / 菜单候选派生回迁 preview-3d/adapters），
  // 基线 4 → 0。原「债务非空」守卫在此形态下必假红——它自己的断言文案已预告该分支
  // （「或存量全收敛但基线未 --update 收紧」）。换成等强 + 更严的两条：
  //   ① 扫描确实产出结构（同 R8 全清后的既定范式，见上方 R8 集成块）；
  //   ② R10 债务条目恒为 0——堵「把 views→preview-3d 边写回基线放宽」这条旁路：边一旦入基线，
  //      regressions 恒 0（ADR-270-d6 决策 3 明确否决给 menu/panels 开赦免，基线放行同理）。
  // 扫描器非空转由下方「R10 纯核 r10EdgeViolates」「R10 r10TargetAllowed」合成样本用例保证。
  assert.ok(
    Array.isArray(data.debt),
    "check-layering --json 未产出 debt 数组——扫描疑似未运行",
  );
  assert.equal(
    (data.debt ?? []).filter((e) => e.startsWith("views/") && e.includes(":preview-3d/")).length,
    0,
    "R10 债务条目应恒为 0（ADR-270-d6 全收敛）——出现即基线被放宽",
  );
});

check("R10 纯核 r10EdgeViolates：入口面白名单放行，内部细节穿透判违规，非 views 不参与", () => {
  // 白名单放行（adapters/ 前缀 + infra 精确文件 + state/preview-state.ts 公开面）
  assert.equal(
    r10EdgeViolates("views/app-preview/ysm-3d.ts", "preview-3d/adapters/mount-preview-core.ts"),
    false,
    "adapters/ 装配入口面前缀放行",
  );
  assert.equal(
    r10EdgeViolates("views/app-preview/detail-3d.ts", "preview-3d/adapters/mmd/mmd-detail-stats.ts"),
    false,
    "adapters/ 子目录（格式适配器）放行",
  );
  assert.equal(
    r10EdgeViolates("views/app-content/settings/keymap.ts", "preview-3d/infra/keymap.ts"),
    false,
    "infra 值域精确文件放行",
  );
  assert.equal(
    r10EdgeViolates("views/app-preview/perf-trace.ts", "preview-3d/infra/load-trace.ts"),
    false,
    "infra/load-trace.ts 来源码家族值域放行",
  );
  assert.equal(
    r10EdgeViolates("views/app-nav/index.ts", "preview-3d/state/preview-state.ts"),
    false,
    "state/preview-state.ts 公开面放行",
  );
  // 内部细节穿透判违规（解码链/菜单节点/截图引擎/巨型文件再导出面）
  assert.equal(
    r10EdgeViolates("views/app-preview/index.ts", "preview-3d/decoder/model-cache.ts"),
    true,
    "decoder 解码缓存穿透必须判违规",
  );
  assert.equal(
    r10EdgeViolates("views/app-preview/skeleton-render.ts", "preview-3d/screenshot/screenshot-lights.ts"),
    true,
    "screenshot 截图引擎穿透必须判违规",
  );
  assert.equal(
    r10EdgeViolates("views/app-preview/mmd-controls.ts", "preview-3d/menu/panels/multi-model.ts"),
    true,
    "menu 菜单节点穿透必须判违规",
  );
  assert.equal(
    r10EdgeViolates("views/app-content/settings/keymap.ts", "preview-3d/mesh/model3d.ts"),
    true,
    "mesh 巨型文件再导出面穿透必须判违规（ADR-270-d2 斩边目标）",
  );
  assert.equal(
    r10EdgeViolates("views/app-preview/index.ts", "preview-3d/infra/unknown.ts"),
    true,
    "infra 白名单外精确文件（未列名）必须判违规——白名单是闭集",
  );
  // 射程收窄：非 views from / 非 preview-3d target 不参与
  assert.equal(
    r10EdgeViolates("features/app-sync-manager/index.ts", "preview-3d/decoder/model-cache.ts"),
    false,
    "非 views 层不参与 R10（射程刻意收窄，features 引 p3d 另行治理）",
  );
  assert.equal(
    r10EdgeViolates("views/app-preview/index.ts", "core/bus.ts"),
    false,
    "非 preview-3d target 不参与 R10",
  );
});

check("R10 r10TargetAllowed：白名单闭集 + 非空转守卫", () => {
  assert.ok(R10_WHITELIST_PREFIXES.length > 0, "前缀白名单被清空——非空转");
  assert.ok(R10_WHITELIST_FILES.length > 0, "精确文件白名单被清空——非空转");
  assert.equal(r10TargetAllowed("preview-3d/adapters/mount-preview-core.ts"), true);
  assert.equal(r10TargetAllowed("preview-3d/infra/schema-registry.ts"), true);
  assert.equal(r10TargetAllowed("preview-3d/state/preview-state.ts"), true);
  assert.equal(r10TargetAllowed("preview-3d/decoder/utils.ts"), false);
  assert.equal(r10TargetAllowed("preview-3d/menu/panels/multi-model.ts"), false);
  assert.equal(r10TargetAllowed("core/bus.ts"), false, "非 preview-3d target 不属白名单");
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
