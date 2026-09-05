#!/usr/bin/env node
/**
 * 契约测试：check-knowledge-drift.ts source_files 404 时的「历史重命名迁移」建议。
 *
 * 背景（2026-09）：目录层级迁移（go/internal/ → internal/）后知识卡 source_files 仍指旧
 * 路径 → checkKnowledgeSources 报「引用不存在」。裸 ERROR 只告诉 AI「文件没了」，不告诉
 * 「去哪了」。增强：404 时懒加载跑一次 `git log --all --diff-filter=R --name-status` 全历史
 * rename 记录，把「疑似历史重命名迁移至 X」附进 ERROR 文案（不降级 ERROR，只补可操作信息）。
 *
 * 验证三件事：
 *   1. 真实被 rename 过的路径 → ERROR 且含「疑似历史重命名迁移至 <新路径>」
 *   2. 从未存在的路径 → ERROR 仍含「引用不存在」但**不含**迁移建议（无 rename 记录不误报）
 *   3. 真实存在、未 rename 的文件 → 无针对该卡的 ERROR（增强不误伤正常卡）
 *
 * 隔离策略：卡片目录经 --kc-dir 指向系统临时目录（同 anchor-def-kind / body-line-refs 范式）。
 * 依赖真实 git 仓库（rename 案例取自仓库历史：internal/testutil → go/internal/testutil，
 * ADR-191 迁回事件，契约锁定该已知案例）。
 *
 * 用法：node tests/check-knowledge-rename-migration.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ok, finish, runScript } from './_lib.mts';

const ROOT = process.cwd();
const KC_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ysm-rename-migration-contract-'));
const TMP_CARD = path.join(KC_TMP_DIR, 'zzz-rename-migration-tmp.md');
const CARD_STEM = 'zzz-rename-migration-tmp';

const RENAME_HINT = '疑似历史重命名迁移至';
// 仓库真实 rename 案例：internal/testutil/testutil.go → go/internal/testutil/testutil.go
// （ADR-191 testutil 迁回 go/internal；当前 go/internal/... 存在、internal/... 已 404）
const OLD_PATH = 'internal/testutil/testutil.go';
const NEW_PATH = 'go/internal/testutil/testutil.go';

function writeCard(src: string) {
  const fm = [
    '---',
    `kind: ${CARD_STEM}`,
    'name: 历史重命名迁移建议契约测试临时卡',
    'tier: leaf',
    'category: utils',
    'source_files:',
    `  - ${src}`,
    'use_when:',
    '  - 临时测试',
    '---',
    '',
    '# 历史重命名迁移建议契约测试临时卡',
    '',
    '契约测试用临时卡，测完即删。',
    '',
  ].join('\r\n');
  fs.writeFileSync(TMP_CARD, fm, 'utf8');
}

function runDrift() {
  const r = runScript('check-knowledge-drift.ts', '--json', '--kc-dir', KC_TMP_DIR);
  let out = { errors: [], warns: [] };
  try {
    out = r.stdout ? JSON.parse(r.stdout) : out;
  } catch {
    /* 解析失败保持空 */
  }
  return { status: r.status, out };
}

function cardErrors(out: { errors: string[] }) {
  return out.errors.filter((e) => e.includes(CARD_STEM));
}

console.log('=== source_files 404 历史重命名迁移建议契约 ===');

try {
  // 1. 真实被 rename 过的路径 → ERROR 附迁移建议
  writeCard(OLD_PATH);
  let { status, out } = runDrift();
  const e1 = cardErrors(out);
  ok('rename 路径 → ERROR 且含迁移建议', e1.some((e) => e.includes(RENAME_HINT)), `期望含迁移建议: ${e1.join('; ').slice(0, 300)}`);
  ok(
    '迁移建议给出新路径',
    e1.some((e) => e.includes(NEW_PATH)),
    `期望含新路径 ${NEW_PATH}: ${e1.join('; ').slice(0, 300)}`
  );
  ok('ERROR 不降级（仍退出码 1）', status === 1, `status=${status}`);

  // 2. 从未存在的路径 → ERROR 但不含迁移建议（无 rename 记录不误报）
  writeCard('go/definitely-not-exist-xyz.ts');
  ({ status, out } = runDrift());
  const e2 = cardErrors(out);
  ok('无 rename 记录的 404 → ERROR 仍报「引用不存在」', e2.some((e) => e.includes('引用不存在')), `期望含引用不存在: ${e2.join('; ').slice(0, 300)}`);
  ok(
    '无 rename 记录的 404 → 不含迁移建议（不误报）',
    e2.every((e) => !e.includes(RENAME_HINT)),
    `不应含迁移建议: ${e2.join('; ').slice(0, 300)}`
  );

  // 3. 真实存在、未 rename 的文件 → 无针对该卡的 ERROR（增强不误伤）
  writeCard('frontend/src/utils/array.ts');
  ({ status, out } = runDrift());
  const e3 = cardErrors(out);
  ok('存在且未 rename 的文件 → 无 ERROR', e3.length === 0, `不应有针对临时卡的 ERROR: ${e3.join('; ').slice(0, 300)}`);
} finally {
  if (fs.existsSync(KC_TMP_DIR)) fs.rmSync(KC_TMP_DIR, { recursive: true, force: true });
}

finish('历史重命名迁移建议契约全过');
