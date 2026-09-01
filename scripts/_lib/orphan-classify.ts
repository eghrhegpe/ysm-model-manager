#!/usr/bin/env node
/**
 * orphan-classify.ts — 脚本「是否还有人会执行它」的判定共享层。
 *
 * 设计意图：scripts/ 下的脚本会随迭代不断堆积，但没有任何机制回答一个基本问题——
 * 「这个脚本还有人跑吗？」2026-08-31 全量审计实测：约四分之一的脚本（数千行）
 * 既未挂在任何流水线上、也无脚本调用、文档里连名字都没出现过，却一直躺在仓库里，
 * 无人知晓它们是化石还是工具。本模块把该判定固化成可机检、可单测的口径。
 *
 * 四态判定（优先级从高到低，命中即返回）：
 *   - mounted    被流水线挂载（git 钩子 / pre-push-gate / Taskfile / GitHub Actions /
 *                frontend package.json）→ 每次提交或推送自动执行；
 *   - called     被 scripts/ 下其它脚本以文本形式引用（spawn 调用或 import）→ 间接生效；
 *   - documented 未被自动执行，但 scripts/README.md 或 AGENTS.md 记录了用法 → 手册工具，
 *                靠人手敲，合理存在，不视为化石；
 *   - orphan     三者皆无 → 化石，建议归档或删除。
 *
 * 依赖：node:fs / node:path / _lib/scan-files.ts / _lib/collect-scripts.ts（零外部依赖）
 *
 * 用法：
 *   import { findOrphans, classifyScript } from './_lib/orphan-classify.ts';
 *   findOrphans();                      // → [{ script, status, reason }]
 *   classifyScript('x.mjs', ctx);       // 单脚本判定（ctx 由 buildContext 构造）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './scan-files.ts';
import { SCRIPTS_DIR, collectScripts } from './collect-scripts.ts';

/** 判定上下文（buildContext 构造，测试可注入）。 */
export interface OrphanCtx {
  mountText: string;
  docText: string;
  siblings: Array<{ name: string; text: string }>;
}

/** 流水线挂载点：出现在这些位置的脚本会被自动执行。 */
export const MOUNT_FILES = [
  '.githooks/pre-commit',
  '.githooks/pre-push',
  '.githooks/post-commit',
  '.githooks/prepare-commit-msg',
  'scripts/pre-push-gate.ts',
  'Taskfile.yml',
  'frontend/package.json',
];

/** 文档记录点：出现脚本名说明有人知道它、会手敲（手册工具，不算化石）。 */
export const DOC_FILES = ['scripts/README.md', 'AGENTS.md'];

/** 读取仓库内的文本文件；不存在或不可读时返回空串（不因单点缺失炸掉整棵扫描）。 */
function readIfExists(rel: string): string {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
}

/** GitHub Actions 工作流全文（目录可能不存在）。 */
function readWorkflows(): string {
  const dir = path.join(ROOT, '.github', 'workflows');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((f) => /\.(yml|yaml)$/.test(f));
  } catch {
    return '';
  }
  return names.map((f) => readIfExists(path.join('.github', 'workflows', f))).join('\n');
}

/** 构造判定上下文：流水线全文 + 文档全文 + 同级脚本（名 → 文本）。 */
export function buildContext(): OrphanCtx {
  const files = collectScripts({ skipHooks: true });
  const siblings = files.map((f) => ({
    name: f,
    text: fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8'),
  }));
  return {
    mountText: [...MOUNT_FILES.map(readIfExists), readWorkflows()].join('\n'),
    docText: DOC_FILES.map(readIfExists).join('\n'),
    siblings,
  };
}

/**
 * 判定单个脚本的存活状态。
 * @param {string} script 相对 scripts/ 的 posix 路径（如 `api-break.ts`）
 * @param {{mountText: string, docText: string, siblings: Array<{name:string, text:string}>}} ctx
 * @returns {{status: 'mounted'|'called'|'documented'|'orphan', callers?: string[], reason?: string}}
 */
export function classifyScript(script: string, ctx: OrphanCtx): { status: 'mounted' | 'called' | 'documented' | 'orphan'; callers?: string[]; reason?: string } {
  // 两种形态都认：文档/挂载点里既有全名 `api-break.ts`，也有省略后缀的 `api-break`
  // （AGENTS.md 工具口令表即为后者）。只认全名会把手册工具误判成化石。
  // 2026-09 顶层 .mjs→.ts 迁移后统一按 .(mjs|ts) 剥后缀。
  const bare = script.replace(/\.(mjs|ts)$/, '');
  const mentioned = (text) => text.includes(script) || text.includes(bare);

  if (mentioned(ctx.mountText)) {
    return { status: 'mounted' };
  }
  const callers = ctx.siblings.filter((s) => s.name !== script && s.text.includes(script)).map((s) => s.name);
  if (callers.length) {
    return { status: 'called', callers };
  }
  if (mentioned(ctx.docText)) {
    return { status: 'documented' };
  }
  return { status: 'orphan', reason: '未被流水线挂载、无脚本调用、文档无记录' };
}

/**
 * 找出全部孤儿脚本。
 * @param {{ctx?: object}} [opts] 可注入 ctx（测试用）；缺省时自动构造
 * @returns {Array<{script: string, status: 'orphan', reason: string}>}
 */
export function findOrphans(opts: { ctx?: OrphanCtx } = {}) {
  const ctx = opts.ctx ?? buildContext();
  const out: Array<{ script: string; status: string; reason?: string }> = [];
  for (const s of ctx.siblings) {
    const r = classifyScript(s.name, ctx);
    if (r.status === 'orphan') out.push({ script: s.name, ...r });
  }
  return out;
}
