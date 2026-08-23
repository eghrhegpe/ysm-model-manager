#!/usr/bin/env node
/**
 * check-deadcode-baseline.mjs — 死代码 / 重复代码基线守卫。
 *
 * 调用 knip（死代码）+ jscpd（重复代码）的 JSON 输出，与基线
 * scripts/baseline/deadcode-baseline.json 对比：
 *   - 新增发现项      → ERROR（阻断，需清理或显式 --update-baseline 纳入）
 *   - 基线已知项      → OK（放行，支持渐进清理）
 *   - 基线中已消失项  → INFO（已清理，--update-baseline 后移除）
 *
 * 依赖：frontend/ 需安装 knip + jscpd（npm i -D knip jscpd）。
 *
 * 用法：
 *   node scripts/check-deadcode-baseline.mjs              # 对比基线
 *   node scripts/check-deadcode-baseline.mjs --update-baseline   # 刷新基线（直接写入，不拦新增项）
 *   node scripts/check-deadcode-baseline.mjs --json       # JSON（CI 用）
 *   node scripts/check-deadcode-baseline.mjs --update-baseline --force  # 同 --update-baseline（--force 保留兼容）
 *
 * 退出码：新增 ERROR → 1；工具缺失 → 1；否则 0。
 * 设计意图：死代码基线检查（与 baseline 文件比对）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT } from './_lib/scan-files.mjs';

const FRONTEND = path.join(ROOT, 'frontend');
const BASELINE_FILE = path.join(ROOT, 'scripts/baseline/deadcode-baseline.json');

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const UPDATE = ARGS.has('--update-baseline');

const errors = [];
const infos = [];
let knipFindings = [];
let jscpdFindings = [];

// ── 工具探测与执行 ────────────────────────────────────

function bin(name) {
  // 与 doctor.mjs frontendBin 对齐：win32 优先 .cmd（npm shim 真实形态，shell:true 走 cmd.exe），
  // 其它平台优先 plain（无扩展名可执行）。.ps1 仅作最后兜底（cmd.exe 不直接执行 .ps1）。
  const dir = path.join(FRONTEND, 'node_modules', '.bin');
  const candidates = process.platform === 'win32'
    ? [path.join(dir, `${name}.cmd`), path.join(dir, name), path.join(dir, `${name}.ps1`)]
    : [path.join(dir, name), path.join(dir, `${name}.ps1`)];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function run(name, args, opts = {}) {
  const exe = bin(name);
  if (!exe) {
    errors.push(`[工具缺失] ${name} 未安装：cd frontend && npm i -D ${name}`);
    return null;
  }
  // Windows npm shims are .cmd files and therefore need cmd.exe, but passing
  // an executable path containing spaces through spawnSync(..., {shell:true})
  // loses the quoting before cmd.exe sees it. Build one explicitly quoted
  // command string so repositories below paths such as "New project" work.
  const command = process.platform === 'win32'
    ? [exe, ...args].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(' ')
    : exe;
  const commandArgs = process.platform === 'win32' ? [] : args;
  const r = spawnSync(command, commandArgs, { cwd: FRONTEND, encoding: 'utf-8', shell: process.platform === 'win32' });
  // knip 发现死代码时 exit 1（正常报告行为），允许此类退出码
  const ok = r.status === 0 || (opts.allowExit1 && r.status === 1);
  if (!ok) {
    errors.push(`[执行失败] ${name} 退出码 ${r.status}：${(r.stderr || r.stdout || '').slice(0, 300)}`);
    return null;
  }
  return r.stdout;
}

// ── knip 输出解析（兼容 v3/v4/v5 格式）─────────────────
// v5 实际格式：issues: [{ file, exports: [{name,line,col}], files: [{name}],
//                        types: [...], unlisted: [...], ... }]
// 每项按类型挂数组；files 数组 = 整个文件未使用；其余数组 = 该类型未使用项。

const KNIP_TYPES = ['exports', 'types', 'enumMembers', 'unlisted', 'dependencies', 'devDependencies', 'binaries', 'namespaceMembers', 'duplicates', 'catalog', 'catalogReferences', 'optionalPeerDependencies', 'unresolved'];

function parseKnip(stdout) {
  try {
    const data = JSON.parse(stdout);
    const out = [];
    if (Array.isArray(data.issues)) {
      for (const it of data.issues) {
        const file = it.file || '?';
        for (const type of KNIP_TYPES) {
          for (const item of it[type] || []) {
            const name = typeof item === 'string' ? item : item.name || '';
            out.push(`${file}|${type}|${name}`);
          }
        }
        for (const f of it.files || []) {
          out.push(`${file}|file|${typeof f === 'string' ? f : f.name || ''}`);
        }
      }
    } else if (data.files && typeof data.files === 'object') {
      // v3/v4：files: { "path": [issues...] }
      for (const [file, issues] of Object.entries(data.files)) {
        for (const it of issues) {
          out.push(`${file}|${typeof it === 'string' ? it : it.issueType || JSON.stringify(it)}`);
        }
      }
    }
    return out;
  } catch {
    errors.push('[解析失败] knip 输出非 JSON（可能被插件/告警污染），请手工运行 npx knip 排查');
    return [];
  }
}

// ── jscpd 输出解析 ────────────────────────────────────
// jscpd 将 JSON 报告写入 cwd 下 report/jscpd-report.json（--output 对 json
// reporter 不生效），克隆数据在 duplicates 数组。

const JSCPD_REPORT = path.join(FRONTEND, 'report', 'jscpd-report.json');

function parseJscpd() {
  try {
    const data = JSON.parse(fs.readFileSync(JSCPD_REPORT, 'utf-8'));
    const clones = data.duplicates || [];
    return clones.map((c) => {
      // jscpd 在 Windows 输出反斜杠路径（如 views\a.ts），基线为正斜杠——
      // 统一 toPosix 归一化，否则跨平台比对全部误判「新增」（code_review P3）
      const f1 = (c.firstFile?.name || '?').replace(/\\/g, '/');
      const f2 = (c.secondFile?.name || '?').replace(/\\/g, '/');
      // key 用文件对级（去行号）：克隆位置随代码微移漂移时，不产生新 key 误报新增
      return `${f1}#${f2}`;
    });
  } catch {
    errors.push('[解析失败] jscpd 报告读取异常（期望 frontend/report/jscpd-report.json）');
    return [];
  }
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  const knipOut = run('knip', ['--reporter', 'json'], { allowExit1: true });
  if (knipOut !== null) knipFindings = parseKnip(knipOut);

  // jscpd 5.x 发现重复代码时默认 exit 0（未传 --threshold/--exitCode），
  // exit 1 仅代表真实失败（glob 错误/IO/崩溃）——不传 allowExit1，让真实失败
  // 以 [执行失败] 暴露，而非被掩盖成 [解析失败]/消费陈旧报告（code_review P3）
  const jscpdOut = run('jscpd', ['--pattern', 'src/**/*.{js,ts}', '--min-lines', '10', '--min-tokens', '50', '--reporters', 'json', '--silent']);
  if (jscpdOut !== null) {
    jscpdFindings = parseJscpd();
    // 清理 jscpd 产物文件（report/jscpd-report.json 是分析副产物，不留仓库；
    // 只删报告文件本身，不 rmSync 整个 report/ 目录——避免误删其他产物）
    fs.rmSync(JSCPD_REPORT, { force: true });
  }

  const current = { knip: [...new Set(knipFindings)].sort(), jscpd: [...new Set(jscpdFindings)].sort() };

  if (UPDATE) {
    // 守卫：工具缺失（knip/jscpd 执行失败返回 null）禁止写盘——
    // 否则空 findings 被写盘后旧债务全部洗白（门禁锐评 P1-3 漏洞）。
    if (knipFindings.length === 0 && knipOut === null) {
      errors.push('[工具缺失] knip 未执行成功，拒绝写盘（防止空基线洗白债务）');
    }
    if (jscpdFindings.length === 0 && jscpdOut === null) {
      errors.push('[工具缺失] jscpd 未执行成功，拒绝写盘（防止空基线洗白债务）');
    }
    if (errors.length > 0) {
      console.log(errors.join('\n'));
      console.log('✖ 基线未更新（存在守卫拦截）');
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ generated: new Date().toISOString(), ...current }, null, 2) + '\n');
    infos.push(`--update-baseline：已写入 ${current.knip.length} 条 knip + ${current.jscpd.length} 条 jscpd 基线`);
  } else if (fs.existsSync(BASELINE_FILE)) {
    let base;
    try {
      base = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
    } catch {
      errors.push('[基线损坏] deadcode-baseline.json 无法解析，可删除后重跑 --update-baseline');
      base = { knip: [], jscpd: [] };
    }
    const baseK = new Set(base.knip || []);
    const baseJ = new Set(base.jscpd || []);
    const newK = current.knip.filter((k) => !baseK.has(k));
    const newJ = current.jscpd.filter((k) => !baseJ.has(k));
    const goneK = [...baseK].filter((k) => !current.knip.includes(k));
    const goneJ = [...baseJ].filter((k) => !current.jscpd.includes(k));

    for (const k of newK) errors.push(`[新增死代码] ${k}`);
    for (const k of newJ) errors.push(`[新增重复代码] ${k}`);
    for (const k of goneK.slice(0, 10)) infos.push(`[已清理] knip 基线项消失: ${k}`);
    for (const k of goneJ.slice(0, 10)) infos.push(`[已清理] jscpd 基线项消失: ${k}`);
  } else {
    // ADR-043 fail-closed：无基线文件 = 无法比对 = 扫描不完整，必须 ERROR 而非 INFO——
    // 此前仅提示「首次运行请建基线」后 exit 0，门禁把「未建立基线」误当「无新增死代码」放行
    errors.push('无基线文件（deadcode-baseline.json 不存在）——无法比对死代码/重复代码，请先运行 node scripts/check-deadcode-baseline.mjs --update-baseline 建立基线');
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ _summary: { errors: errors.length, infos: infos.length, knip: current.knip.length, jscpd: current.jscpd.length }, errors, infos, current, baselineUpdated: UPDATE }, null, 2));
    process.exit(errors.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 死代码/重复代码基线 (check-deadcode-baseline)');
  console.log('══════════════════════════════════════');
  console.log(`knip 发现  : ${current.knip.length}`);
  console.log(`jscpd 发现 : ${current.jscpd.length}`);
  console.log(`ERROR      : ${errors.length}`);
  console.log(`INFO       : ${infos.length}`);
  console.log('──────────────────────────────────────');

  for (const i of infos) console.log(`ℹ ${i}`);
  if (errors.length) {
    for (const e of errors.slice(0, 25)) console.log(`❌ ${e}`);
    if (errors.length > 25) console.log(`  … 其余 ${errors.length - 25} 条（--json 全量）`);
    console.log('→ 修复: node scripts/check-deadcode-baseline.mjs --update-baseline（接受现状）或删除未引用导出');
    console.log('\n退出码 1（新增死代码/重复代码阻断）。');
    process.exit(1);
  }
  console.log('✅ 无新增死代码/重复代码（基线内已知项放行）。');
}

main();
