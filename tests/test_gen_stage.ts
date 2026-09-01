#!/usr/bin/env node
/**
 * 契约测试：gen-stage.ts 生成物 stage 清单判定（并发卷带修复，ADR-151 续）。
 *
 * 背景（2026-09-01 实证）：pre-commit 的 snap_docs 快照 diff 用「mtime/size 变化」
 * 判定 gen 产物——单会话成立，并发失效：并行会话手改的知识卡恰在快照窗口内被 touch，
 * 被误判为 gen 产物 stage 进 index，进而被 `--only` 路径限定提交卷带（实证：
 * fbx-cli-pipeline.md / frontend_test_audit.md 被卷进 e96b47e3）。
 *
 * 修复：stage 判定收窄为「快照变化 ∩ gen 前未 dirty」——gen 前已有真实改动的文件
 * （并行会话手改）永不 stage；补全型 gen 的产物（gen 前干净）正常入库。
 *
 * 覆盖：
 *   1. gen 前干净的卡被 gen 改动 → 进 stage 清单（补全型 gen 产物正常入库）
 *   2. gen 前已 dirty 的卡（并行会话手改）→ 永不进 stage 清单（卷带根除）
 *   3. gen 前 dirty + gen 又改 → 仍不进（并行文件优先保护）
 *   4. 新增文件（?? 未跟踪）→ 不在 dirty 清单时进（gen 新建产物）
 *   5. 路径归一化（正斜杠 / 前缀匹配）
 *
 * 用法：node tests/test_gen_stage.ts
 * 退出码：0 通过 / 1 失败
 */
import assert from 'node:assert';

import {
  parsePorcelain,
  computeStageList,
  type PorcelainEntry,
} from '../scripts/_lib/gen-stage.ts';

const fails: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log('✓', name);
  } catch (e) {
    fails.push(`${name}: ${(e as Error).message}`);
    console.error('✗', name, '-', (e as Error).message);
  }
}

// ── 1. parsePorcelain：git status --porcelain 解析 ──
check('parsePorcelain 解析 X/Y 状态与路径', () => {
  const out = [
    ' M docs/knowledge/parallel.md',      // 未暂存修改（并行会话手改）
    'MM docs/knowledge/both.md',          // 暂存+未暂存
    'M  scripts/x.ts',                    // 已暂存
    'A  docs/new.md',                     // 新增已暂存
    '?? docs/knowledge/untracked.md',     // 未跟踪
    'R  old.md -> new.md',                // 重命名
  ].join('\n');
  const entries = parsePorcelain(out);
  assert.ok(entries.some((e) => e.path === 'docs/knowledge/parallel.md'), '未暂存修改应解析');
  assert.ok(entries.some((e) => e.path === 'docs/knowledge/both.md'), 'MM 应解析');
  assert.ok(entries.some((e) => e.path === 'scripts/x.ts'), 'M 应解析');
  assert.ok(entries.some((e) => e.path === 'docs/knowledge/untracked.md'), '?? 应解析');
  assert.ok(entries.some((e) => e.path === 'docs/new.md'), 'A 应解析');
  // 重命名：取新路径
  assert.ok(entries.some((e) => e.path === 'new.md'), '重命名应取新路径');
});

// ── 2. computeStageList：核心判定 ──
// 场景 A：gen 前干净的卡被 gen 改动 → 进 stage
check('场景A: gen 前干净的卡被 gen 改 → 进 stage（补全产物正常入库）', () => {
  const dirty: PorcelainEntry[] = []; // gen 前无任何 dirty
  const snapChanged = ['docs/knowledge/index.md', 'docs/knowledge/some-card.md'];
  const stage = computeStageList({ dirtyEntries: dirty, snapChanged });
  assert.deepEqual(
    [...stage].sort(),
    ['docs/knowledge/index.md', 'docs/knowledge/some-card.md'],
    '干净文件的 gen 变化应全部进 stage',
  );
});

// 场景 B：gen 前已 dirty 的卡 → 永不进
check('场景B: gen 前已 dirty 的卡 → 永不进 stage（卷带根除）', () => {
  const dirty: PorcelainEntry[] = [
    { path: 'docs/knowledge/parallel.md', x: ' ', y: 'M' },
  ];
  const snapChanged = ['docs/knowledge/index.md', 'docs/knowledge/parallel.md'];
  const stage = computeStageList({ dirtyEntries: dirty, snapChanged });
  assert.deepEqual(
    [...stage],
    ['docs/knowledge/index.md'],
    `并行会话手改的 parallel.md 不应进 stage: ${[...stage]}`,
  );
});

// 场景 C：dirty + gen 又改 → 仍不进（并行文件优先保护）
check('场景C: gen 前 dirty 且 gen 又改 → 仍不进', () => {
  const dirty: PorcelainEntry[] = [
    { path: 'docs/knowledge/hybrid.md', x: 'M', y: 'M' },
  ];
  const snapChanged = ['docs/knowledge/hybrid.md', 'docs/knowledge/index.md'];
  const stage = computeStageList({ dirtyEntries: dirty, snapChanged });
  assert.deepEqual([...stage], ['docs/knowledge/index.md'], 'hybrid.md 不应进 stage');
});

// 场景 D：gen 新建文件（未跟踪且不在 dirty 排除）→ 进
check('场景D: gen 新建产物（快照新增）→ 进 stage', () => {
  const dirty: PorcelainEntry[] = []; // gen 前未跟踪的文件也在 snap 里，但这里模拟 dirty 为空
  const snapChanged = ['docs/knowledge/index.md']; // 快照「新增」表现为变化
  const stage = computeStageList({ dirtyEntries: dirty, snapChanged });
  assert.deepEqual([...stage], ['docs/knowledge/index.md']);
});

// 场景 E：未跟踪的新文件（??）不算 dirty（gen 新建产物的正确形态）
check('场景E: ?? 未跟踪的新 gen 产物 → 不因 dirty 被误杀', () => {
  // gen 前快照里没有该文件（不存在），gen 后出现 → snapChanged 含它；
  // 若它恰好也是 ?? 未跟踪（例如首次生成的 completions 文件），不应被排除
  const dirty: PorcelainEntry[] = [
    { path: 'completions/ysm.bash', x: '?', y: '?' },
  ];
  const snapChanged = ['completions/ysm.bash'];
  const stage = computeStageList({ dirtyEntries: dirty, snapChanged });
  assert.deepEqual(
    [...stage],
    ['completions/ysm.bash'],
    '?? 未跟踪的 gen 产物不应被当并行 dirty 排除',
  );
});

// 场景 F：路径归一化——dirty 用反斜杠/正斜杠都应命中
check('场景F: 路径分隔符归一化', () => {
  const dirty: PorcelainEntry[] = [
    { path: 'docs\\knowledge\\win.md', x: ' ', y: 'M' }, // Windows 风格输出
  ];
  const snapChanged = ['docs/knowledge/win.md'];
  const stage = computeStageList({ dirtyEntries: dirty, snapChanged });
  assert.deepEqual([...stage], [], '反斜杠 dirty 路径应命中排除');
});

// 场景 G：空快照变化 → 空 stage
check('场景G: 无快照变化 → 空 stage', () => {
  const stage = computeStageList({ dirtyEntries: [], snapChanged: [] });
  assert.deepEqual([...stage], []);
});

if (fails.length) {
  console.error(`\n${fails.length} 个用例失败:`);
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
console.log('\n全部通过 ✅');
