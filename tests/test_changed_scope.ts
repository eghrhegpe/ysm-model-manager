#!/usr/bin/env node
/**
 * test_changed_scope.ts — 变更域过滤共享层契约测试（scripts/_lib/changed-scope.ts）。
 *
 * 锁三个扫描器（check-complexity / check-params / check-type-safety）接门禁前的
 * 增量裁剪契约——它是「存量债不淹没本次变更」的唯一实现点，错了会同时影响三者：
 *   - parseChangedFiles：换行分隔列表 → 集合；反斜杠归一化；空/非字符串 → null。
 *   - inChangedScope：未启用过滤（null）恒 true；命中/未命中；反斜杠输入归一化。
 *   - resolveChangedScope：三路优先级（--files 优先 → --changed → 全库）与
 *     **fail-closed 不变量**——`--files` 空列表必须报 error（不许静默退回全库），
 *     `--changed` 自动解析失败时必须报 error（同 gate-parse 第 4 条纪律）。
 *
 * resolveLocalChanged 依赖本机 git 状态（CI 浅克隆 / 无远端时不可用），故只断言
 * 「形状」与「不变量」，不断言具体文件集——避免把环境差异固化成红。
 *
 * 运行：node tests/test_changed_scope.ts（失败 exit 1；契约 runner 收集）。
 */
import assert from "node:assert/strict";
import {
  inChangedScope,
  parseChangedFiles,
  resolveChangedScope,
  resolveLocalChanged,
} from "../scripts/_lib/changed-scope.ts";

// ─── 1) parseChangedFiles：换行列表 → 集合 ────────────────
{
  const s = parseChangedFiles("frontend/src/a.ts\nfrontend/src/b.ts");
  assert.ok(s instanceof Set, "非空列表应返回 Set");
  assert.equal(s!.size, 2, "两行 → 两个元素");
  assert.ok(s!.has("frontend/src/a.ts"), "应含首行路径");

  // 反斜杠（Windows 调用方）归一化为正斜杠，与 pre-push-gate 的 --files 口径一致
  const w = parseChangedFiles("frontend\\src\\a.ts");
  assert.ok(w!.has("frontend/src/a.ts"), "反斜杠路径应归一化为正斜杠");

  // 空行 / 空白项剔除，不产生空字符串键
  const padded = parseChangedFiles("\n  frontend/src/a.ts  \n\n");
  assert.equal(padded!.size, 1, "空白行应被剔除");
  assert.ok(padded!.has("frontend/src/a.ts"), "首尾空白应 trim");
}

// ─── 2) parseChangedFiles：空 / 非字符串 → null ──────────
{
  assert.equal(parseChangedFiles(""), null, "空串 → null（缺省）");
  assert.equal(parseChangedFiles("\n\n"), null, "全空白行 → null");
  assert.equal(parseChangedFiles(null), null, "null → null");
  assert.equal(parseChangedFiles(undefined), null, "undefined → null");
  assert.equal(parseChangedFiles(123), null, "非字符串 → null");
}

// ─── 3) inChangedScope：未启用过滤恒 true ───────────────
{
  const scope = parseChangedFiles("frontend/src/a.ts")!;
  assert.equal(inChangedScope("frontend/src/a.ts", scope), true, "命中");
  assert.equal(inChangedScope("frontend/src/b.ts", scope), false, "未命中");
  assert.equal(inChangedScope("frontend\\src\\a.ts", scope), true, "反斜杠输入应归一化后命中");
  assert.equal(inChangedScope("frontend/src/z.ts", null), true, "scope=null 恒 true（全库）");
  assert.equal(inChangedScope("frontend/src/z.ts", undefined), true, "scope=undefined 恒 true");
}

// ─── 4) resolveChangedScope：三路优先级 ─────────────────
{
  // ① --files 优先（门禁/CI 侧），此时忽略 --changed
  const r1 = resolveChangedScope("frontend/src/a.ts", true);
  assert.ok(r1.scope instanceof Set && r1.scope!.has("frontend/src/a.ts"), "--files 命中即用");
  assert.equal(r1.error, undefined, "合法 --files 不应报错");

  // ② 两 flag 皆缺 → 全库（向后兼容，既有调用零行为变更）
  const r2 = resolveChangedScope(null, false);
  assert.equal(r2.scope, null, "缺省 → scope=null（全库）");
  assert.equal(r2.error, undefined, "缺省不算错误");
}

// ─── 5) resolveChangedScope：fail-closed 不变量 ─────────
{
  // --files 给了但为空 → 调用方 bug，必须报错而非静默退回全库
  const empty = resolveChangedScope("", false);
  assert.equal(empty.scope, null, "空 --files 不产生 scope");
  assert.ok(empty.error, "空 --files 必须报 error（否则「传了但没内容」= 假绿）");

  // --changed 自动解析：要么拿到 scope，要么拿到 error——绝不「无 scope 且无 error」
  // （后者会让调用方静默退回全库扫描，存量债淹没本次变更）
  const auto = resolveChangedScope(null, true);
  const okShape = auto.scope instanceof Set && auto.error === undefined;
  const failShape = auto.scope === null && typeof auto.error === "string";
  assert.ok(okShape || failShape, "--changed 必须给出 scope 或 error 之一（fail-closed 不变量）");
}

// ─── 6) resolveLocalChanged：形状（不断言具体文件集）──────
{
  const list = resolveLocalChanged();
  if (list !== null) {
    assert.ok(Array.isArray(list), "非 null 时必为数组");
    assert.ok(list.length > 0, "非 null 时不应为空数组");
    assert.ok(
      list.every((f) => typeof f === "string" && f.length > 0 && !f.includes("\\")),
      "全部为非空正斜杠相对路径",
    );
  }
}

console.log("✅ test_changed_scope.ts 全部通过（6 组契约断言）");
