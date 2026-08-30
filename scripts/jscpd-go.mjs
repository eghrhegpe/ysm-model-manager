#!/usr/bin/env node
/**
 * scripts/jscpd-go.mjs — Go 端复制粘贴检测(jscpd v5, Rust 内核) + 独立 baseline 账本。
 * 依赖: node:child_process / node:fs / node:path / node:url(零外部包,复用 frontend/node_modules/jscpd)。
 * 用法:
 *   node scripts/jscpd-go.mjs            # 门禁:比对当前重复对 vs baseline,有新增则 exit 1
 *   node scripts/jscpd-go.mjs --update   # 冻结当前重复对写入 baseline(首次接入 / 治理后收紧)
 *   node scripts/jscpd-go.mjs --json     # 输出 _summary 契约(JSON 模式,供 pre-push-gate 消费)
 * 退出码: 0(通过 / 已更新) / 1(门禁失败:新增重复对) / 2(未找到 baseline)。
 * 设计意图: Go 债务独立账本,与前端 78 条 jscpd 基线零耦合;增量门禁只拦新增重复对、不惩罚存量。
 * 红线: 只扫 go/ 目录下递归所有 .go 文件,不碰 upstream/ vendor、rust-core/target 编译产物、前端 *.ts;
 *   baseline 独立存 scripts/baseline/jscpd-go-baseline.json,绝不写回前端 deadcode-baseline.json 的 jscpd 数组。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

// 仓库根由共享层 scan-files.mjs 提供(消除内联 ROOT 样板,对齐 scripts_argv 卫生规范)
const JSCPD = path.join(ROOT, 'frontend', 'node_modules', 'jscpd', 'run-jscpd.js');
const BASELINE = path.join(ROOT, 'scripts', 'baseline', 'jscpd-go-baseline.json');

const PATTERN = './go/**/*.go';
const FORMAT = 'go';

const argv = process.argv.slice(2);
const mode = argv.includes('--update') ? 'update' : 'check';
const verbose = argv.includes('--verbose') || argv.includes('-v');
const JSON_MODE = argv.includes('--json');
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`jscpd-go — Go 端复制粘贴检测 + 独立 baseline

用法:
  node scripts/jscpd-go.mjs            # 门禁:比对当前重复对 vs baseline,有新增则 exit 1
  node scripts/jscpd-go.mjs --update   # 将当前重复对冻结写入 baseline(首次接入 / 确认债务后收紧)
  node scripts/jscpd-go.mjs --verbose  # 打印 jscpd statistics 明细

范围: ${PATTERN} (format=${FORMAT}) — 不扫 rust-core / upstream / frontend
baseline: ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

function runJscpd(tmpDir) {
  const r = spawnSync(
    'node',
    [
      JSCPD,
      '--pattern', PATTERN,
      '--format', FORMAT,
      '--no-gitignore', // 全量 Go 债务,不因 .gitignore 漏扫
      '--reporters', 'json',
      '--output', tmpDir,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (r.error) {
    console.error('[jscpd-go] jscpd 启动失败:', r.error.message);
    process.exit(3);
  }
  const report = path.join(tmpDir, 'jscpd-report.json');
  if (!fs.existsSync(report)) {
    console.error('[jscpd-go] jscpd 未产出报告 (stderr 见下)\n' + (r.stderr || ''));
    process.exit(3);
  }
  return JSON.parse(fs.readFileSync(report, 'utf8'));
}

// v5: 顶层 duplicates[];每元素 firstFile.name / secondFile.name(Windows 用 \ 分隔)
function pairsFrom(report) {
  const set = new Set();
  for (const d of report.duplicates || []) {
    const a = d.firstFile.name.split('\\').join('/');
    const b = d.secondFile.name.split('\\').join('/');
    set.add(`${a}#${b}`);
  }
  return [...set].sort();
}

function loadBase() {
  if (!fs.existsSync(BASELINE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

function main() {
  if (!fs.existsSync(JSCPD)) {
    console.error(`[jscpd-go] 未找到 jscpd 二进制: ${path.relative(ROOT, JSCPD)}\n请先安装前端依赖 (frontend/node_modules/jscpd)。`);
    process.exit(3);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscpd-go-'));
  try {
    const report = runJscpd(tmp);
    const current = pairsFrom(report);
    const dupCount = (report.duplicates || []).length;
    const stat = report.statistics || {};
    if (verbose) console.log('[jscpd-go] statistics:', JSON.stringify(stat));
    const files = stat.total?.sources ?? '?';
    const pct = stat.total?.percentage != null ? `${(stat.total.percentage).toFixed(2)}%` : '?';
    if (!JSON_MODE) console.log(`[jscpd-go] 扫描 ${files} 文件 (重复率 ${pct}), ${dupCount} 处重复块 → ${current.length} 个唯一文件对`);

    if (mode === 'update') {
      const payload = {
        generated: new Date().toISOString(),
        scope: PATTERN,
        language: FORMAT,
        duplicates: dupCount,
        clones: current,
      };
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + '\n');
      if (JSON_MODE) {
        console.log(JSON.stringify({ _summary: { ok: true, updated: current.length, language: FORMAT, duplicates: dupCount } }));
      } else {
        console.log(`[jscpd-go] baseline 已写入 ${path.relative(ROOT, BASELINE)} (${current.length} 对)`);
      }
      process.exit(0);
    }

    // check
    const base = loadBase();
    if (!base) {
      if (JSON_MODE) console.log(JSON.stringify({ _summary: { ok: false, error: 'no-baseline', language: FORMAT } }));
      else console.error(`[jscpd-go] 未找到 baseline (${path.relative(ROOT, BASELINE)})。\n首次接入请运行: node scripts/jscpd-go.mjs --update`);
      process.exit(2);
    }
    const baseSet = new Set(base.clones || []);
    const added = current.filter((p) => !baseSet.has(p));
    const fixed = (base.clones || []).filter((p) => !current.includes(p));
    const summary = {
      ok: added.length === 0,
      added: added.length,
      fixed: fixed.length,
      baseline: base.clones.length,
      current: current.length,
      issues: added.length,
      language: FORMAT,
    };
    if (added.length === 0) {
      if (JSON_MODE) console.log(JSON.stringify({ _summary: summary }));
      else console.log(`[jscpd-go] ✅ 通过:无新增重复对 (baseline ${base.clones.length} 对, 已修复 ${fixed.length} 对可 --update 收紧)`);
      process.exit(0);
    }
    if (JSON_MODE) {
      console.log(JSON.stringify({ _summary: summary }));
    } else {
      console.error(`[jscpd-go] ❌ 门禁失败:新增 ${added.length} 个重复对`);
      for (const p of added.slice(0, 40)) console.error('   + ' + p);
      if (added.length > 40) console.error(`   ... 其余 ${added.length - 40} 对省略`);
      console.error(`[jscpd-go] 治理或确认后运行: node scripts/jscpd-go.mjs --update`);
    }
    process.exit(1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
