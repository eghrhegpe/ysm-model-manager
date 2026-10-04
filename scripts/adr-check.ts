#!/usr/bin/env node
/**
 * adr-check.ts — ADR 登记一致性检查（占号防撞机制落地）。
 *
 * 校验 docs/adr/ 三区（根存量 / architecture/ / decisions/，ADR-320）文件 vs adr/index.md 登记表：
 *   - 文件编号唯一（无撞号，主编号+子编号二元组判定）
 *   - 登记表覆盖全部文件（无漏登）
 *   - 文件都在登记表（无幽灵文件）
 *   - 主编号连续（无跳号，空缺需注明；decisions 子编号不参与连续性）
 *   - 状态行合规（STATUS_MISSING=真没有；STATUS_FORMAT=有但格式不对，报行号与正确写法）
 *   - 文件名编号 vs 标题编号一致（ID_MISMATCH，ADR-320 分级语法防呆）
 * 呼应 ADR-013 Phase 0.2「写文件前先在登记表占号」。
 *
 * 零依赖（仅 node:fs / node:path / node:url；三区枚举与语法收口 _lib/adr-files.ts）。
 *
 * 用法：
 *   node scripts/adr-check.ts              # 文本报告
 *   node scripts/adr-check.ts --json       # JSON（CI / 子代理消费）
 *
 * 退出码：发现不一致（撞号 / 漏登 / 幽灵 / 跳号）→ 1；否则 0。
 * 设计意图：ADR 登记一致性检查（占号防撞）
 */
import fs from "node:fs";
import path from "node:path";
import {
  ADR_DIR,
  ADR_TITLE_RE,
  type AdrFileRef,
  adrId,
  listAdrFiles,
  parseAdrFilename,
  REG_ROW_ID_RE,
} from "./_lib/adr-files.ts";

const REG_FILE = path.join(ADR_DIR, "index.md"); // 登记表已并入 index（ADR 双文件合并）

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");

const errors: string[] = [];

// 早退路径（目录/登记表缺失时提前 finish()）也需可读：顶部初始化默认值，
// 后续流程赋值，避免 finish() 访问未初始化 const 命中 TDZ 崩栈。
let files: AdrFileRef[] = [];
let regNums = new Set<string>();
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
    if (!head || head === "|" || head === "#" || head === ">") continue; // 空行/表格/标题/引用
    return { line: line.trim(), no: i + 1 };
  }
  return null;
}

// 1. 扫描三区文件（根存量 + architecture/ + decisions/）
if (!fs.existsSync(ADR_DIR)) {
  errors.push("MISSING: docs/adr/ 目录不存在");
  finish();
}

files = listAdrFiles();

if (!files.length) {
  errors.push("NO_FILES: adr/ 目录下没有 ADR 文件");
  finish();
}

