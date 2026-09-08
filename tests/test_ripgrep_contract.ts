#!/usr/bin/env node
/**
 * 契约测试：ripgrep 共享层（rg / rgSafe 的参数守卫 + 真实扫描集成）。
 *
 * 背景（2026-09-08 脚本体系锐评）：ripgrep.ts 是「全仓扫描的底层管道」
 * （check-redlines / comment-checker / 60+ 脚本共用），却无契约测试。它的
 * 参数守卫（空 pattern / 空 paths / 绝对路径拒绝）若失效，会把编程错误误判为
 * 「无匹配」静默漏检，或扫错目录（锐评 P1 命根子）。
 *
 * 本测试钉住：
 *   1. rg 入参守卫：空 pattern / 空 paths / 非字符串元素 / 绝对路径 → 抛错
 *   2. rgSafe：捕获抛错转 WARN 返回 []
 *   3. 真实 rg：扫当前仓库某确定文件行，输出格式为 `file:line:content`（rg 可用时）
 *
 * 运行：node tests/test_ripgrep_contract.ts
 */
import assert from 'node:assert';
import { rg, rgSafe } from '../scripts/_lib/ripgrep.ts';

// ── 1. 入参守卫：非法输入应抛错（fail-fast，不静默漏检）──

assert.throws(() => rg('', ['docs']), /pattern 不能为空/, '空 pattern 应抛错');
assert.throws(() => rg('x', []), /paths 为空/, '空 paths 应抛错');
assert.throws(() => rg('x', '') as never, /非空字符串|paths 为空/, '空字符串 paths 元素应抛错（非空串或为空）');
assert.throws(() => rg('x', ['/abs/path']) as never, /相对仓库根路径/, '绝对路径 paths 元素应抛错');
assert.throws(() => rg('x', [null as unknown as string]) as never, /非空字符串/, 'null paths 元素应抛错');

console.log('  ✓ rg 入参守卫：空 pattern/paths/绝对路径/非法元素均抛错（fail-fast）');

// ── 2. rgSafe：吞错返回 [] ─────────────────────────

assert.deepEqual(rgSafe('', ['docs']), [], 'rgSafe 空 pattern 应转 WARN 返回 []');
assert.deepEqual(rgSafe('x', ['/abs']), [], 'rgSafe 绝对路径应转 WARN 返回 []');

console.log('  ✓ rgSafe：守卫抛错捕获为 WARN 返回 []（不崩溃不假绿）');

// ── 3. 真实扫描（集成）：输出行格式契约 ────────────────

// rg 可能未安装（环境无 rg）→ 用 rgSafe 探测，可跳过真实部分
const probe = rgSafe('YSM', ['AGENTS.md']);
if (probe.length > 0) {
  const first = probe[0];
  // 单文件路径下 rg --no-heading 输出格式为 `行号:内容`（无文件名前缀）；多文件才有 file:line
  assert.ok(/^\d+:/ .test(first), `匹配行应以行号冒号开头（line:content）（got "${first.slice(0, 40)}..."）`);
  assert.ok(first.includes('YSM'), `匹配行应含匹配词 "YSM"（got "${first.slice(0, 40)}..."）`);
  console.log(`  ✓ rg 真实扫描：${probe.length} 行匹配，输出 line:content 格式正确（有 rg）`);
} else {
  console.log('  ~ rg 未安装或无可匹配，真实扫描部分跳过（rgSafe 守卫路径已覆盖）');
}

console.log('\nOK: ripgrep 契约测试全过');