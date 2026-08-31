#!/usr/bin/env node
/**
 * gpu-leak-analyze.mjs — 解析 [gpu-leak] 日志，生成 GPU 内存泄漏报告。
 *
 * 设计意图：frontend 在 cleanupPreview / mmd dispose 前后会打
 * `[gpu-leak] before/after: geometries=N textures=N` 日志。本工具
 * 读取这些日志，逐对计算差值，标出泄漏点。
 *
 * 日志格式（与 cleanup-3d.ts / mmd-adapter.ts 一致）：
 *   [gpu-leak] before cleanup: geometries=12 textures=8
 *   [gpu-leak] after cleanup:  geometries=2  textures=6   ← 泄漏！
 *
 * 输入源（按优先级）：
 *   1. 命令行参数 `node scripts/gpu-leak-analyze.mjs <logfile>`
 *   2. stdin `cat console.log | node scripts/gpu-leak-analyze.mjs`
 *
 * 输出：
 *   默认文本报告：泄漏对摘要 + 统计
 *   --json：结构化 JSON（供子代理/CI 消费）
 *
 * 用法：
 *   node scripts/gpu-leak-analyze.mjs <logfile>              # 文本报告
 *   node scripts/gpu-leak-analyze.mjs <logfile> --json       # JSON
 *   cat console.log | node scripts/gpu-leak-analyze.mjs      # stdin 模式
 *
 * 退出码：发现泄漏 → 1；无泄漏或无数据 → 0（WARN 不阻断）。
 *
 * 依赖：node:fs / node:readline（零外部依赖）
 *
 * 设计意图：把 3D 清理路径的 GPU 内存泄漏从"日志里人眼找"变成"机器对账"——
 * 逐对计算 cleanup 前后差值，标出泄漏几何/纹理，供子代理/CI 消费。
 */

import fs from 'node:fs';
import readline from 'node:readline';

const ARGS = process.argv.slice(2);
let jsonOut = false;
const files = [];

for (const a of ARGS) {
  if (a === '--json') { jsonOut = true; }
  else if (a === '--help' || a === '-h') {
    console.log(`用法：node scripts/gpu-leak-analyze.mjs <logfile> [选项]
  --json          输出 JSON（供子代理/CI 消费）
  -h, --帮助
  默认从文件读取；无文件时从 stdin 读取`);
    process.exit(0);
  }
  else if (!a.startsWith('-')) { files.push(a); }
}

// ── 日志行解析 ──
const LINE_RE = /\[gpu-leak\]\s+(.+?)\s+(before|after)\s*:\s*geometries=(\d+)\s+textures=(\d+)/;

/**
 * @typedef {Object} LeakPair
 * @property {string} label  清理点名称（cleanup / mmd dispose）
 * @property {{geometries:number,textures:number}} before
 * @property {{geometries:number,textures:number}} after
 * @property {{geometries:number,textures:number}} delta   after - before
 * @property {boolean} leaked   delta.geometries>0 || delta.textures>0
 */

function parseLines(lines) {
  const entries = [];
  for (const raw of lines) {
    const m = raw.match(LINE_RE);
    if (!m) continue;
    const [, label, when, geo, tex] = m;
    entries.push({
      when,
      label: label.replace(/-/g, ' '),
      geometries: parseInt(geo, 10),
      textures: parseInt(tex, 10),
    });
  }
  return entries;
}

function buildPairs(entries) {
  const pairs = [];
  // 按 label 分组
  const byLabel = new Map();
  for (const e of entries) {
    if (!byLabel.has(e.label)) byLabel.set(e.label, {});
    byLabel.get(e.label)[e.when] = { geometries: e.geometries, textures: e.textures };
  }
  for (const [label, times] of byLabel) {
    if (times.before && times.after) {
      pairs.push({
        label,
        before: times.before,
        after: times.after,
        delta: {
          geometries: times.after.geometries - times.before.geometries,
          textures: times.after.textures - times.before.textures,
        },
        leaked: (times.after.geometries - times.before.geometries) >= 0
          || (times.after.textures - times.before.textures) >= 0,
      });
    } else if (times.before) {
      pairs.push({ label, before: times.before, after: null, delta: null, leaked: null });
    } else if (times.after) {
      pairs.push({ label, before: null, after: times.after, delta: null, leaked: null });
    }
  }
  return pairs;
}

function formatReport(pairs) {
  const lines = [];
  const leaked = pairs.filter(p => p.leaked === true);
  const incomplete = pairs.filter(p => p.leaked === null);
  const clean = pairs.filter(p => p.leaked === false);

  lines.push('');
  lines.push('='.repeat(60));
  lines.push('  GPU 内存泄漏报告');
  lines.push('='.repeat(60));

  if (leaked.length > 0) {
    lines.push('');
    lines.push(`🔴 泄漏点 (${leaked.length})`);
    lines.push('-'.repeat(40));
    for (const p of leaked) {
      lines.push(`  ${p.label}:`);
      lines.push(`    geometries: ${p.before.geometries} → ${p.after.geometries}  (+${p.delta.geometries})`);
      lines.push(`    textures:   ${p.before.textures} → ${p.after.textures}  (+${p.delta.textures})`);
    }
  }

  if (clean.length > 0) {
    lines.push('');
    lines.push(`✅ 干净释放 (${clean.length})`);
    lines.push('-'.repeat(40));
    for (const p of clean) {
      lines.push(`  ${p.label}: geometries=${p.after.geometries} textures=${p.after.textures}`);
    }
  }

  if (incomplete.length > 0) {
    lines.push('');
    lines.push(`⚠️  数据不完整 (${incomplete.length}) — 只有 before 或 after`);
    lines.push('-'.repeat(40));
    for (const p of incomplete) {
      lines.push(`  ${p.label}: before=${p.before ? '有' : '无'} after=${p.after ? '有' : '无'}`);
    }
  }

  lines.push('');
  if (leaked.length > 0) {
    const totalGeo = leaked.reduce((s, p) => s + p.delta.geometries, 0);
    const totalTex = leaked.reduce((s, p) => s + p.delta.textures, 0);
    lines.push(`📊 累计泄漏: geometries +${totalGeo}, textures +${totalTex}`);
  } else if (pairs.length > 0) {
    lines.push('🎉 无泄漏');
  } else {
    lines.push('📭 无 [gpu-leak] 日志数据');
  }

  return lines.join('\n');
}

async function readInput(files) {
  const allLines = [];
  if (files.length > 0) {
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      allLines.push(...content.split('\n'));
    }
  } else {
    // stdin
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      allLines.push(line);
    }
  }
  return allLines;
}

// ── 主流程 ──
const lines = await readInput(files);
const entries = parseLines(lines);
const pairs = buildPairs(entries);

if (jsonOut) {
  console.log(JSON.stringify({
    total: pairs.length,
    leaked: pairs.filter(p => p.leaked === true).length,
    clean: pairs.filter(p => p.leaked === false).length,
    incomplete: pairs.filter(p => p.leaked === null).length,
    pairs,
  }, null, 2));
} else {
  console.log(formatReport(pairs));
}

process.exit(pairs.some(p => p.leaked === true) ? 1 : 0);
