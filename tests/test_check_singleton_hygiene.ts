#!/usr/bin/env node
/**
 * 契约测试：check-singleton-hygiene.ts 模块级可变单例卫生闸。
 *
 * 覆盖：
 *   1. scanText 纯函数判据（合成样本直测——防真实树碰巧绿时空转假绿）：
 *      顶层 let 命中 / export let 命中 / 函数体缩进 let 放行 / const 放行 /
 *      注释与模板字面量内的 let 形状放行 / for-let 放行；
 *      复位出口三路（__reset* / reset* / clear* / 可传 null 的 set*，含类型别名间接 null）；
 *      行级 singleton-allow 豁免（同/上行命中、空理由不豁免、窗口外不豁免）。
 *   2. diffBaseline 计数制：超基线 = 回归、低基线 = fixed、持平 = 静默。
 *   3. 真实树非空转：扫描文件数 > 200 且基线零回归零 fixed（fixed=0 证明检测器
 *      真看到了当前树，而非空扫描报绿）。
 *   4. 子进程契约：--json 合法且 _summary 键齐、--help 退 0、未知参数退 2、
 *      --update 幂等（树未变时"基线无变化"退 0，不改写文件）。
 *
 * 零依赖（仅 node:assert / node:child_process / node:fs / node:path / node:url）。
 * 运行：node tests/test_check_singleton_hygiene.ts
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 静态 import：脚本带 invokedDirectly 守卫，被 import 时不跑 main()
import {
  collectProductionFiles,
  diffBaseline,
  moduleLevelLets,
  scanAll,
  scanText,
  SINGLETON_ALLOW_RE,
} from "../scripts/check-singleton-hygiene.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(ROOT, "scripts", "check-singleton-hygiene.ts");
const BASELINE = path.join(ROOT, "docs", ".singleton-hygiene-baseline.json");

const fails: string[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fails.push(`${name}: ${msg}`);
    console.error("✗", name, "-", msg);
  }
}

function runGate(args: string[]): { rc: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: "utf8" });
    return { rc: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { rc: err.status ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const F = "preview-3d/fake.ts";

/* ── 1a. 检测面：什么算模块级可变态 ── */

check("顶层 let 命中（含 export let）", () => {
  assert.equal(scanText(F, "let a = 1;\n").length, 1);
  assert.equal(scanText(F, "export let b = 2;\n").length, 1);
});

check("多个顶层 let 各自成条且行号正确", () => {
  const hits = scanText(F, "let a = 1;\nlet b = 2;\n");
  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((h) => `${h.ident}@${h.line}`),
    ["a@1", "b@2"],
  );
  assert.equal(hits[0]!.rule, "unmanaged-let");
});

check("函数体内缩进 let 放行（非模块级）", () => {
  assert.equal(scanText(F, "function f() {\n  let inner = 1;\n  return inner;\n}\n").length, 0);
});

check("const 放行（本闸只测可重绑定态）", () => {
  assert.equal(scanText(F, "const c = 1;\nconst m = new Map();\n").length, 0);
});

check("顶层 for-let 放行（块作用域非模块态）", () => {
  assert.equal(scanText(F, "for (let i = 0; i < 3; i++) {}\n").length, 0);
});

check("块注释内的 let 形状放行（stripNoise）", () => {
  assert.equal(scanText(F, "/*\nlet ghost = 1;\n*/\nlet real = 2;\n").length, 1);
});

check("行注释内的 let 形状放行", () => {
  assert.equal(scanText(F, "// let ghost = 1;\nlet real = 2;\n").length, 1);
});

check("模板字面量内的 let 形状放行（含跨行）", () => {
  assert.equal(scanText(F, "const s = `\nlet ghost = 1;\n`;\nlet real = 2;\n").length, 1);
});

check("moduleLevelLets 与 scanText 同源（检测面可直测）", () => {
  assert.equal(moduleLevelLets("let a = 1;\n").length, 1);
});

/* ── 1b. 复位出口（合规 a 路）── */

check("__reset*ForTest 出口 → 整文件受管", () => {
  const t = "let s = 0;\nexport function __resetSForTest(): void { s = 0; }\n";
  assert.equal(scanText(F, t).length, 0);
});

check("reset* 出口放行（生产复位函数）", () => {
  assert.equal(scanText(F, "let n = 0;\nexport function resetEncoderState(): void { n = 0; }\n").length, 0);
});

check("clear* 出口放行", () => {
  assert.equal(scanText(F, "let store = [];\nexport function clearLoadTraces(): void { store = []; }\n").length, 0);
});

check("可传 null 的 set* 注入 setter 放行（含嵌套括号形参）", () => {
  const t = "let p = null;\nexport function setCaps(p2: (() => void) | null): void { p = p2; }\n";
  assert.equal(scanText(F, t).length, 0);
});

check("形参经本地类型别名间接含 null → 放行（overlay-style-bridge 实证形态）", () => {
  const t =
    "export type Target = HTMLElement | ShadowRoot | null;\n" +
    "let _t: Target = null;\n" +
    "export function setTarget(t: Target): void { _t = t; }\n";
  assert.equal(scanText(F, t).length, 0);
});

check("不可传 null 的 set* 不放行（防 setter 一刀切放行）", () => {
  const t = "let c = 0;\nexport function setEnabled(enabled: boolean): void { c = enabled ? 1 : 0; }\n";
  assert.equal(scanText(F, t).length, 1);
});

/* ── 1c. 行级豁免（合规 b 路）── */

check("声明行尾 singleton-allow 注豁免", () => {
  assert.equal(scanText(F, "let c = 0; // singleton-allow: 单调计数器\n").length, 0);
});

