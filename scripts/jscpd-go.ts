#!/usr/bin/env node
/**
 * scripts/jscpd-go.ts — Go 端复制粘贴检测(jscpd v5, Rust 内核) + 独立 baseline 账本。
 * 依赖: node:child_process / node:fs / node:path / node:url(零外部包,复用 frontend/node_modules/jscpd)。
 * 用法:
 *   node scripts/jscpd-go.ts            # 门禁:比对当前重复对 vs baseline,有新增则 exit 1
 *                                       #   失败输出含搬迁漂移提示(added↔fixed basename 匹配,_lib/jscpd-pairs.ts)
 *   node scripts/jscpd-go.ts --update   # 冻结当前重复对写入 baseline(首次接入 / 治理后收紧)
 *   node scripts/jscpd-go.ts --json     # 输出 _summary 契约(JSON 模式,供 pre-push-gate 消费;含 drifted 计数)
 *   node scripts/jscpd-go.ts --verbose  # 打印 jscpd statistics + 新增对重复块行号/片段
 * 退出码: 0(通过 / 已更新) / 1(门禁失败:新增重复对) / 2(未找到 baseline)
 *        / 3(环境/运行失败:jscpd 缺失、未产出报告或扫描异常)。
 * 设计意图: Go 债务独立账本,与前端 78 条 jscpd 基线零耦合;增量门禁只拦新增重复对、不惩罚存量。
 * 红线: 只扫 go/ 目录下递归所有 .go 文件,不碰 upstream/ vendor、rust-core/target 编译产物、前端 *.ts;
 *   baseline 独立存 scripts/baseline/jscpd-go-baseline.json,绝不写回前端 deadcode-baseline.json 的 jscpd 数组。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';
import { checkStale } from './_lib/stale-baseline.ts';
import { normPair, pairsFrom, matchDrift } from './_lib/jscpd-pairs.ts';

// 仓库根由共享层 scan-files.ts 提供(消除内联 ROOT 样板,对齐 scripts_argv 卫生规范)
// monorepo 化后 jscpd 被 hoist 到根 node_modules（workspaces 依赖提升），
// 根 / frontend 两处都要找——只认 frontend 会漏根安装（npm install 到根后 frontend 不再有）。
const JSCPD = [
  path.join(ROOT, 'node_modules', 'jscpd', 'run-jscpd.js'),
  path.join(ROOT, 'frontend', 'node_modules', 'jscpd', 'run-jscpd.js'),
].find((p) => fs.existsSync(p));
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
  node scripts/jscpd-go.ts            # 门禁:比对当前重复对 vs baseline,有新增则 exit 1
  node scripts/jscpd-go.ts --update   # 将当前重复对冻结写入 baseline(首次接入 / 确认债务后收紧)
  node scripts/jscpd-go.ts --verbose  # 打印 jscpd statistics 明细

范围: ${PATTERN} (format=${FORMAT}) — 不扫 rust-core / upstream / frontend
baseline: ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

function runJscpd(tmpDir: string) {
  const r = spawnSync(
    'node',
    [
      JSCPD!,
      '--pattern', PATTERN,
      '--format', FORMAT,
      '--no-gitignore', // 全量 Go 债务,不因 .gitignore 漏扫
      '--reporters', 'json',
      '--output', tmpDir,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  // ⚠️ 失败路径不得 process.exit：会跳过 main 的 finally → tmp 目录泄漏。
  // 置 exitCode + return null，由 main 收尾清理并退出。
  if (r.error) {
    console.error('[jscpd-go] jscpd 启动失败:', r.error.message);
    process.exitCode = 3;
    return null;
  }
  const report = path.join(tmpDir, 'jscpd-report.json');
  if (!fs.existsSync(report)) {
    console.error('[jscpd-go] jscpd 未产出报告 (stderr 见下)\n' + (r.stderr || ''));
    process.exitCode = 3;
    return null;
  }
  return JSON.parse(fs.readFileSync(report, 'utf8'));
}

// pair 归一化/提取/漂移匹配收敛至 _lib/jscpd-pairs.ts（tests/test_jscpd_pairs.ts 锁行为）：
// pairsFrom（报告→归一化对）+ normPair（A#B/B#A 同对）+ matchDrift（搬迁漂移提示）。

function loadBase() {
  if (!fs.existsSync(BASELINE)) return null;
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  if (Array.isArray(base.clones)) {
    base.clones = base.clones.map(normPair);
  }
  return base;
}
function warnStale(base: any) {
  const w = checkStale(base.generated, 'jscpd-go');
  if (w) console.warn(w);
}

function main() {
  if (!fs.existsSync(JSCPD!)) {
    console.error(`[jscpd-go] 未找到 jscpd 二进制: ${path.relative(ROOT, JSCPD!)}\n请先安装前端依赖 (frontend/node_modules/jscpd)。`);
    process.exit(3);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscpd-go-'));
  try {
    const report = runJscpd(tmp);
    if (report === null) return; // runJscpd 已置 exitCode=3；finally 清理 tmp 后退出
    // fail-closed（review #6）：report 缺 duplicates 数组（jscpd 升级改 schema 等）
    // → 结构异常拒绝放行；duplicates: []（合法空扫描）必须仍为通过。
    if (!Array.isArray(report.duplicates)) {
      if (JSON_MODE) console.log(JSON.stringify({ _summary: { ok: false, error: 'report-schema', language: FORMAT } }));
      else console.error('[jscpd-go] jscpd 报告缺少 duplicates 数组（schema 漂移？），拒绝放行');
      process.exitCode = 3;
      return; // finally 清理 tmp
    }
    const current = pairsFrom(report);
    const dupCount = (report.duplicates || []).length;
    const stat = report.statistics || {};
    // fail-closed（review #4）：扫描 0 文件 = pattern 失配 / 工作树无 go/ → 重复检测
    // 未实际运行。空扫描若放行：check 空洞 PASS、--update 会清空 baseline 账本。
    const sources = stat.total?.sources ?? 0;
    if (sources === 0) {
      if (JSON_MODE) console.log(JSON.stringify({ _summary: { ok: false, error: 'empty-scan', language: FORMAT } }));
      else console.error('[jscpd-go] 扫描到 0 个 .go 文件（pattern 失配或 go/ 不存在），重复检测未实际运行，拒绝放行');
      process.exitCode = 3;
      return; // finally 清理 tmp
    }
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
      process.exitCode = 0;
      return; // finally 清理 tmp
    }

    // check
    const base = loadBase();
    if (!base) {
      if (JSON_MODE) console.log(JSON.stringify({ _summary: { ok: false, error: 'no-baseline', language: FORMAT } }));
      else console.error(`[jscpd-go] 未找到 baseline (${path.relative(ROOT, BASELINE)})。\n首次接入请运行: node scripts/jscpd-go.ts --update`);
      process.exitCode = 2;
      return; // finally 清理 tmp
    }
    warnStale(base);
    const baseSet = new Set(base.clones || []);
    const added = current.filter((p) => !baseSet.has(p));
    const fixed = (base.clones || []).filter((p: string) => !current.includes(p));
    // 搬迁漂移识别（2026-09-01 ADR-144 复盘）：文件搬迁/拆分会让重复对 key 变路径，
    // 增量门禁误报「新增」——added ↔ fixed 按 basename 集匹配漂移，给人肉确认提供实据。
    // 漂移是「提示」不是「豁免」：仍计入 added，放行与否由人看过后 --update 决定。
    const drifts = matchDrift(added, fixed);
    const driftMap = new Map(drifts.map((d) => [d.added, d]));
    const summary = {
      ok: added.length === 0,
      added: added.length,
      fixed: fixed.length,
      drifted: drifts.length,
      baseline: base.clones.length,
      current: current.length,
      issues: added.length,
      language: FORMAT,
    };
    if (added.length === 0) {
      if (JSON_MODE) console.log(JSON.stringify({ _summary: summary }));
      else console.log(`[jscpd-go] ✅ 通过:无新增重复对 (baseline ${base.clones.length} 对, 已修复 ${fixed.length} 对可 --update 收紧)`);
      process.exitCode = 0;
      return; // finally 清理 tmp
    }
    if (JSON_MODE) {
      console.log(JSON.stringify({ _summary: summary }));
    } else {
      console.error(`[jscpd-go] ❌ 门禁失败:新增 ${added.length} 个重复对 (其中 ${drifts.length} 个疑似搬迁漂移)`);
      for (const p of added.slice(0, 40)) {
        console.error('   + ' + p);
        const d = driftMap.get(p);
        if (d) {
          const kind = d.type === 'exact'
            ? '搬迁(basename 集相同)'
            : `拆/并文件(共享 ${d.shared.join(', ')})`;
          console.error(`     ⚠️ 疑似路径漂移(非新债): 旧对 ${d.fixed} [${kind}]`);
        }
      }
      if (added.length > 40) console.error(`   ... 其余 ${added.length - 40} 对省略`);
      // 消失旧对中未被漂移提示引用的（真新债或非典型漂移，需人肉研判）
      const cited = new Set(drifts.map((d) => d.fixed));
      const orphan = fixed.filter((p: string) => !cited.has(p));
      if (orphan.length > 0) {
        console.error(`[jscpd-go] 消失旧对 ${orphan.length} 个（未被上方漂移解释，若非治理成果请研判）:`);
        for (const p of orphan.slice(0, 40)) console.error('   - ' + p);
      }
      if (verbose) {
        // 重复块行号 + 片段头（jscpd 报告含 firstFile/secondFile start/end + fragment）
        const dupIndex = new Map<string, any[]>();
        for (const d of report.duplicates || []) {
          const a = (d.firstFile?.name || '').split('\\').join('/');
          const b = (d.secondFile?.name || '').split('\\').join('/');
          if (!a || !b) continue;
          const key = [a, b].sort().join('#');
          if (!dupIndex.has(key)) dupIndex.set(key, []);
          dupIndex.get(key)!.push(d);
        }
        console.error('[jscpd-go] 新增对重复块明细（--verbose）:');
        for (const p of added.slice(0, 10)) {
          for (const d of (dupIndex.get(p) || []).slice(0, 2)) {
            const head = String(d.fragment || '').split('\n').slice(0, 3).join(' | ').slice(0, 200);
            console.error(`     ${p}: L${d.firstFile.start}-L${d.firstFile.end} ↔ L${d.secondFile.start}-L${d.secondFile.end} :: ${head}`);
          }
        }
      }
      console.error('[jscpd-go] 漂移确认无误(或治理后)运行: node scripts/jscpd-go.ts --update');
    }
    process.exitCode = 1;
    return; // finally 清理 tmp
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
