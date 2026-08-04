#!/usr/bin/env node
/**
 * check-boolean-naming.mjs — 布尔变量命名规范检查器。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 扫描 frontend/js/ 下所有 .js（排除 css/ 子目录），检查三类布尔声明：
 *   1. 字面量初始化  const/let/var x = true|false
 *   2. 类型注解      x: boolean
 *   3. 函数返回类型  function f(): boolean
 *
 * 规范：布尔变量名首词必须是语义动词/状态词（is/has/can/should/enable/
 * visible/selected/loading/checked/active/ready/open 等）。违规 → WARN
 * （默认）或 ERROR（--strict）。
 *
 * 排除：全大写常量、_ 私有变量、导入绑定、DOM 事件参数（event/ev）。
 *
 * 用法：
 *   node scripts/check-boolean-naming.mjs            # WARN 级
 *   node scripts/check-boolean-naming.mjs --strict   # ERROR 级
 *   node scripts/check-boolean-naming.mjs --json     # JSON（CI 用）
 *
 * 退出码：ERROR 数 > 0 → 1；否则 0。
 * 设计意图：Boolean 字段命名规范检查（env-state-schema.ts）
 */
import fs from 'node:fs';
import { SRC_DIR, walk, relPosix } from './_lib/scan-files.mjs';

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const STRICT = ARGS.has('--strict');

const VALID_PREFIXES = new Set([
  'is', 'has', 'can', 'should', 'will', 'may', 'must',
  'allow', 'enable', 'enabled', 'disable', 'disabled',
  'visible', 'selected', 'loading', 'checked', 'active', 'ready',
  'open', 'muted', 'paused', 'playing', 'dirty', 'valid', 'required',
  'success', 'failed', 'pending', 'show', 'hide', 'expanded', 'collapsed',
  'focused', 'hovered', 'dragging', 'running', 'stopped', 'done', 'empty',
  'error', 'editable', 'clickable', 'draggable', 'resizable',
]);

const findings = [];

function checkName(name, loc) {
  if (name.startsWith('_')) return; // 私有变量豁免（闭包状态命名自由）
  if (/^[a-zA-Z]$/.test(name)) return; // 单字母惯用短名
  if (/^[A-Z0-9_]+$/.test(name)) return; // 全大写常量
  if (['event', 'ev', 'e', 'err', 'error'].includes(name)) return; // 惯用短名
  const firstWord = (name.match(/^[a-z]+/) || [''])[0]; // 区分大小写，只取首个小写词
  if (!VALID_PREFIXES.has(firstWord)) {
    findings.push({ name, firstWord, loc });
  }
}

function scanFile(file) {
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  const rel = relPosix(file);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const loc = `${rel}:${i + 1}`;

    // 1. 字面量初始化（排除 import 与解构行）
    if (!/^\s*(import|export\s+default)/.test(line)) {
      for (const m of line.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:true|false)\b/g)) {
        checkName(m[1], loc);
      }
      // 2. 类型注解 x: boolean
      for (const m of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*boolean\b/g)) {
        checkName(m[1], loc);
      }
    }
    // 3. 函数返回类型 function f(): boolean
    for (const m of line.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:\s*boolean\b/g)) {
      checkName(m[1], loc);
    }
  }
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.log(JSON_OUT ? JSON.stringify({ findings: [], error: 'frontend/js 不存在' }) : 'frontend/js 目录不存在');
    process.exit(1);
  }
  const files = walk(SRC_DIR);
  for (const f of files) scanFile(f);

  const uniq = new Map(); // 去重（同名同文件多行可能重复）
  for (const f of findings) uniq.set(`${f.name}@${f.loc}`, f);
  const results = [...uniq.values()];

  if (JSON_OUT) {
    console.log(JSON.stringify({ _summary: { scanned: files.length, findings: results.length }, findings: results, scanned: files.length, strict: STRICT }, null, 2));
    process.exit(STRICT && results.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 布尔命名检查 (check-boolean-naming)');
  console.log('══════════════════════════════════════');
  console.log(`扫描文件 : ${files.length}`);
  console.log(`违规     : ${results.length}（${STRICT ? 'ERROR 级' : 'WARN 级'}）`);
  console.log('──────────────────────────────────────');

  for (const r of results) {
    console.log(`  ${STRICT ? '❌' : '⚠'} ${r.loc}  「${r.name}」首词「${r.firstWord}」非布尔语义词（建议 is/has/can/should/visible/... 前缀）`);
  }

  if (STRICT && results.length) {
    console.log('\n退出码 1（--strict 模式阻断）。');
    process.exit(1);
  }
  console.log(results.length ? '\n（WARN 级不阻断，加 --strict 可升级为 ERROR）' : '✅ 布尔命名全部合规。');
}

main();
