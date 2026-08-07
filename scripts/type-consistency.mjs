#!/usr/bin/env node
/**
 * 双方一致性检查。对比 resource_types.json ↔ JS 常量（extensions.ts）。
 * Go 端全动态加载 resource_types.json（无静态常量表），一致性由 go/types/registry_test.go 保证。
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

/** 读取 resource_types.json，同时校验结构：顶层缺 resourceTypes / id 重复时报错（code_review P3-3/3-4）。 */
function readResourceTypes(issues) {
  const fp = path.join(ROOT, 'resource_types.json');
  const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  if (!data || !Array.isArray(data.resourceTypes)) {
    throw new Error(`resource_types.json 缺少 resourceTypes 数组（顶层字段: ${Object.keys(data || {}).join(', ') || '无'}）`);
  }
  const types = {};
  const seen = new Set();
  for (const rt of data.resourceTypes) {
    if (!rt || typeof rt.id !== 'string') continue;
    if (seen.has(rt.id)) {
      issues.push({
        type: 'dup_id_in_json', id: rt.id,
        detail: `resource_types.json 中 id "${rt.id}" 出现多次（重复定义应合并）`,
      });
    }
    seen.add(rt.id);
    types[rt.id] = rt;
  }
  return types;
}

function readJsExtensions() {
  // ADR-014 后 extensions.ts 取代 extensions.js（.test.js 保留供 vitest）
  const fp = path.join(ROOT, 'frontend/src/utils/resource/extensions.ts');
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

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

/** 统一输出（含哨兵分支）：读取/解析失败时输出可解析的 JSON，避免 pre-push-gate 解析空串。 */
function emit(issues) {
  if (jsonMode) {
    const out = { _summary: { issues: issues.length }, issues };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    if (issues.length) {
      for (const i of issues) process.stdout.write(`[${i.type}] ${i.detail}\n`);
    } else {
      process.stdout.write('全部一致\n');
    }
  }
}

let issues;
try {
  const jsonTypes = readResourceTypes([]);
  const jsTypes = readJsExtensions();

  issues = [];

  // JSON → JS: 检查 JS 是否缺失类型
  for (const [tid, rt] of Object.entries(jsonTypes)) {
    if (!(tid in jsTypes)) {
      issues.push({
        type: 'missing_in_js', id: tid,
        json_exts: rt.extensions,
        detail: `resource_types.json 有 ${tid}，但 extensions.js 没有`,
      });
    } else {
      // 两端运行时均 toLowerCase 归一化（extensions.ts L40 / extensions.go L34），比对保持一致
      const jsExts = jsTypes[tid].map((e) => e.toLowerCase());
      const jsonExts = rt.extensions.map((e) => e.toLowerCase());
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
} catch (e) {
  // 数据文件损坏/缺失时输出哨兵 JSON，pre-push-gate 的 `?? 0` 读到 9999 → blocked（code_review P3-4）
  issues = [{
    type: 'fatal', id: '',
    detail: `读取一致性数据失败: ${e?.message || e}`,
  }];
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ _summary: { issues: 9999 }, issues }, null, 2) + '\n');
  } else {
    process.stderr.write(`FATAL: ${e?.message || e}\n`);
  }
  process.exit(1);
}

emit(issues);
