#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gate-config.ts 静态工具清单配置漂移守护。
 *
 * 背景（ADR-088）：pre-push-gate 曾长期内联 4 个工具清单，新增/改名工具时清单与
 * gate 调度逻辑双处维护极易漂移。清单已下沉本模块单点维护，本测试锁死其自洽：
 *   1. 每个引用的工具文件真实存在（脚本改名/归档后清单漏改 → 立即浮出）
 *   2. 单清单内无重复工具引用
 *   3. DOC_STATIC_TOOLS 是 ALL_STATIC_TOOLS 的子集（文档域 ⊆ 全量域）
 *   4. SCRIPTS_TYPECHECK 容忍 rc=2（TS18003 无输入，见模块注释）
 *
 * 零依赖（仅 node:assert / node:fs / node:path）。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_STATIC_TOOLS,
  DOC_STATIC_TOOLS,
  FRONTEND_STATIC_TOOLS,
  GO_STATIC_TOOLS,
  DOC_EXTRA_SCRIPTS,
  SCRIPTS_TYPECHECK,
} from '../scripts/_lib/gate-config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 把条目规范化为工具名（string → 自身；object → .tool）。 */
function toolName(e: string | { tool: string; [k: string]: unknown }): string {
  return typeof e === 'string' ? e : e.tool;
}

/** 断言清单每个工具引用都存在对应脚本文件（tsc 等外部可执行豁免）。 */
function assertToolsExist(list: readonly (string | { tool: string; [k: string]: unknown })[], label: string) {
  for (const e of list) {
    const name = toolName(e);
    if (name === 'tsc') continue; // 外部可执行，非 scripts/ 下脚本
    const p = path.join(ROOT, 'scripts', name.endsWith('.ts') || name.endsWith('.mjs') ? name : name + '.ts');
    assert.ok(fs.existsSync(p), `[gate-config] ${label} 引用不存在的工具脚本: ${name}（${p}）`);
  }
}

/** 断言清单内无重复工具引用。 */
function assertNoDuplicate(list: readonly (string | { tool: string; [k: string]: unknown })[], label: string) {
  const seen = new Set<string>();
  for (const e of list) {
    const name = toolName(e);
    assert.ok(!seen.has(name), `[gate-config] ${label} 重复引用工具: ${name}`);
    seen.add(name);
  }
}

assertToolsExist(ALL_STATIC_TOOLS, 'ALL_STATIC_TOOLS');
assertToolsExist(DOC_STATIC_TOOLS, 'DOC_STATIC_TOOLS');
assertToolsExist(FRONTEND_STATIC_TOOLS, 'FRONTEND_STATIC_TOOLS');
assertToolsExist(GO_STATIC_TOOLS, 'GO_STATIC_TOOLS');
assertToolsExist(DOC_EXTRA_SCRIPTS, 'DOC_EXTRA_SCRIPTS');

assertNoDuplicate(ALL_STATIC_TOOLS, 'ALL_STATIC_TOOLS');
assertNoDuplicate(DOC_STATIC_TOOLS, 'DOC_STATIC_TOOLS');
assertNoDuplicate(FRONTEND_STATIC_TOOLS, 'FRONTEND_STATIC_TOOLS');
assertNoDuplicate(GO_STATIC_TOOLS, 'GO_STATIC_TOOLS');
assertNoDuplicate(DOC_EXTRA_SCRIPTS, 'DOC_EXTRA_SCRIPTS');

// 文档域清单应是全量域清单的子集（按工具名，doc 工具不该出现在 all 之外）。
const allNames = new Set(ALL_STATIC_TOOLS.map(toolName));
for (const e of DOC_STATIC_TOOLS) {
  const name = toolName(e);
  assert.ok(allNames.has(name), `[gate-config] DOC_STATIC_TOOLS 含不在 ALL_STATIC_TOOLS 的工具: ${name}`);
}

// SCRIPTS_TYPECHECK 必须容忍 rc=2（无输入时 tsc 返回 TS18003）。
assert.equal(typeof SCRIPTS_TYPECHECK === 'object' && SCRIPTS_TYPECHECK.allowRc2, true, 'SCRIPTS_TYPECHECK 应 allowRc2=true');

// 结构性：object 条目必须带字符串 tool。
for (const list of [ALL_STATIC_TOOLS, DOC_STATIC_TOOLS, FRONTEND_STATIC_TOOLS, GO_STATIC_TOOLS, DOC_EXTRA_SCRIPTS]) {
  for (const e of list) {
    if (typeof e !== 'string') {
      assert.equal(typeof e.tool, 'string', `[gate-config] object 条目缺 tool: ${JSON.stringify(e)}`);
    }
  }
}

console.log('OK: gate-config 静态工具清单自洽（引用存在 / 无重复 / 子集关系 / rc2 容忍）');