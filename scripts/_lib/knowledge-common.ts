/**
 * knowledge-common.ts — 知识卡/文档漂移检查共用层（check-knowledge-drift / check-doc-drift）。
 *
 * 背景：check-knowledge-drift.ts 与 check-doc-drift.ts 各内联了一份 getUntrackedCards、
 * BOM 剥离与必填字段校验，且靠「与对方对齐」的注释约定维持同步（P1-1 修复就是靠注释
 * 双向对齐的典型案例）。2026-09 孤儿审计判为「同模板复制的铁证」，收敛为单点实现——
 * 消除注释约定漂移，也让两类检查器共享同一份判定。
 *
 * 依赖：node:path / _lib/proc.ts（run）/ _lib/frontmatter.ts（getScalar）。
 * 零外部依赖。
 */
import path from 'node:path';
import { run } from './proc.ts';
import { getScalar } from './frontmatter.ts';

/** 知识卡必填字段（kind/name/category/tier）——两类漂移检查器共用同一枚举与判定。 */
export const REQUIRED_CARD_FIELDS = ['kind', 'name', 'category', 'tier'] as const;

/**
 * 去除文件开头的 UTF-8 BOM。
 * frontmatter 锚定 `^---` 前须先剥 BOM，否则带 BOM 的知识卡整卡被静默跳过（假绿）。
 */
export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '');
}

/**
 * 是否以 frontmatter 分隔符 `---` 开头（容 BOM 前缀）。
 * 与 hooks/knowledge-affected-hint.mjs 的 `^\uFEFF?---` 容错同一口径。
 */
export function hasFrontmatterDelimiter(text: string): boolean {
  return /^\uFEFF?---\r?\n/.test(text);
}

/** doc/knowledge 下未跟踪草稿集合（git ls-files --others）。草稿不参与漂移打分——
 *  fail-open：git 不可用时返回空集不阻断。 */
export function getUntrackedCards(cwd: string, gitPath = 'docs/knowledge'): Set<string> {
  const r = run('git', ['ls-files', '--others', '--exclude-standard', '--', gitPath], { cwd });
  if (!r.ok) return new Set();
  return new Set(r.out.split('\n').filter(Boolean).map((p) => path.basename(p)));
}

/** 返回知识卡缺失的必填字段清单（value 为 undefined 或空串即视为缺失）。fm 为 parseFrontmatter 产出的 frontmatter 块字符串。 */
export function missingRequiredCardFields(fm: string | null): string[] {
  return REQUIRED_CARD_FIELDS.filter((k) => {
    const v = getScalar(fm, k);
    return v === undefined || v === '';
  });
}