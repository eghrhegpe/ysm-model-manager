#!/usr/bin/env node
/**
 * test_check_type_safety.ts — 类型安全侵蚀扫描器契约测试。
 *
 * 锁 `check-type-safety.ts` 的核心：
 *   - `countLineSignals`：信号翻译层（组合正则 + 捕获组归类）——深绑定生产实现，
 *     防「测试手抄正则」漂移；重点锁歧义场景（as any vs as Element、Array<any> 不双计、
 *     注释剔除由调用方负责、@ts-apply 之类近形不误命中）。
 *   - `erosionOf`：加权聚合 Σ weight×count。
 *   - `tierOf`：分级边界。
 *   - `EROSION_WEIGHTS`：权重大小序不变量（tsIgnore 最重、非空最轻）。
 *   - `isProdSourceFile`：生产文件过滤（vendor/.d.ts/测试目录/测试文件排除）。
 *
 * 运行：node tests/test_check_type_safety.ts
 * 用 assert 实现（不计走测试框架）；失败 exit 1。
 */
import assert from "node:assert/strict";
import {
  countLineSignals,
  EROSION_WEIGHTS,
  erosionOf,
  isProdSourceFile,
  type TypeErosionSignal,
  tierOf,
} from "../scripts/check-type-safety.ts";

const ZERO = { tsIgnore: 0, tsExpectError: 0, asAny: 0, colonAny: 0, anyGeneric: 0, nonNull: 0 };

// ─── 1) countLineSignals：歧义 / 不双计场景 ────────────────
{
  // `as any` 与 `as Element`/`as string` 区分：只计 any。
  const c = countLineSignals("const el = x as any as Element;");
  assert.equal(c.asAny, 1, "as any=1");
  assert.equal(c.anyGeneric, 0, "as Element 不命中 anyGeneric");
  assert.equal(erosionOf(c), 2, "as any 权重 2");

  // Array<any> 只在 colonAny 命中一次（不被 <any> 双计）；显式 `: any` 命中 colonAny。
  const c2 = countLineSignals("const x: any = 1; const p: Promise<any> = f();");
  assert.equal(c2.colonAny, 2, "x:any 与 Promise<any> 各 1");
  assert.equal(c2.anyGeneric, 0, "Promise<any> 内 <any> 不双计到 anyGeneric");
}

// ─── 2) countLineSignals：各类信号各行命中 ────────────────
{
  // `as any`/`Promise<any>` 计入；块注释 Mid-line 的 @ts-expect-error 非「行首指令」不计（指令必整行）。
  const c = countLineSignals(
    "function f(x: any, y: Promise<any>) { const a = b as any; /* @ts-ignore */ c! ; }",
  );
  assert.equal(c.colonAny, 2, "x:any 与 Promise<any> 各 1");
  assert.equal(c.asAny, 1, "as any=1");
  assert.equal(c.tsIgnore, 0, "行中块注释里的 @ts-ignore 非指令，不计");
  assert.equal(c.nonNull, 1, "非空断言 ! =1");
  assert.equal(c.anyGeneric, 0, "Promise<any> 内 <any> 不双计");
}

// ─── 3) erosionOf：加权 Σ ────────────────────────────────
{
  const c: Record<TypeErosionSignal, number> = {
    ...ZERO,
    asAny: 2,
    tsIgnore: 1,
    nonNull: 5,
  };
  // 2*2 + 4*1 + 0.2*5 = 4 + 4 + 1 = 9
  assert.equal(erosionOf(c), 9, "加权总分 9");
  assert.equal(erosionOf(ZERO), 0, "零信号=0");
}

// ─── 4) tierOf：分级边界（threshold=8）───────────────────
{
  assert.equal(tierOf(7, 8), "clean", "7<8 clean");
  assert.equal(tierOf(8, 8), "yellow", "8=threshold yellow");
  assert.equal(tierOf(15, 8), "yellow", "15 仍需 <2*8 yellow");
  assert.equal(tierOf(16, 8), "orange", "16=2*8 orange");
  assert.equal(tierOf(23, 8), "orange", "23 <3*8 orange");
  assert.equal(tierOf(24, 8), "red", "24=3*8 red");
}

// ─── 5) EROSION_WEIGHTS：不变量（危险度排序）───────────────
{
  const w = EROSION_WEIGHTS;
  assert.ok(w.tsIgnore > w.tsExpectError, "@ts-ignore 重于 @ts-expect-error");
  assert.ok(w.tsExpectError > w.asAny, "@ts-expect-error 重于 as any");
  assert.ok(w.asAny === w.colonAny, "as any 与 :any 同权 2");
  assert.ok(w.asAny > w.anyGeneric, "显式 any 重于 <any> 泛型");
  assert.ok(w.anyGeneric > w.nonNull, "<any> 重于非空断言");
  assert.equal(w.nonNull, 0.2, "非空断言轻权 0.2");
}

// ─── 6) isProdSourceFile：生产/非生产过滤 ────────────────
{
  assert.equal(isProdSourceFile("preview-3d/menu/panels/env.ts"), true, "普通 ts 保留");
  assert.equal(isProdSourceFile("views/app-tree/render.ts"), true, "views ts 保留");
  assert.equal(
    isProdSourceFile("preview-3d/vendor/babylon-mmd/pmxReader.d.ts"),
    false,
    "vendor 排除",
  );
  assert.equal(isProdSourceFile("utils/dom/foo.d.ts"), false, ".d.ts 排除");
  assert.equal(isProdSourceFile("views/__tests__/x.ts"), false, "__tests__ 目录排除");
  assert.equal(isProdSourceFile("views/app-tree/render.test.ts"), false, ".test.ts 排除");
  assert.equal(isProdSourceFile("views/app-tree/render.spec.tsx"), false, ".spec.tsx 排除");
}

// ─── 7) isProdSourceFile：comment 行指令语义由调用方归约，此处锁 countLineSignals 根基 ──
{
  // countLineSignals 是纯正则翻译层：`// @ts-expect-error` 指令所在行照常命中指令信号，
  // 说明文字 "as any" 也会命中（剔除伪信号归 scanSingle 的注释判断，属调用层）。
  const c = countLineSignals("// @ts-ignore: 相邻 is any");
  assert.equal(c.tsIgnore, 1, "指令 @ts-ignore 计入");
}

console.log("✅ test_check_type_safety.ts 全部通过 (8 组断言)");
