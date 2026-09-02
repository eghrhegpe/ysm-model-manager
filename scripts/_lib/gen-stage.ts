#!/usr/bin/env node
/**
 * gen-stage.ts — 生成物 stage 清单判定（并发卷带修复，ADR-151 续）。
 *
 * 背景（2026-09-01 实证）：pre-commit 的 snap_docs 快照 diff 用「mtime/size 变化」
 * 判定 gen 产物——单会话成立，并发失效：并行会话手改的知识卡恰在快照窗口内被 touch，
 * 被误判为 gen 产物 stage 进 index，进而被 `--only` 路径限定提交卷带（实证：
 * fbx-cli-pipeline.md / frontend_test_audit.md 被卷进 e96b47e3）。
 *
 * 修复判定：stage 清单 = 快照变化文件 − 并行 dirty 文件。
 *   - dirty = `git status --porcelain` 中 docs/locales/completions 下有改动的文件
 *     （M/MM/A/D/R 等全部排除——并行会话的暂存或未暂存工作一律不碰）
 *   - `??` 未跟踪文件：gen 前已存在（snap_before 含它）→ 并行新建，排除；
 *      gen 前不存在（snap_before 不含）→ gen 本次新建产物，保留 stage
 *   - 补全型 gen（h1/symbols/adr/tests）改写的卡 gen 前是干净的 → 正常入库
 *
 * 双入口：
 *   - TS 侧：import { parsePorcelain, computeStageList }（契约测试直接测判定）
 *   - CLI（sh 侧消费）：node scripts/_lib/gen-stage.ts <snap_before> [snap_after]
 *     自身重新遍历快照（不再依赖 find/awk 脆弱管道），输出 stage 清单逐行
 *
 * 用法：
 *   node scripts/_lib/gen-stage.ts /tmp/ysm_gen_snap_before_$$.txt
 *   # stdout: 应 stage 的文件路径（每行一个，正斜杠）
 */
import fs from 'node:fs';
import path from 'node:path';

/** git status --porcelain 单条目。 */
export interface PorcelainEntry {
  /** 归一化路径（正斜杠，相对仓库根）。 */
  path: string;
  /** 暂存区状态码（X）。 */
  x: string;
  /** 工作区状态码（Y）。 */
  y: string;
}

/** 归一化路径：反斜杠 → 正斜杠，去前导 ./。 */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * 解析 `git status --porcelain` 输出。
 * - 支持 X/Y 双状态码（` M` 未暂存 / `MM` 双 / `M ` 已暂存 / `??` 未跟踪）
 * - 重命名 `R  old -> new` 取新路径
 * - 带引号路径（`"a b"`）剥离引号（quotepath 关闭时中文/空格路径）
 */
