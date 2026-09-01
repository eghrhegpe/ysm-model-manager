#!/usr/bin/env node
/**
 * adr-check.ts — ADR 登记一致性检查（占号防撞机制落地）。
 *
 * 校验 docs/adr/ 目录文件 vs adr/index.md 登记表：
 *   - 文件编号唯一（无撞号）
 *   - 登记表覆盖全部文件（无漏登）
 *   - 文件都在登记表（无幽灵文件）
 *   - 编号连续（无跳号，空缺需注明）
 *   - 状态行合规（STATUS_MISSING=真没有；STATUS_FORMAT=有但格式不对，报行号与正确写法）
 * 呼应 ADR-013 Phase 0.2「写文件前先在登记表占号」。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 用法：
 *   node scripts/adr-check.ts              # 文本报告
 *   node scripts/adr-check.ts --json       # JSON（CI / 子代理消费）
 *
 * 退出码：发现不一致（撞号 / 漏登 / 幽灵 / 跳号）→ 1；否则 0。
 * 设计意图：ADR 登记一致性检查（占号防撞）
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';

const ADR_DIR = path.join(ROOT, 'docs/adr');
const REG_FILE = path.join(ADR_DIR, 'index.md'); // 登记表已并入 index（ADR 双文件合并）

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

const errors: string[] = [];

// 早退路径（目录/登记表缺失时提前 finish()）也需可读：顶部初始化默认值，
// 后续流程赋值，避免 finish() 访问未初始化 const 命中 TDZ 崩栈。
let files: string[] = [];
let regNums = new Set<number>();
let gaps: number[] = [];

// 文本位置 → 行号（1-based，报错定位用）
function lineNo(text: string, index: number) {
  return text.slice(0, index).split(/\r?\n/).length;
}

// 找「**状态…：」但写法不合规的行（如「**状态：** ✅ 已采纳」），供精准报错。
// 逐行检测而非整文正则：避免 m 模式下 ^ 与字符类把前一行换行符当行首（回溯歧义）。
// 跳过：表格行（|）、标题（#）、引用（>）、空行、规范列表项（- **状态**：）。
function findStatusLike(text: string) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/\*\*状态\s*[：:]/.test(line)) continue; // 无「**状态：」键
    const head = line.trimStart()[0];
    if (!head || head === '|' || head === '#' || head === '>') continue; // 空行/表格/标题/引用
    return { line: line.trim(), no: i + 1 };
  }
  return null;
}

// 1. 扫描目录文件
if (!fs.existsSync(ADR_DIR)) {
  errors.push('MISSING: docs/adr/ 目录不存在');
  finish();
}

files = fs.readdirSync(ADR_DIR)
  .filter((f) => /^ADR-\d{3}-.*\.md$/.test(f))
  .sort();

if (!files.length) {
  errors.push('NO_FILES: adr/ 目录下没有 ADR 文件');
  finish();
}

// 2. 解析每个文件编号 + 标题 + 状态
// 合法状态前缀（AGENTS.md：✅ 已采纳 / 🔄 部分采纳 / 🧊 已废弃 / ❌ 已取代；
// 存量文件存在无 emoji 的「已采纳」写法，两者均放行，避免误报存量）
const VALID_STATUS = ['✅ 已采纳', '🔄 部分采纳', '🧊 已废弃', '❌ 已取代', '已采纳', '部分采纳', '已废弃', '已取代'];
const fileMeta: Record<number, any> = {};
for (const f of files) {
  const text = fs.readFileSync(path.join(ADR_DIR, f), 'utf-8');
  const titleM = text.match(/^# ADR-(\d{3})[：:]\s*(.+)$/m);
  const statusM = text.match(/^-\s*\*\*状态\*\*[：:]\s*(.+)$/m);
  // 近似写法（如「**状态：** ✅ 已采纳」）供精准报错：有状态信息但格式不合规 → STATUS_FORMAT，而非误报"缺少"
  const statusLike = findStatusLike(text);
  if (!titleM) {
    errors.push(`TITLE_MISSING: ${f} 缺少 '# ADR-NNN：' 标题`);
    continue;
  }
  const num = parseInt(titleM[1]!, 10);
  if (fileMeta[num]) {
    errors.push(`DUP_NUM: 编号 ADR-${String(num).padStart(3, '0')} 撞号：${fileMeta[num].file} 与 ${f}`);
    continue; // 撞号时保留首个文件元数据供后续对账，避免被覆盖（code_review P3-1）
  }
  const statusRaw = statusM ? statusM[1]!.trim() : '';
  if (statusLike) {
    errors.push(`STATUS_FORMAT: ${f} 第 ${statusLike.no} 行「${statusLike.line}」写法不合规——状态行必须是「- **状态**：」前缀的列表项，如「- **状态**：✅ 已采纳」`);
  } else if (!statusRaw) {
    errors.push(`STATUS_MISSING: ${f} 缺少 '- **状态**：' 行`);
  } else if (!VALID_STATUS.some((s) => statusRaw.startsWith(s))) {
    errors.push(`BAD_STATUS: ${f} 第 ${lineNo(text, statusM!.index!)} 行状态「${statusRaw}」不在合法枚举 ${VALID_STATUS.join(' / ')}（code_review P2-1）`);
  }
  fileMeta[num] = {
    file: f,
    num,
    title: titleM[2]!.trim(),
    status: statusRaw || '(未标注状态)',
  };
}

// 3. 读登记表
let regText = '';
try {
  regText = fs.readFileSync(REG_FILE, 'utf-8');
} catch (e) {
  // 区分"不存在"与"权限/其他读取失败"，避免把 EACCES 误报成 MISSING（code_review P3-3）
  errors.push(`MISSING: adr/index.md 登记表读取失败: ${(e as any).code || (e as any).message}`);
  finish();
}

regNums = new Set<number>();
const regRows: Record<number, boolean> = {};
for (const m of regText.matchAll(/^\|\s*ADR-(\d{3})\s*\|/gm)) {
  const num = parseInt(m[1]!, 10);
  regNums.add(num);
  regRows[num] = true;
}

// 4. 对账
for (const num of Object.keys(fileMeta).map(Number).sort((a, b) => a - b)) {
  if (!regNums.has(num)) {
    errors.push(`NOT_REGISTERED: ADR-${String(num).padStart(3, '0')} (${fileMeta[num].file}) 未在 adr/index.md 登记表占号`);
  }
}
for (const num of [...regNums].sort((a, b) => a - b)) {
  if (!fileMeta[num]) {
    errors.push(`GHOST: 登记表有 ADR-${String(num).padStart(3, '0')}，但磁盘无对应文件`);
  }
}

// 5. 编号连续性（空缺注明为警告）
const nums = Object.keys(fileMeta).map(Number).sort((a, b) => a - b);
gaps = [];
if (nums.length > 1) {
  for (let i = nums[0]!; i <= nums[nums.length - 1]!; i++) {
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