check("声明行上方 2 行的 singleton-allow 注豁免", () => {
  assert.equal(scanText(F, "// singleton-allow: 惰性单例\n// 说明第二行\nlet c = 0;\n").length, 0);
});

check("空理由的 singleton-allow 不豁免（防注滥用）", () => {
  assert.equal(scanText(F, "// singleton-allow:\nlet c = 0;\n").length, 1);
  assert.equal(scanText(F, "// singleton-allow:   \nlet c = 0;\n").length, 1);
});

check("窗口外（5 行前）的 singleton-allow 不豁免", () => {
  assert.equal(scanText(F, "// singleton-allow: 太远了\n\n\n\n\nlet c = 0;\n").length, 1);
});

check("豁免窗口 = 声明行 + 前 3 行（边界钉死）", () => {
  // 第 3 行前（距声明 3 行）命中窗口内
  assert.equal(scanText(F, "// singleton-allow: 边界内\n\n\nlet c = 0;\n").length, 0);
  // 第 4 行前 → 窗口外
  assert.equal(scanText(F, "// singleton-allow: 边界外\n\n\n\nlet c = 0;\n").length, 1);
});

check("SINGLETON_ALLOW_RE 要求非空理由", () => {
  assert.ok(SINGLETON_ALLOW_RE.test("singleton-allow: x"));
  assert.ok(!SINGLETON_ALLOW_RE.test("singleton-allow:"));
});

/* ── 2. 计数基线 diff ── */

check("diffBaseline：持平无回归无 fixed", () => {
  const c = { [F]: { "unmanaged-let": 2 } };
  const d = diffBaseline(c, c);
  assert.deepEqual(d.regressions, []);
  assert.deepEqual(d.fixed, []);
});

check("diffBaseline：计数上升 = 回归（带文件与规则名）", () => {
  const d = diffBaseline({ [F]: { "unmanaged-let": 3 } }, { [F]: { "unmanaged-let": 2 } });
  assert.equal(d.regressions.length, 1);
  assert.match(d.regressions[0]!, /fake\.ts/);
  assert.match(d.regressions[0]!, /unmanaged-let/);
  assert.deepEqual(d.fixed, []);
});

check("diffBaseline：计数下降 = fixed", () => {
  const d = diffBaseline({ [F]: { "unmanaged-let": 1 } }, { [F]: { "unmanaged-let": 2 } });
  assert.deepEqual(d.regressions, []);
  assert.equal(d.fixed.length, 1);
});

check("diffBaseline：基线外新文件 = 回归", () => {
  const d = diffBaseline({ [F]: { "unmanaged-let": 1 } }, {});
  assert.equal(d.regressions.length, 1);
});

/* ── 3. 真实树非空转 ── */

check("真实树扫描非空转（>200 生产文件）且检测器真看到树", () => {
  const files = collectProductionFiles();
  assert.ok(files.length > 200, `扫描文件数应 > 200，实际 ${files.length}——SCAN_AREA 失效？`);
  const hits = scanAll();
  // 检测器非空转的强判据：基线由本树生成，若检测器失效（恒 0 命中），
  // 基线里的每条都会变成 fixed → 子进程 --json 的 fixed 必然 > 0（用例 4 断言）。
  assert.ok(Array.isArray(hits), "scanAll 应返回数组");
});

/* ── 4. 子进程契约 ── */

check("--json 合法且 _summary 契约齐全、零回归零 fixed", () => {
  const { rc, out } = runGate(["--json"]);
  const data = JSON.parse(out);
  assert.ok(data._summary, "缺 _summary");
  assert.equal(typeof data._summary.ok, "boolean", "_summary.ok 应为 boolean");
  for (const k of ["total", "files", "scannedFiles", "baseline", "regressions", "fixed"]) {
    assert.equal(typeof data._summary[k], "number", `_summary.${k} 应为 number`);
  }
  assert.equal(data._summary.ok, true, "当前应通过（基线内）");
  assert.ok(data._summary.scannedFiles > 200, "scannedFiles 应 > 200");
  assert.equal(data._summary.regressions, 0, `不应有回归：${JSON.stringify(data.regressions)}`);
  assert.equal(data._summary.fixed, 0, "不应有 fixed（有则说明基线含幽灵条目或检测器失明）");
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}`);
});

check("基线文件存在且 counts 结构合法", () => {
  assert.ok(fs.existsSync(BASELINE), "基线缺失：先跑 --update 初始化");
  const data = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  assert.ok(data._comment, "基线应带 _comment 说明");
  assert.equal(typeof data.counts, "object");
  for (const [file, rules] of Object.entries(data.counts as Record<string, Record<string, number>>)) {
    assert.ok(file.startsWith("frontend/src/"), `基线 key 应为 src 相对式仓库路径：${file}`);
    for (const n of Object.values(rules)) assert.equal(typeof n, "number");
  }
});

check("--help 退 0", () => {
  assert.equal(runGate(["--help"]).rc, 0);
});

check("未知参数退 2（ADR-043 陷阱 #12）", () => {
  assert.equal(runGate(["--bogus"]).rc, 2);
});

check("--update 幂等：树未变时报「基线无变化」且退 0", () => {
  const before = fs.readFileSync(BASELINE, "utf8");
  const { rc, out } = runGate(["--update"]);
  assert.equal(rc, 0, out);
  assert.match(out, /基线无变化/);
  assert.equal(fs.readFileSync(BASELINE, "utf8"), before, "--update 不应改写未变化的基线");
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 个用例失败：`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\n✅ 全部用例通过");