export function parsePorcelain(out: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = [];
  for (const rawLine of out.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    // 前 2 字符 = X/Y 状态码；其余为路径（可能含空格）
    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    let rest = line.slice(3);
    // 重命名：`old -> new`
    const arrow = rest.indexOf(' -> ');
    if (arrow !== -1) rest = rest.slice(arrow + 4);
    // 引号剥离（quoted paths）
    if (rest.startsWith('"') && rest.endsWith('"')) {
      rest = rest.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    entries.push({ path: normPath(rest), x, y });
  }
  return entries;
}

/** computeStageList 输入。 */
export interface StageInput {
  /** gen 前 `git status --porcelain` 解析结果（并行 dirty 文件）。 */
  dirtyEntries: PorcelainEntry[];
  /** 快照 diff 判定的变化文件（gen 前后 mtime/size 变化）。 */
  snapChanged: string[];
  /** gen 前已存在的路径集合（snap_before 的路径列）；缺省视为空 → ?? 全部保留。 */
  snapBeforePaths?: Set<string>;
}

/**
 * 核心判定：stage 清单 = snapChanged − 并行 dirty。
 * - 跟踪文件 dirty（M/MM/A/D/R…）→ 排除（并行会话的暂存/未暂存工作）
 * - `??` 未跟踪：snap_before 含它 → 并行新建，排除；不含 → gen 新建，保留
 */
export function computeStageList(input: StageInput): string[] {
  const { dirtyEntries, snapChanged, snapBeforePaths } = input;
  const before = snapBeforePaths ?? new Set<string>();
  // snapBeforePaths 缺省保护：before 为空 Set 时，
  // L101 `if (!before.has(p))` 恒 true → 所有 ?? 都 stage（fail-open）。
  // 调用方必须传入 snapBeforePaths，否则按 fail-closed 返回空清单。
  if (!snapBeforePaths && snapChanged.some((raw) => {
    const d = dirtyMap.get(normPath(raw));
    return d && d.x === '?' && d.y === '?';
  })) {
    console.error('[gen-stage] snapBeforePaths 缺省且有 ?? 文件，fail-closed 输出空清单');
    return [];
  }
  // dirty 路径防御性归一化（parsePorcelain 已归一，但调用方可能直传反斜杠路径）
  const dirtyMap = new Map<string, PorcelainEntry>();
  for (const d of dirtyEntries) dirtyMap.set(normPath(d.path), d);
  const stage = new Set<string>();
  for (const raw of snapChanged) {
    const p = normPath(raw);
    const dirty = dirtyMap.get(p);
    if (!dirty) {
      stage.add(p);
      continue;
    }
    // `??` 未跟踪：gen 前不存在 → gen 本次新建，保留；存在 → 并行新建，排除
    if (dirty.x === '?' && dirty.y === '?') {
      if (!before.has(p)) stage.add(p);
    }
    // 其他 dirty（跟踪文件改动）→ 一律排除
  }
  return [...stage];
}

// ── CLI：sh 侧消费（pre-commit 调用）──
// node scripts/_lib/gen-stage.ts <snap_before> [snap_after]
// 自身重遍历快照 → 计算变化 → 取 porcelain → 输出 stage 清单
import { SNAP_DIRS } from './gen-config.ts';

const SNAP_BASES = SNAP_DIRS;

function snapshot(): Map<string, { mtime: number; size: number }> {
  const out = new Map<string, { mtime: number; size: number }>();
  for (const base of SNAP_BASES) {
    if (!fs.existsSync(base)) continue;
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) {
          try {
            const s = fs.statSync(p);
            out.set(normPath(p), { mtime: s.mtimeMs, size: s.size });
          } catch { /* 读不到跳过 */ }
        }
      }
    };
    walk(base);
  }
  return out;
}

function readSnap(file: string): Map<string, { mtime: number; size: number }> {
  const map = new Map<string, { mtime: number; size: number }>();
  if (!file || !fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const l = line.trim();
    if (!l) continue;
    // 快照行格式：`<mtime> <size> <path>`（node 版 mtimeMs 小数、find 版秒级）；取前两列数值 + 末列路径
    const sp = l.lastIndexOf(' ');
    if (sp === -1) continue;
    const parts = l.slice(0, sp).trim().split(/\s+/);
    if (parts.length < 2) continue;
    map.set(normPath(l.slice(sp + 1)), {
      mtime: parseFloat(parts[0]!),
      size: parseInt(parts[1]!, 10),
    });
  }
  return map;
}

// 直接运行时走 CLI（sh 侧）
const isCli = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('_lib/gen-stage.ts');
if (isCli) {
  const snapBeforeFile = process.argv[2] ?? '';
  const before = readSnap(snapBeforeFile);
  const cur = snapshot();
  // snapChanged = 新增或 mtime/size 变化的文件（gen 删文件场景不 stage，删除由 git 自身跟踪）
  const snapChanged: string[] = [];
  for (const [p, s] of cur) {
    const b = before.get(p);
    if (!b || b.mtime !== s.mtime || b.size !== s.size) snapChanged.push(p);
  }
  // dirty 清单：git status --porcelain（cwd=仓库根，pre-commit 已在 ROOT）
  let porcelain = '';
  try {
    porcelain = require('node:child_process').execFileSync(
      'git', ['-c', 'core.quotepath=false', 'status', '--porcelain'],
      { cwd: process.cwd(), encoding: 'utf8' },
    ) as string;
  } catch (e) {
    // fail-closed：git status 失败时输出空 stage 清单，
    // 让 pre-commit 回退到保守策略（不 stage 任何生成物）。
    // 旧实现 porcelain='' → dirty 空 → 全量 stage（fail-open，并发隔离失效）
    console.error(`[gen-stage] git status 失败，fail-closed 输出空清单: ${(e as Error).message}`);
    process.exit(0); // 顶层模块作用域不可 return；CLI 模式空输出 = 空 stage 清单（fail-closed 意图不变）
  }
  const dirty = parsePorcelain(porcelain);
  const stage = computeStageList({
    dirtyEntries: dirty,
    snapChanged,
    snapBeforePaths: new Set(before.keys()),
  });
  for (const p of stage) console.log(p);
}
