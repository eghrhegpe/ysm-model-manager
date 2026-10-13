#!/usr/bin/env node
/**
 * 契约测试：i18n-frozen-t-check.ts — 模块级冻结 t() 门禁的**判别力**（防假绿空转）。
 *
 * 背景（2026-10-13 诊断页锐评 P0）：`const OP_META = { import: { label: t("…") } }` 这类
 * 模块构建期求值的 t() 把译文焊死在首查语言包上；`lang:changed` 只重建 DOM 不重建模块，
 * en/ja 界面下这些标签永远中文。既有四道 i18n 闸查「有没有包 t()」，对「包得太早」失明。
 * 本测试锁第五闸的判据本身——正反例都判得动（同 test_i18n_ui_check 纯核直测惯例）。
 *
 * 判别力实证（开发期踩过的两个假绿面，各有锁死用例）：
 *   · TOP_DECL 曾在名字与 = 之间漏 `\s*`：`const X = t("k")` 普通形态全漏报，只有带
 *     类型注解的 `const X: T = {…}` 侥幸匹配——vrm VRM_PLAY_NOTICE 两处静默失踪即现场。
 *   · 类型注解段曾禁分号（`[^=;]`）：`Record<string, { label: string; icon: string }>`
 *     内分号截断匹配，logs.ts OP_META / health.ts VERDICT_BANDS 整表漏报。
 *
 * 零依赖（node:assert / node:path / node:url）。运行：node tests/test_i18n_frozen_t_check.ts
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSourceText } from "../scripts/i18n-frozen-t-check.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts", "i18n-frozen-t-check.ts");

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
const hitCount = (src: string) => scanSourceText(src).length;

/* ---------- 命中面（真病灶） ---------- */

check("顶层裸赋 t() 命中（vrm VRM_PLAY_NOTICE 形态）", () => {
  assert.equal(hitCount('const N = t("preview.playNotice");'), 1, "普通 const X = t() 必须命中");
});

check("对象属性焊死命中（OP_META / VERDICT_BANDS 形态，含复杂类型注解）", () => {
  assert.equal(
    hitCount(
      'const OP_META: Record<string, { label: string; icon: string }> = {\n  import: { label: t("diagnostics.opImport"), icon: "x" },\n};',
    ),
    1,
    "带分号的泛型注解不得截断声明匹配",
  );
  assert.equal(
    hitCount('const B = {\n  good: { color: "c", label: t("healthGood") },\n};'),
    1,
    "跨行对象初始化区须命中",
  );
});

check("三元分支仍在构建期命中（health 回退带形态）", () => {
  assert.equal(hitCount('const S = ok ? t("diagnostics.a") : t("diagnostics.b");'), 1);
});

check("模板串插值里的 t() 命中（插值块是代码态）", () => {
  assert.equal(hitCount('const H = { x: `${t("k")}` };'), 1);
});

check("export 前缀同样命中", () => {
  assert.equal(hitCount('export const IDS = ["a", "b"].map((x) => x); void IDS;'), 0);
  assert.equal(hitCount('export const M = { a: t("k") };'), 1);
});

/* ---------- 豁免面（合法写法不得误伤） ---------- */

check("惰性箭头工厂豁免（=> t( 调用期求值）", () => {
  assert.equal(hitCount('const f = () => t("k");'), 0);
  assert.equal(hitCount('const M = { x: () => t("k") };'), 0, "属性是闭包 = 合法");
});

check("函数体不算（相对深度出初始化区）", () => {
  assert.equal(hitCount('function label() {\n  return t("k");\n}'), 0);
  assert.equal(
    hitCount(
      'export function perfScopeHint(mode) {\n  const s = t("diagnostics.perfScopeHint");\n  return s;\n}',
    ),
    0,
  );
});

check("表只存 key（正确范式）零命中", () => {
  assert.equal(
    hitCount(
      'const STRATS = [{ value: "a", labelKey: "diagnostics.resolveA" }];\nfunction l(v) {\n  return t(v);\n}',
    ),
    0,
  );
});

check("注释里的 t() 被遮罩（注释非代码）", () => {
  assert.equal(hitCount('// const X = t("k");\n/* const Y = t("j"); */\nconst z = 1;'), 0);
});

check("i18n-allow 台账豁免（命中行 / 上一行）", () => {
  assert.equal(hitCount('const X = t("k"); // i18n-allow: 有意焊死基准\n'), 0);
  assert.equal(hitCount('// i18n-allow: 刻意首屏定格\nconst X = t("k");'), 0);
});

check("xxx.t( 属性调用与 t 形参名不误伤", () => {
  assert.equal(hitCount('const X = obj.t("k");'), 0);
  assert.equal(hitCount('const X = someT("k");'), 0);
  assert.equal(hitCount('const X = interpolate("k");'), 0);
});

check("== 比较与 => 函数映射不误判为声明", () => {
  assert.equal(hitCount('const ok = a == b;\nfunction f() {\n  return t("k");\n}'), 0);
});

/* ---------- 真仓 CLI：存量清零 + flag 守卫 ---------- */

check("真仓 --strict 恒绿（存量冻结点已全清，防空转也防复发）", () => {
  execFileSync(process.execPath, [CLI, "--strict"]);
});

check("--stric 拼错 flag 退 1（防静默关闸假绿）", () => {
  let code = 0;
  try {
    execFileSync(process.execPath, [CLI, "--stric"], { stdio: "pipe" });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 1, "未知 flag 必须拦截，不得静默放行");
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 项失败`);
  process.exit(1);
}
console.log("\n✅ i18n-frozen-t-check 契约测试全过");
