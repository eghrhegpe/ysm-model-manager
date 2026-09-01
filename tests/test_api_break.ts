#!/usr/bin/env node
/**
 * 契约测试：scripts/api-break.ts — 任意两 ref 间破坏性变更检测。
 *
 * 用真实 git 历史做端到端断言（仓库是 git 仓库，ref 对固定存在）：
 *   1. 缺参数 → 退出码 2 + 用法提示
 *   2. 相同 ref（HEAD HEAD）→ 无破坏性变更、无新增导出、safe=true
 *   3. 有破坏性变更的 ref 对（0f05a164^ → 0f05a164，CLI 移除提交）：
 *      - 检出消失的导出符号（CLIMain / Issue 等整文件删除 + Test* 函数删除）
 *      - 输出合法 JSON（--json），kind 与字段齐全
 *      - stderr 无 fatal 噪声（存在探测失败不刷屏）
 *   4. 中文路径 ref 对（0eb76456^ → 0eb76456，docs 同步）→ 正常输出、无 fatal
 *   5. --redline 模式：退出码 ∈ {0,1}（超红线文件存在时 1）
 *   6. 导出符号消失时 callers 键存在（扫描不空跑）
 *
 * 零依赖（仅 node:child_process / node:path / node:url）。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'api-break.ts');
const NODE = process.execPath;

const errors = [];

function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

function run(args, timeoutMs = 120000) {
  return spawnSync(NODE, [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ── 1. 缺参数 → 退出码 2 ──────────────────────────
{
  const r = run([]);
  assert(r.status === 2, `缺参数应退出 2，实际 ${r.status}（stderr=${(r.stderr || '').slice(0, 100)}）`);
  assert((r.stderr || '').includes('用法'), '缺参数应打印用法提示');
}

// ── 2. 相同 ref → 无破坏性变更 ─────────────────────
{
  const r = run(['HEAD', 'HEAD', '--json']);
  assert(r.status === 0, `相同 ref 应退出 0，实际 ${r.status}（stderr=${(r.stderr || '').slice(0, 200)}）`);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* 下方断言兜底 */ }
  assert(j !== null, '相同 ref --json 应输出合法 JSON');
  if (j) {
    assert(j.kind === 'api-break', 'JSON 应有 kind=api-break');
    assert(j.breakingChanges === 0, '相同 ref 不应有破坏性变更');
    assert(j.newExports === 0, '相同 ref 不应有新增导出');
    assert(j.safe === true, '相同 ref safe 应为 true');
    assert(typeof j.fileSummary === 'object' && 'modified' in j.fileSummary, 'fileSummary 字段应齐全');
  }
}

// ── 3. 有破坏性变更的 ref 对（CLI 移除提交）─────────
{
  const r = run(['0f05a164^', '0f05a164', '--json']);
  assert(r.status === 0, `破坏性变更 ref 对应退出 0，实际 ${r.status}（stderr=${(r.stderr || '').slice(0, 200)}）`);
  assert(!(r.stderr || '').includes('fatal:'), `stderr 不应有 fatal 噪声：${(r.stderr || '').slice(0, 200)}`);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* 下方断言兜底 */ }
  assert(j !== null, '破坏性变更 ref 对 --json 应输出合法 JSON');
  if (j) {
    assert(j.breakingChanges > 0, `CLI 移除应检出消失导出，实际 ${j.breakingChanges}`);
    assert(typeof j.callers === 'object' && j.callers !== null, 'callers 应存在（导出消失时的调用方扫描）');
    const deletedSyms = Object.keys(j.callers);
    assert(deletedSyms.some((s) => s === 'CLIMain'), `应检出 CLIMain（实际缺失，共 ${deletedSyms.length} 个：${deletedSyms.slice(0, 10).join(',')}）`);
    assert(j.fileSummary.removed > 0, 'CLI 移除应有删除文件');
  }
}

// ── 4. 中文路径 ref 对（novel 章节提交，diff 含 03-UI器官/06-幽灵的渲染.md）──
{
  const r = run(['036d8f77^', '036d8f77']);
  assert(r.status === 0, `中文路径 ref 对应退出 0，实际 ${r.status}（stderr=${(r.stderr || '').slice(0, 200)}）`);
  assert(!(r.stderr || '').includes('fatal:'), `中文路径不应触发 fatal（quotepath 修复）：${(r.stderr || '').slice(0, 200)}`);
  assert((r.stdout || '').includes('api-break ——'), '应有报告头');
  assert((r.stdout || '').includes('②'), '应有破坏性变更小节');
}

// ── 5. --redline 模式：新增文件超红线 → 退出码 1 ───
{
  // 6d05f12c 新增了 web-fs.ts（446 行 > 400 红线）：redline 应真实触发 exit 1
  const r = run(['6d05f12c^', '6d05f12c', '--redline', '--json']);
  assert(r.status === 1, `新增超红线文件时 --redline 应退出 1，实际 ${r.status}（stderr=${(r.stderr || '').slice(0, 200)}）`);
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* 下方断言兜底 */ }
  assert(j !== null, '--redline --json 应输出合法 JSON');
  if (j) {
    assert(j.redline && j.redline.over > 0, `redline.over 应 > 0，实际 ${j.redline && j.redline.over}`);
    assert(j.redline.files.some((f) => f.path.includes('web-fs.ts')), 'redline.files 应含新增的 web-fs.ts');
  }
}

// ── 汇总 ──────────────────────────────────────────
if (errors.length) {
  console.error('❌ test_api_break.mjs 失败 ' + errors.length + ' 项：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('✅ test_api_break.mjs 全部通过（6 组断言）');