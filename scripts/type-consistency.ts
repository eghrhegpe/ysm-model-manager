#!/usr/bin/env node
/**
 * type-consistency.ts — resource_types.json 单一事实来源「派生守卫」。
 *
 * 设计意图：守护 ADR-014 / T2「extensions.ts 必须派生自 resource_types.json，
 * 禁止手写 RESOURCE_EXTS 字面量副本」这一单一事实来源红线。
 *
 * 历史演进（ADR-204）：
 *   本脚本原做 resource_types.json ↔ extensions.ts 字面量比对（JSON↔JS）。
 *   T2 后 extensions.ts 改为构建期从 schema.ts / resource_types.json 派生
 *   （Object.fromEntries），字面量比对随之成为**不可达死代码**——readJsExtensions
 *   派生完好即返回 null（比对分支永不进），派生被破坏即 throw(fatal)。
 *   比对职责已下沉 Go 侧 resource_types_consistency_test.go（dup id 等结构性校验）。
 *   故本脚本收敛为「派生守卫」单一职责：确保 extensions.ts 仍从 JSON 派生，
 *   而非回潮为手写副本（手写副本 tsc 抓不到，只有此正则守卫能拦）。
 *
 * 依赖：node:fs / node:path / _lib/scan-files.ts（getRoot）。
 *
 * 退出码：派生完好 → 0（无 issues）；派生被破坏（手写副本）→ 1（fatal，_summary.issues=9999）。
 *
 * 用法：
 *   node scripts/type-consistency.ts            # 文本报告
 *   node scripts/type-consistency.ts --json     # JSON 输出（CI / 子代理 / pre-push-gate 消费）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.ts';

const ROOT = getRoot();

/**
 * 校验 extensions.ts 仍从 resource_types.json 派生 RESOURCE_EXTS。
 * 派生完好 → 返回（不抛）；手写副本 / 派生链路断裂 → 抛错走 fatal（fail-closed）。
 *
 * 链路判定：
 *   - 必须 `export const RESOURCE_EXTS` 且经 `Object.fromEntries` 派生；
 *   - 入口须为链路 A（直接 import resource_types.json）或链路 B（import allResourceTypes from ./schema.ts，T2 后唯一入口）。
 */
function assertExtensionsDerived() {
  const fp = path.join(ROOT, 'frontend/src/utils/resource/extensions.ts');
  const text = fs.readFileSync(fp, 'utf-8');
  const derives = /export const RESOURCE_EXTS/.test(text) && text.includes('Object.fromEntries');
  const viaDirectImport = /import resourceTypesJson\b[\s\S]*resource_types\.json/.test(text);
  const viaSchema = /import\s+\{[^}]*allResourceTypes[^}]*\}\s+from\s+["']\.\/schema\.ts["']/.test(text);
  if (!derives || (!viaDirectImport && !viaSchema)) {
    throw new Error('extensions.ts 未从 resource_types.json 派生 RESOURCE_EXTS（ADR-014/T2 单一事实来源被破坏，勿手写副本）');
  }
}

const jsonMode = process.argv.slice(2).includes('--json');

function emit(issues: number) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ _summary: { issues }, issues: issues ? [{ type: 'fatal', id: '', detail: '派生守卫失败' }] : [] }, null, 2) + '\n');
  } else if (issues) {
    process.stdout.write('派生守卫失败\n');
  } else {
    process.stdout.write('extensions.ts 派生链路完好（单一事实来源守护通过）\n');
  }
}

try {
  assertExtensionsDerived();
  emit(0);
} catch (e: any) {
  // 派生破坏：输出哨兵 JSON，pre-push-gate 的 `?? 0` 读到 9999 → blocked（fail-closed）。
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ _summary: { issues: 9999 }, issues: [{ type: 'fatal', id: '', detail: `派生守卫失败: ${e?.message || e}` }] }, null, 2) + '\n');
  } else {
    process.stderr.write(`FATAL: ${e?.message || e}\n`);
  }
  process.exit(1);
}
