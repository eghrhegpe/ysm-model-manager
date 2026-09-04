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
 *   6. resolvePorcelain 来源（2026-09-04 时机修复）：第三参文件优先 / fallback 现采 /
 *      gen 前干净产物正常入 stage / gen 前 dirty 半成品排除（场景 H-K）
 *
 * 用法：node tests/test_gen_stage.ts
 * 退出码：0 通过 / 1 失败
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parsePorcelain,
  computeStageList,
  resolvePorcelain,
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
  // 守卫契约：调用方必须传 snapBeforePaths，否则 ?? 文件一律 fail-closed 排除（防卷带）。
  // 此处传空集合 = 「gen 前该文件不存在」→ 判定为 gen 新建产物 → 安全进 stage（非并行 dirty）。
  const stage = computeStageList({ dirtyEntries: dirty, snapChanged, snapBeforePaths: new Set() });
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

// ── 3. resolvePorcelain：gen 前 porcelain 来源（2026-09-04 时机修复） ──
// 缺陷背景：CLI 原在 gen 循环后现采 porcelain，gen 刚改写的产物必然 dirty →
// computeStageList 按「并行 dirty」排除 → 跟踪型生成物（event-graph.md 等）永不被
// stage（实证：event-graph.md 行号漂移版 8a03beaa 后滞留工作区）。
// 修复：pre-commit 与 snap 同刻采集 gen 前 porcelain，经第三参传入；本函数优先读文件。

// 场景 H：第三参文件存在 → 读文件内容（不现采）
check('场景H: gen 前 porcelain 文件存在 → 优先读文件', () => {
  const tmp = path.join(os.tmpdir(), `ysm_gen_porc_test_${Date.now()}.txt`);
  fs.writeFileSync(tmp, ' M docs/event-graph.md\n M docs/knowledge/parallel.md\n');
  try {
    const out = resolvePorcelain(tmp);
    assert.ok(out !== null, '应返回文件内容');
    assert.ok(out!.includes('docs/event-graph.md'), '应含 gen 前 dirty 文件');
    assert.ok(!out!.includes('git status 失败'), '不应走 fallback 现采');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

// 场景 I：第三参为空/不存在 → fallback 现采（返回非 null 文本，git 可用环境下）
check('场景I: 无 porcelain 文件 → fallback 现采', () => {
  const out = resolvePorcelain('/nonexistent/ysm_porc.txt');
  assert.ok(out !== null, 'git 可用时 fallback 应返回 porcelain 文本');
});

// 场景 J：porcelain 来源判定闭环——gen 前干净的跟踪产物不被当 dirty 排除
// （computeStageList 语义：dirty 仅来自 gen 前 porcelain；gen 后改写的产物必然
// 不在 gen 前 porcelain → 不被排除 → 进 stage）
check('场景J: gen 前干净 + gen 后改写 → 进 stage（时机修复闭环）', () => {
  const tmp = path.join(os.tmpdir(), `ysm_gen_porc_test_${Date.now()}.txt`);
  fs.writeFileSync(tmp, ''); // gen 前无任何 dirty：event-graph.md 干净
  try {
    const porcelain = resolvePorcelain(tmp)!;
    const dirty = parsePorcelain(porcelain);
    const snapChanged = ['docs/event-graph.md']; // gen 改写（snap 前干净）
    const stage = computeStageList({
      dirtyEntries: dirty,
      snapChanged,
      snapBeforePaths: new Set(['docs/event-graph.md']),
    });
    assert.deepEqual([...stage], ['docs/event-graph.md'], 'gen 产物应正常入 stage');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

// 场景 K：gen 前已 dirty（并行半成品）→ 即使 gen 改写也不进（并发隔离保留）
check('场景K: gen 前 dirty 的并行半成品 → 永不进 stage', () => {
  const tmp = path.join(os.tmpdir(), `ysm_gen_porc_test_${Date.now()}.txt`);
  fs.writeFileSync(tmp, ' M docs/knowledge/parallel.md\n'); // gen 前他人手改
  try {
    const porcelain = resolvePorcelain(tmp)!;
    const dirty = parsePorcelain(porcelain);
    const snapChanged = ['docs/knowledge/parallel.md', 'docs/knowledge/index.md'];
    const stage = computeStageList({
      dirtyEntries: dirty,
      snapChanged,
      snapBeforePaths: new Set(['docs/knowledge/parallel.md', 'docs/knowledge/index.md']),
    });
    assert.deepEqual([...stage], ['docs/knowledge/index.md'], 'parallel.md 不应进 stage');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

if (fails.length) {
  console.error(`\n${fails.length} 个用例失败:`);
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
console.log('\n全部通过 ✅');
