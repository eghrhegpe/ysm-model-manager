import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyScript, findOrphans } from './orphan-classify.ts';

/** 构造判定上下文（不落盘，纯内存）。 */
function ctx({ mount = '', doc = '', siblings = {} } = {}) {
  return {
    mountText: mount,
    docText: doc,
    siblings: Object.entries(siblings).map(([name, text]) => ({ name, text })),
  };
}

// ── 四态判定 ──

test('被流水线挂载 → mounted', () => {
  const c = ctx({ mount: 'node scripts/api-break.ts --check', siblings: { 'api-break.ts': '' } });
  assert.deepEqual(classifyScript('api-break.ts', c), { status: 'mounted' });
});

test('被其它脚本引用 → called，并列出调用方', () => {
  const c = ctx({
    siblings: {
      'rollback-impact.ts': '',
      'audit-split.ts': "spawnSync('node', ['scripts/rollback-impact.ts'])",
    },
  });
  assert.deepEqual(classifyScript('rollback-impact.ts', c), {
    status: 'called',
    callers: ['audit-split.ts'],
  });
});

test('仅在文档出现 → documented（手册工具，不算化石）', () => {
  const c = ctx({ doc: 'api-break：两 ref 破坏性变更检测', siblings: { 'api-break.ts': '' } });
  assert.deepEqual(classifyScript('api-break.ts', c), { status: 'documented' });
});

test('三者皆无 → orphan', () => {
  const c = ctx({ siblings: { 'ghost-probe.mjs': '' } });
  const r = classifyScript('ghost-probe.mjs', c);
  assert.equal(r.status, 'orphan');
  assert.match(r.reason, /未被流水线挂载/);
});

// ── 优先级 ──

test('同时挂载与被引用 → mounted 优先', () => {
  const c = ctx({
    mount: 'scripts/x.mjs',
    siblings: { 'x.mjs': '', 'y.mjs': 'spawn x.mjs' },
  });
  assert.equal(classifyScript('x.mjs', c).status, 'mounted');
});

test('同时被引用与文档记录 → called 优先（自动执行强于手工敲）', () => {
  const c = ctx({
    doc: 'x.mjs 用法',
    siblings: { 'x.mjs': '', 'y.mjs': 'import x.mjs' },
  });
  assert.equal(classifyScript('x.mjs', c).status, 'called');
});

// ── 边界 ──

test('自身引用自己不算调用方（否则任何脚本都算被调用）', () => {
  const c = ctx({ siblings: { 'solo.mjs': '// solo.mjs 自身说明' } });
  assert.equal(classifyScript('solo.mjs', c).status, 'orphan');
});

test('文件名前缀相近不误判（check-circular 不被 check-circular-go 牵连）', () => {
  const c = ctx({ siblings: { 'check-circular.ts': '', 'check-circular-go.ts': 'go 版本' } });
  assert.equal(classifyScript('check-circular.ts', c).status, 'orphan');
});

// ── findOrphans ──

test('findOrphans 只返回孤儿，且带 script 字段', () => {
  const c = ctx({
    mount: 'scripts/keep.mjs',
    siblings: {
      'keep.mjs': '',
      'ghost.mjs': '',
      'used.mjs': '',
      'caller.mjs': 'run used.mjs', // 它调用了别人，但自己无人调用 → 仍是孤儿
    },
  });
  const reason = '未被流水线挂载、无脚本调用、文档无记录';
  assert.deepEqual(findOrphans({ ctx: c }), [
    { script: 'ghost.mjs', status: 'orphan', reason },
    { script: 'caller.mjs', status: 'orphan', reason },
  ]);
});

test('findOrphans 无孤儿时返回空数组', () => {
  const c = ctx({ mount: 'scripts/a.mjs', siblings: { 'a.mjs': '' } });
  assert.deepEqual(findOrphans({ ctx: c }), []);
});