// 2. 解析每个文件编号 + 标题 + 状态
// 合法状态前缀（AGENTS.md：📝 提议中 / ✅ 已采纳 / 🔄 部分采纳 / 🧊 已废弃 / ❌ 已取代；
// 存量文件存在无 emoji 的「已采纳」写法，两者均放行，避免误报存量）
const VALID_STATUS = [
  "📝 提议中",
  "✅ 已采纳",
  "🔄 部分采纳",
  "🧊 已废弃",
  "❌ 已取代",
  "提议中",
  "已采纳",
  "部分采纳",
  "已废弃",
  "已取代",
];
const fileMeta: Record<string, any> = {};
for (const ref of files) {
  const text = fs.readFileSync(ref.absPath, "utf-8");
  const titleM = ADR_TITLE_RE.exec(text);
  const statusM = text.match(/^-\s*\*\*状态\*\*[：:]\s*(.+)$/m);
  // 近似写法（如「**状态：** ✅ 已采纳」）供精准报错：有状态信息但格式不合规 → STATUS_FORMAT，而非误报"缺少"
  const statusLike = findStatusLike(text);
  if (!titleM) {
    errors.push(`TITLE_MISSING: ${ref.relPath} 缺少 '# ADR-NNN(-dN)?：' 标题`);
    continue;
  }
  const num = parseInt(titleM[1]!, 10);
  const sub = titleM[2] ? parseInt(titleM[2], 10) : null;
  const id = adrId(num, sub);
  // 文件名编号 vs 标题编号一致性（ADR-320 分级语法防呆：防止挂靠错位/复制改名漏改标题）
  const fnameParsed = parseAdrFilename(ref.name);
  if (fnameParsed && adrId(fnameParsed.num, fnameParsed.sub) !== id) {
    errors.push(
      `ID_MISMATCH: ${ref.relPath} 文件名编号 ${adrId(fnameParsed.num, fnameParsed.sub)} 与标题编号 ${id} 不一致`,
    );
    continue;
  }
  if (fileMeta[id]) {
    errors.push(`DUP_NUM: 编号 ${id} 撞号：${fileMeta[id].file} 与 ${ref.relPath}`);
    continue; // 撞号时保留首个文件元数据供后续对账，避免被覆盖（code_review P3-1）
  }
  const statusRaw = statusM ? statusM[1]?.trim() : "";
  if (statusLike) {
    errors.push(
      `STATUS_FORMAT: ${ref.relPath} 第 ${statusLike.no} 行「${statusLike.line}」写法不合规——状态行必须是「- **状态**：」前缀的列表项，如「- **状态**：✅ 已采纳」`,
    );
  } else if (!statusRaw) {
    errors.push(`STATUS_MISSING: ${ref.relPath} 缺少 '- **状态**：' 行`);
  } else if (!VALID_STATUS.some((s) => statusRaw.startsWith(s))) {
    // statusRaw 非空 ⇒ statusM 必存在，?? 分支不可达；text.length 与原 `?.index!`
    // 在 statusM 为空时的运行时行为（slice(0, undefined) = 全文）完全一致
    const statusIdx = statusM?.index ?? text.length;
    errors.push(
      `BAD_STATUS: ${ref.relPath} 第 ${lineNo(text, statusIdx)} 行状态「${statusRaw}」不在合法枚举 ${VALID_STATUS.join(" / ")}（code_review P2-1）`,
    );
  }
  fileMeta[id] = {
    file: ref.relPath,
    num,
    sub,
    id,
    title: titleM[3]?.trim(),
    status: statusRaw || "(未标注状态)",
  };
}

// 3. 读登记表
let regText = "";
try {
  regText = fs.readFileSync(REG_FILE, "utf-8");
} catch (e) {
  // 区分"不存在"与"权限/其他读取失败"，避免把 EACCES 误报成 MISSING（code_review P3-3）
  errors.push(`MISSING: adr/index.md 登记表读取失败: ${(e as any).code || (e as any).message}`);
  finish();
}

regNums = new Set<string>();
for (const m of regText.matchAll(REG_ROW_ID_RE)) {
  regNums.add(m[1]!);
}

// 4. 对账（ID = 主编号 或 主编号-d子编号）
for (const id of Object.keys(fileMeta).sort()) {
  if (!regNums.has(id)) {
    errors.push(`NOT_REGISTERED: ${id} (${fileMeta[id].file}) 未在 adr/index.md 登记表占号`);
  }
}
for (const id of [...regNums].sort()) {
  if (!fileMeta[id]) {
    errors.push(`GHOST: 登记表有 ${id}，但磁盘无对应文件`);
  }
}

// 5. 主编号连续性（空缺注明为警告；decisions 子编号不参与）
const mainNums = [
  ...new Set([
    ...Object.values(fileMeta)
      .filter((m) => m.sub === null)
      .map((m) => m.num as number),
    ...[...regNums].filter((id) => /^ADR-\d{3}$/.test(id)).map((id) => parseInt(id.slice(4), 10)),
  ]),
].sort((a, b) => a - b);
gaps = [];
if (mainNums.length > 1) {
  for (let i = mainNums[0]!; i <= mainNums[mainNums.length - 1]!; i++) {
    if (!mainNums.includes(i)) gaps.push(i);
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
    process.stdout.write(
      `${JSON.stringify({ _summary: summary, errors, gaps: gaps || [] }, null, 2)}\n`,
    );
  } else {
    console.log(`ADR 检查：${files.length} 个文件，登记表 ${regNums.size} 条`);
    if (gaps?.length)
      console.log(
        `  ⚠️ 编号空缺（未占用）: ${gaps.map((n) => `ADR-${String(n).padStart(3, "0")}`).join(", ")}`,
      );
    if (errors.length) {
      console.log(`FAILED: ${errors.length} 个问题\n`);
      for (const e of errors) console.log(`  [${e}]`);
      process.exit(1);
    } else {
      console.log("OK: 登记表与磁盘一致，编号无撞号、无漏登");
    }
  }
  process.exit(errors.length ? 1 : 0);
}

finish();
