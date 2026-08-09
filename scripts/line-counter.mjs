#!/usr/bin/env node
/**
 * 代码行数统计与文件健康度分析。
 * 由 scripts/line-counter.py 迁移（2026-08-03），逻辑逐点保真（含原 package_lines 按文件计数行为）。
 * line-counter.mjs — line-counter 工具脚本
 * 设计意图：line-counter 工具脚本
 * 依赖：node:fs / node:path / 本地模块
 * 用法：
 *   node scripts/line-counter.mjs                 # 默认行为
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot, relPosix } from './_lib/scan-files.mjs';

const ROOT = getRoot();

function walkFiles(dir, patterns, skip = () => false) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, list, skip));
    } else if (entry.isFile()) {
      if (skip(full)) continue;
      const rel = relPosix(full);
      // F3（code_review）：glob 展开修正——`.replace(/\*/g, '.*')` 未转义 `.`（会匹配 foo.xgo），
      // 且与 `rel.endsWith` 完全冗余；仅保留后缀匹配即可
      if (list.some((p) => rel.endsWith(p.replace('*', '')))) {
        out.push(full);
      }
    }
  }
  return out;
}

function pyLineCount(text) {
  // Python 等价行计数：换行数 + (非空且不以换行结尾 ? 1 : 0)
  const nl = (text.match(/\n/g) || []).length;
  return nl + (text.length > 0 && !text.endsWith('\n') ? 1 : 0);
}

function countLines(paths) {
  /** 统计匹配的文件总行数。 */
  let total = 0;
  for (const p of paths) {
    for (const f of p) {
      // F4（code_review）：statSync/readFileSync 加 try/catch——单文件权限/瞬时失败
      // 不应让整脚本崩溃（此前裸抛，一个坏文件毁掉全量统计）
      try {
        const st = fs.statSync(f);
        if (st.size > 0) {
          total += pyLineCount(fs.readFileSync(f, 'utf-8'));
        }
      } catch (e) {
        console.warn(`[line-counter] 跳过 ${relPosix(f)}: ${e.message}`);
      }
    }
  }
  return total;
}

function oversizedFiles(paths, threshold = 700) {
  /** 找出超过 threshold 行的文件。 */
  const result = [];
  for (const p of paths) {
    for (const f of p) {
      const name = path.basename(f);
      const parts = f.split(path.sep);
      if (name.endsWith('.min.js') || parts.includes('node_modules')) continue;
      try {
        const lines = pyLineCount(fs.readFileSync(f, 'utf-8'));
        if (lines > threshold) result.push([lines, f, lines > 1000]);
      } catch { /* ignore */ }
    }
  }
  return result.sort((a, b) => b[0] - a[0]);
}

function packageLines(base, pattern) {
  /** 统计每个子目录的文件数（保持原 py 行为：count files）。 */
  const stats = [];
  if (!fs.existsSync(base)) return stats;
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (d.isDirectory()) {
      const full = path.join(base, d.name);
      const files = walkFiles(full, pattern);
      const lines = files.filter((f) => fs.statSync(f).size > 0).length;
      if (lines > 0) stats.push([d.name, lines]);
    }
  }
  return stats;
}

function main() {
  const goDirs = [path.join(ROOT, 'go'), path.join(ROOT, 'internal'), path.join(ROOT, 'cmd')];
  const jsDir = path.join(ROOT, 'frontend', 'src');
  const cssDir = path.join(ROOT, 'frontend', 'css');

  // === 项目总览 ===
  console.log('=== 项目代码统计 ===');
  let goLines = countLines(goDirs.map((d) => walkFiles(d, '*.go')));
  // 根目录 Go（F1/F7：动态扫描，不再硬编码 app.go/main.go/resource_bindings.go——
  // 列表已迁走 app.go/resource_bindings.go，且漏掉 embed.go/cli_export.go）
  for (const f of walkFiles(ROOT, '*.go', (p) => path.dirname(p) !== ROOT)) {
    goLines += pyLineCount(fs.readFileSync(f, 'utf-8'));
  }
  console.log(`Go:         ${goLines} 行`);

  const jsLines = countLines([walkFiles(jsDir, ['*.js', '*.ts'])]);
  console.log(`Frontend JS/TS: ${jsLines} 行`);

  const cssLines = countLines([walkFiles(cssDir, '*.css')]);
  console.log(`Frontend CSS: ${cssLines} 行`);

  const htmlLines = countLines([walkFiles(path.join(ROOT, 'frontend'), '*.html')]);
  console.log(`Frontend HTML: ${htmlLines} 行`);

  console.log('---');
  console.log(`总计:       ${goLines + jsLines + cssLines + htmlLines} 行`);

  // === Go 包分布 ===
  console.log('\n=== Go 包行数 ===');
  for (const [name, lines] of packageLines(path.join(ROOT, 'go'), '*.go')) {
    console.log(`  ${name}: ${lines} 行`);
  }

  // === 前端组件分布 ===
  console.log('\n=== 前端组件行数 ===');
  for (const [name, lines] of packageLines(path.join(ROOT, 'frontend', 'src', 'views'), ['*.js', '*.ts'])) {
    console.log(`  ${name}: ${lines} 行`);
  }

  // === 功能模块分布 ===
  console.log('\n=== 功能模块行数 ===');
  for (const [name, lines] of packageLines(path.join(ROOT, 'frontend', 'src', 'features'), ['*.js', '*.ts'])) {
    console.log(`  ${name}: ${lines} 行`);
  }

  // === 大文件预警 ===
  console.log('\n=== 大文件预警 (>700行) ===');
  const oversized = oversizedFiles(goDirs.map((d) => walkFiles(d, '*.go'))).concat(oversizedFiles([walkFiles(jsDir, ['*.js', '*.ts'])]));
  for (const [lines, fpath, isRed] of oversized) {
    const tag = isRed ? 'RED' : 'YELLOW';
    const rel = path.relative(ROOT, fpath);
    console.log(`  [${tag}] ${rel}: ${lines} 行`);
  }
}

main();
