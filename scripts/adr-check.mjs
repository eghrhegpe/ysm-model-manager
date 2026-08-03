#!/usr/bin/env node
/**
 * ADR 登记一致性检查（占号防撞机制落地）。
 * 校验 docs/architecture/adr/ 目录文件 vs adr/README.md 登记表：
 *   - 文件编号唯一（无撞号）
 *   - 登记表覆盖全部文件（无漏登）
 *   - 文件都在登记表（无幽灵文件）
 *   - 编号连续（无跳号，空缺需注明）
 * 呼应 ADR-013 Phase 0.2「写文件前先在登记表占号」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADR_DIR = path.join(ROOT, 'docs/architecture/adr');
const REG_FILE = path.join(ADR_DIR, 'README.md');

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

const errors = [];

// 1. 扫描目录文件
if (!fs.existsSync(ADR_DIR)) {
  errors.push('MISSING: docs/architecture/adr/ 目录不存在');
  finish();
}

const files = fs.readdirSync(ADR_DIR)
  .filter((f) => /^ADR-\d{3}-.*\.md$/.test(f))
  .sort();

if (!files.length) {
  errors.push('NO_FILES: adr/ 目录下没有 ADR 文件');
  finish();
}

// 2. 解析每个文件编号 + 标题 + 状态
const fileMeta = {};
for (const f of files) {
  const text = fs.readFileSync(path.join(ADR_DIR, f), 'utf-8');
  const titleM = text.match(/^# ADR-(\d{3})[：:]\s*(.+)$/m);
  const statusM = text.match(/^-\s*\*\*状态\*\*[：:]\s*(.+)$/m);
  if (!titleM) {
    errors.push(`TITLE_MISSING: ${f} 缺少 '# ADR-NNN：' 标题`);
    continue;
  }
  const num = parseInt(titleM[1], 10);
  if (fileMeta[num]) {
    errors.push(`DUP_NUM: 编号 ADR-${String(num).padStart(3, '0')} 撞号：${fileMeta[num].file} 与 ${f}`);
  }
  fileMeta[num] = {
    file: f,
    num,
    title: titleM[2].trim(),
    status: statusM ? statusM[1].trim() : '(未标注状态)',
  };
}

// 3. 读登记表
let regText = '';
try {
  regText = fs.readFileSync(REG_FILE, 'utf-8');
} catch {
  errors.push('MISSING: adr/README.md 登记表不存在');
  finish();
}

const regNums = new Set();
const regRows = {};
for (const m of regText.matchAll(/^\|\s*ADR-(\d{3})\s*\|/gm)) {
  const num = parseInt(m[1], 10);
  regNums.add(num);
  regRows[num] = true;
}

// 4. 对账
for (const num of Object.keys(fileMeta).map(Number).sort((a, b) => a - b)) {
  if (!regNums.has(num)) {
    errors.push(`NOT_REGISTERED: ADR-${String(num).padStart(3, '0')} (${fileMeta[num].file}) 未在 adr/README.md 登记表占号`);
  }
}
for (const num of [...regNums].sort((a, b) => a - b)) {
  if (!fileMeta[num]) {
    errors.push(`GHOST: 登记表有 ADR-${String(num).padStart(3, '0')}，但磁盘无对应文件`);
  }
}

// 5. 编号连续性（空缺注明为警告）
const nums = Object.keys(fileMeta).map(Number).sort((a, b) => a - b);
const gaps = [];
if (nums.length > 1) {
  for (let i = nums[0]; i <= nums[nums.length - 1]; i++) {
    if (!fileMeta[i] && !regNums.has(i)) gaps.push(i);
  }
}

function finish() {
  const summary = {
    files: files.length,
    registered: regNums.size,
    issues: errors.length,
    gaps: gaps || [],
  };
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ _summary: summary, errors, gaps: gaps || [] }, null, 2) + '\n');
  } else {
    console.log(`ADR 检查：${files.length} 个文件，登记表 ${regNums.size} 条`);
    if (gaps && gaps.length) console.log(`  ⚠️ 编号空缺（未占用）: ${gaps.map((n) => `ADR-${String(n).padStart(3, '0')}`).join(', ')}`);
    if (errors.length) {
      console.log(`FAILED: ${errors.length} 个问题\n`);
      for (const e of errors) console.log(`  [${e}]`);
      process.exit(1);
    } else {
      console.log('OK: 登记表与磁盘一致，编号无撞号、无漏登');
    }
  }
  process.exit(errors.length ? 1 : 0);
}

finish();
