#!/usr/bin/env node
/**
 * 契约测试：css-layer-check.ts 的 TS 插值展开逻辑（2026-09-14 锐评修复的回归锁）。
 *
 * 背景：shadow CSS 以 TS 模板串承载，跨 shadow 共享的 keyframes 收敛为常量后经
 * `${FADE_SLIDE_LEFT}` 注入（sidebar-css.ts 末尾、content-layout.ts:39）。css-layer-check
 * 按源文件文本正则扫 @keyframes，看不见插值 → 曾把「运行时确实生效」的定义判成 4 条
 * 假阳性 ERROR（gate-config hard 项恒红 → CI 无法接线）。修复 = 聚合前展开 import 的
 * 含 @keyframes 常量。本测试锁死展开语义，防止回归成假阳性/误伤两种方向。
 *
 * 锁定的语义：
 *   1. @/ 别名 import + ${IDENT} → 展开为 @keyframes 定义，且不残留占位符
 *   2. 不存在的常量保持原样（不因 tooling 变化制造新假阳性）
 *   3. 无 ${ 的文本原样返回（性能守卫：不触发 import 解析）
 *   4. resolveImportAbs：相对路径解析 / 裸包导入排除（裸包不参与 shadow CSS 组装）
 *   5. readConstLiteral 可读跨行字符串字面量
 *
 * 依赖：node:assert / node:fs / node:path / node:url / ../scripts/css-layer-check.ts。
 * 注意：import 该脚本会连带执行其主体检查（约 0.2s 全仓扫描），属已知副作用，无碍判定。
 * 用法：node tests/test_css_layer_check.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（node:assert 抛错）。
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandKeyframeInterpolations,
  readConstLiteral,
  resolveImportAbs,
} from "../scripts/css-layer-check.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIAG_ABS = path.join(ROOT, "frontend/src/views/app-content/css/content-diag.ts");
const FSL = "${" + "FADE_SLIDE_LEFT" + "}";

// ── 1. @/ 别名 + ${FADE_SLIDE_LEFT} → 展开为 @keyframes ──
{
  const css = `import { FADE_SLIDE_LEFT } from "@/views/css/keyframes.ts";\n.log-row { animation: fadeSlideLeft .25s ease both; }\n${FSL}`;
  const out = expandKeyframeInterpolations(css, DIAG_ABS);
  assert.ok(out.includes("@keyframes fadeSlideLeft"), "插值应展开为 @keyframes 定义");
  assert.ok(!out.includes(FSL), "展开后不应残留 ${FADE_SLIDE_LEFT}");
  console.log("  ✓ @/ 别名 + ${FADE_SLIDE_LEFT} 展开为 @keyframes");
}

// ── 2. 不存在的常量保持原样（无假阳性）──
{
  const token = "${" + "FOO_NON_EXISTENT" + "}";
  const css = `import { FOO_NON_EXISTENT } from "@/views/css/keyframes.ts";\n${token}`;
  const out = expandKeyframeInterpolations(css, DIAG_ABS);
  assert.ok(out.includes(token), "解析不出的常量应保持原样");
  console.log("  ✓ 不存在的常量不展开");
}

// ── 3. 无 ${ 原样返回（性能守卫）──
{
  const css = ".a { color: red; }";
  const out = expandKeyframeInterpolations(css, path.join(ROOT, "x.ts"));
  assert.equal(out, css, "无插值应原样返回同一文本");
  console.log("  ✓ 无 ${ 原样返回");
}

// ── 4. resolveImportAbs：相对路径 / 裸包排除 ──
{
  const fromAbs = path.join(ROOT, "frontend/src/views/app-sidebar/sidebar-css.ts");
  assert.equal(
    resolveImportAbs("./css.ts", fromAbs),
    path.join(ROOT, "frontend/src/views/app-sidebar/css.ts"),
    "相对路径应解析到同目录",
  );
  assert.equal(resolveImportAbs("vue", fromAbs), null, "裸包导入不参与展开");
  console.log("  ✓ resolveImportAbs：相对路径解析 / 裸包排除");
}

// ── 5. readConstLiteral 跨行字面量 ──
{
  const src = 'export const X =\n  "@keyframes a { }";\n';
  assert.equal(readConstLiteral(src, "X"), "@keyframes a { }", "跨行字符串字面量应可读");
  console.log("  ✓ readConstLiteral 跨行字面量");
}

console.log("\nOK: css-layer-check 插值展开契约（回归锁 5 条）");
