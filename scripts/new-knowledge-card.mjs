#!/usr/bin/env node
/**
 * new-knowledge-card.mjs — 生成知识卡模板。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 用法：
 *   node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]
 *
 * 示例：
 *   node scripts/new-knowledge-card.mjs event_bus "事件总线 bus.ts" core frontend/src/bus.ts
 *   node scripts/new-knowledge-card.mjs display_util "文件名渲染 display.ts" utils frontend/src/utils/display.ts --leaf
 * 设计意图：知识卡新建工具
 * 退出码：0（成功）/ 1（失败）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const KC_DIR = path.join(ROOT, 'docs', 'knowledge');

const KNOWN_CATEGORIES = ['core', 'go', 'ui', 'feature', 'utils', 'config'];

const TEMPLATE = `---
kind: {kind}
name: {name}
tier: {tier}
category: {category}
source_files:
  - {source}
use_when:
  - TODO
---

# {name}

## 概览

TODO

## 核心职责

TODO

## 对外 API / 入口

TODO

## 与其他子系统关系

TODO

## 不变量

TODO

## 相关

- TODO
`;

function toSnakeCase(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function main() {
  const args = process.argv.slice(2);

  // --help / -h：输出用法退出，绝不创建卡片（防 --help 被当 kind）
  if (args.includes('--help') || args.includes('-h')) {
    console.error('用法: node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]');
    return 0;
  }
  // 未知 flag：拒绝而非当 kind（防 --foo 类误用，与 new-adr.mjs 同款防护）
  const unknownFlags = args.filter((a) => a.startsWith('--') && a !== '--leaf');
  if (unknownFlags.length) {
    console.error(`[FAIL] 未知参数: ${unknownFlags.join(', ')}（--help 查看用法）`);
    console.error('用法: node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]');
    return 1;
  }

  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length < 4) {
    console.error('用法: node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]');
    process.exit(1);
  }

  const [kindRaw, name, categoryRaw, source] = positional;
  const isLeaf = args.includes('--leaf');
  const kind = toSnakeCase(kindRaw);
  const category = KNOWN_CATEGORIES.includes(categoryRaw) ? categoryRaw : null;
  if (!category) {
    console.error(`category 无效: ${categoryRaw}，应为 ${KNOWN_CATEGORIES.join(' | ')}`);
    process.exit(1);
  }

  const fileName = `${kind}.md`;
  const fullPath = path.join(KC_DIR, fileName);

  if (fs.existsSync(fullPath)) {
    console.error(`[ERROR] ${fullPath} 已存在`);
    process.exit(1);
  }

  fs.mkdirSync(KC_DIR, { recursive: true });

  const content = TEMPLATE
    .replace(/{kind}/g, kind)
    .replace(/{name}/g, name)
    .replace(/{tier}/g, isLeaf ? 'leaf' : 'architecture')
    .replace(/{category}/g, category)
    .replace(/{source}/g, source);

  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`[OK] 已创建 ${fullPath}`);
}

process.exit(main());
