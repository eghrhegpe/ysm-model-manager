#!/usr/bin/env node
/**
 * 三方一致性检查。对比 resource_types.json ↔ Go 常量 ↔ JS 常量。
 * 由 scripts/type-consistency.py 迁移（2026-08-03），逻辑逐点保真。
 * type-consistency.mjs — 类型一致性检查
 * 设计意图：类型一致性检查
 * 依赖：node:fs / node:path / 本地模块
 * 用法：
 *   node scripts/type-consistency.mjs                 # 默认行为
 *   node scripts/type-consistency.mjs --json # JSON 输出（CI/子代理消费）
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.mjs';

const ROOT = getRoot();

function readResourceTypes() {
  const fp = path.join(ROOT, 'resource_types.json');
  const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  const types = {};
  for (const rt of data.resourceTypes) {
    types[rt.id] = rt;
  }
  return types;
}

function readJsExtensions() {
  // ADR-014 后 extensions.ts 取代 extensions.js（.test.js 保留供 vitest）
  const fp = path.join(ROOT, 'frontend/js/utils/resource/extensions.ts');
  const text = fs.readFileSync(fp, 'utf-8');
  // 提取 RESOURCE_EXTS 对象（TS 版带类型注解 `: Record<...>`，需宽容中间部分）
  const m = text.match(/export const RESOURCE_EXTS(?::[^{=]+)? = \{([^}]+)\}/s);
  if (!m) return {};
  const body = m[1];
  const types = {};
  for (const line of body.split('\n')) {
    const clean = line.trim().replace(/,$/, '');
    if (!clean || clean.startsWith('//')) continue;
    // "key": [".ext1", ".ext2"]
    const m2 = clean.match(/"?([\w-]+)"?\s*:\s*\[([^\]]+)\]/);
    if (m2) {
      const key = m2[1];
      const exts = [...m2[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      types[key] = exts;
    }
  }
  return types;
}

function readGoConstants() {
  /** 从 Go 源码提取静态 map（仅限 hardcoded fallback）。 */
  const fp = path.join(ROOT, 'go/types/extensions.go');
  return fs.readFileSync(fp, 'utf-8'); // 目前 Go 端全动态，没有静态 map
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

const jsonTypes = readResourceTypes();
const jsTypes = readJsExtensions();

const issues = [];

// JSON → JS: 检查 JS 是否缺失类型
for (const [tid, rt] of Object.entries(jsonTypes)) {
  if (!(tid in jsTypes)) {
    issues.push({
      type: 'missing_in_js', id: tid,
      json_exts: rt.extensions,
      detail: `resource_types.json 有 ${tid}，但 extensions.js 没有`,
    });
  } else {
    const jsExts = jsTypes[tid];
    const jsonExts = rt.extensions;
    if (new Set(jsExts).size !== new Set(jsonExts).size || !jsonExts.every((e) => jsExts.includes(e)) || !jsExts.every((e) => jsonExts.includes(e))) {
      issues.push({
        type: 'ext_mismatch', id: tid,
        json_exts: jsonExts, js_exts: jsExts,
        detail: `${tid}: JSON=${JSON.stringify(jsonExts)} JS=${JSON.stringify(jsExts)}`,
      });
    }
  }
}

// JS → JSON: 检查 JS 是否有多余的类型
for (const tid of Object.keys(jsTypes)) {
  if (!(tid in jsonTypes)) {
    issues.push({
      type: 'extra_in_js', id: tid,
      js_exts: jsTypes[tid],
      detail: `extensions.js 有 ${tid}，但 resource_types.json 没有`,
    });
  }
}

if (jsonMode) {
  const out = { _summary: { issues: issues.length }, issues };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
  if (issues.length) {
    for (const i of issues) {
      process.stdout.write(`[${i.type}] ${i.detail}\n`);
    }
  } else {
    process.stdout.write('全部一致\n');
  }
}
