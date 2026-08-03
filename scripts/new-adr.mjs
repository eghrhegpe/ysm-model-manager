#!/usr/bin/env node
/**
 * new-adr.mjs — 新 ADR 脚手架（占号 → 模板 → 登记 → 自检闭环）。
 *
 * 零依赖（仅 node:fs / node:path / node:url / node:child_process）。
 * 呼应 ADR-013 Phase 0.2「写文件前先在 adr/README.md 登记表占号」：
 *   1. 双源取最大编号（磁盘文件 + 登记表）→ +1 占号
 *   2. 生成 ADR-NNN-slug.md 四段模板（背景/决策/后果/数据溯源）
 *   3. 登记表插入占号行
 *   4. 自动运行 adr-check 验证对账
 *
 * 用法：
 *   node scripts/new-adr.mjs "标题" [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...]
 *   node scripts/new-adr.mjs "标题" --dry-run        # 只算号不写文件
 *
 * --supersedes：新 ADR 取代既有 ADR 时，自动在对方首部加「被 [ADR-NNN] 取代」标注
 *               （呼应 AGENTS.md ADR 规则「触及就在对方首部标注」）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 与 adr-check.mjs / gen-docs-index.mjs 保持一致：ADR 目录在 docs/adr（非 docs/architecture/adr）
const ADR_DIR = path.join(ROOT, 'docs', 'adr');
const REG_FILE = path.join(ADR_DIR, 'README.md');

// ── 参数解析 ────────────────────────────────────────────

function parseArgs(argv) {
  const args = { title: null, slug: null, related: null, supersedes: [], dryRun: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--slug') args.slug = argv[++i] ?? null;
    else if (a === '--related') args.related = argv[++i] ?? null;
    else if (a === '--supersedes') {
      const v = argv[++i] ?? '';
      args.supersedes = v
        .split(/[，,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else positional.push(a);
  }
  args.title = positional[0] ?? null;
  return args;
}

function usage() {
  console.error(
    '用法: node scripts/new-adr.mjs "标题" [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...] [--dry-run]\n' +
      '  --slug        文件名 kebab-case（缺省从标题提取 ASCII，无 ASCII 则必填）\n' +
      '  --related     相关文档/代码位置（写入模板「相关」行）\n' +
      '  --supersedes  被本 ADR 取代的既有 ADR（逗号分隔，自动在对方首部加「被 [ADR-NNN] 取代」标注）\n' +
      '  --dry-run     只计算并打印新编号，不写任何文件'
  );
}

// ── 编号占号（双源取最大 +1）───────────────────────────

function maxFromFiles() {
  if (!fs.existsSync(ADR_DIR)) return 0;
  return fs
    .readdirSync(ADR_DIR)
    .map((f) => /^ADR-(\d{3})-/.exec(f)?.[1])
    .filter(Boolean)
    .reduce((m, s) => Math.max(m, parseInt(s, 10)), 0);
}

function maxFromRegistry() {
  let max = 0;
  try {
    const text = fs.readFileSync(REG_FILE, 'utf8');
    for (const m of text.matchAll(/^\|\s*ADR-(\d{3})\s*\|/gm)) {
      max = Math.max(max, parseInt(m[1], 10));
    }
  } catch {
    /* 登记表不存在则只以磁盘为准 */
  }
  return max;
}

const pad = (n) => String(n).padStart(3, '0');

// ── slug 生成 ───────────────────────────────────────────

function toSlug(title, explicit) {
  if (explicit) return explicit.replace(/[^a-z0-9-]/gi, '').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const m = title.match(/[a-zA-Z0-9]+/g);
  if (!m) return null;
  return m.join('-').toLowerCase();
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 模板 ────────────────────────────────────────────────

function buildTemplate(num, title, slug, related) {
  const n = pad(num);
  const rel = related ? `**相关**：\`${related}\`` : '**相关**：待补（`docs/adr/` / 关联代码路径）';
  return `# ADR-${n}：${title}

- **状态**：已采纳（Accepted）
- **日期**：${today()}
- **决策人**：Jieling（人类首席架构师）、AI 代理
- ${rel}

---

## 1. 背景（Context）

<!-- TODO: 问题背景与动机 -->

## 2. 决策（Decision）

<!-- TODO: 方案与理由 -->

## 3. 后果（Consequences）

<!-- TODO: 正面 / 负面 / 已知遗留 -->

## 4. 数据溯源

<!-- TODO: 来源 → 结果 -->

<!-- 文件名: ${slug}.md → 实际文件 ADR-${n}-${slug}.md -->
`;
}

// ── 登记表占号 ──────────────────────────────────────────

function registerLine(regText, num, title) {
  const n = pad(num);
  const newLine = `| ADR-${n} | ${title.replace(/\|/g, '\\|')} | ✅ 已采纳 | ${today()} |`;
  // 定位登记表最后一行 `| ADR-xxx |`
  const matches = [...regText.matchAll(/^\|\s*ADR-\d{3}\s*\|.*$/gm)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const idx = last.index + last[0].length;
  return regText.slice(0, idx) + '\n' + newLine + regText.slice(idx);
}

// ── 被取代标注（AGENTS.md ADR 规则）───────────────────
// 新 ADR（supersedingNum）取代既有 ADR：在对方首部状态行下加「被 [ADR-NNN] 取代」。
// 幂等：对方已有「被取代」标注则跳过。

function annotateSuperseded(targetRefs, supersedingNum) {
  let ok = true;
  for (const ref of targetRefs) {
    const m = String(ref).match(/(\d{1,3})/);
    if (!m) {
      console.error(`[FAIL] --supersedes 无法解析「${ref}」，需形如 ADR-012 或 012`);
      ok = false;
      continue;
    }
    const tNum = parseInt(m[1], 10);
    const fname = fs.readdirSync(ADR_DIR).find((f) => new RegExp(`^ADR-${pad(tNum)}-`).test(f));
    if (!fname) {
      console.error(`[FAIL] 未找到 ADR-${pad(tNum)} 文件`);
      ok = false;
      continue;
    }
    const fp = path.join(ADR_DIR, fname);
    let text = fs.readFileSync(fp, 'utf8');
    if (/^-\s*\*\*被取代\*\*/m.test(text)) {
      console.log(`[SKIP] ADR-${pad(tNum)} 已有「被取代」标注`);
      continue;
    }
    const statusM = text.match(/^(-\s*\*\*状态\*\*[：:][^\n]*)$/m);
    if (!statusM) {
      console.error(`[FAIL] ADR-${pad(tNum)} 缺少状态行，无法插入标注`);
      ok = false;
      continue;
    }
    const idx = statusM.index + statusM[0].length;
    text = text.slice(0, idx) + `\n- **被取代**：[ADR-${pad(supersedingNum)}] 取代` + text.slice(idx);
    fs.writeFileSync(fp, text, 'utf8');
    console.log(`[OK] ADR-${pad(tNum)} 首部已标注「被 [ADR-${pad(supersedingNum)}] 取代」`);
  }
  return ok;
}

// ── wx 原子占位锁（硬兜底：防多会话并行撞号）───────────
// 锁文件用 fs.openSync('wx') 原子创建：已存在即 EEXIST（冲突）。
// 锁内完成「读最大号 → 写文件 → 写登记表」整段，杜绝两个进程同时占同一号。
// 陈旧锁（mtime 超过 LOCK_STALE_MS）视为崩溃残留，删除后重试一次。

const LOCK_FILE = path.join(ADR_DIR, '.new-adr.lock');
const LOCK_STALE_MS = 10 * 60 * 1000; // 10 分钟

function acquireLock() {
  try {
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      const st = fs.statSync(LOCK_FILE);
      if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(LOCK_FILE);
        return acquireLock();
      }
    } catch {
      /* stat/unlink 失败按冲突处理 */
    }
    return false;
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    /* 锁文件已不存在则忽略 */
  }
}

// ── 主流程 ──────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.title) {
    usage();
    return 1;
  }

  const slug = toSlug(args.title, args.slug);
  if (!slug) {
    console.error('[FAIL] 标题无 ASCII 字符，无法推导文件名，请用 --slug 显式指定 kebab-case');
    return 1;
  }

  // dry-run：只算号不落盘，无需加锁
  const maxNumPre = Math.max(maxFromFiles(), maxFromRegistry());
  if (args.dryRun) {
    const nPre = pad(maxNumPre + 1);
    console.log(`[占号] 最大编号 ${pad(maxNumPre)} → 新编号 ADR-${nPre}（文件 ADR-${nPre}-${slug}.md）`);
    console.log('[dry-run] 未写入任何文件');
    return 0;
  }

  // 获取 wx 原子锁（硬兜底）。冲突时亮出当前最大号，便于并发 AI 协调。
  if (!acquireLock()) {
    const curMax = Math.max(maxFromFiles(), maxFromRegistry());
    console.error('[锁冲突] 另一并发占号进行中（.new-adr.lock 已存在）');
    console.error(`[协调] 当前实际最大编号为 ADR-${pad(curMax)}；请稍后重试，或先跑 --dry-run 确认最新编号`);
    return 1;
  }

  try {
    // 锁内读最大号（拿锁后重新读，保证拿到最新值）
    const maxNum = Math.max(maxFromFiles(), maxFromRegistry());
    const num = maxNum + 1;
    const n = pad(num);
    const filename = `ADR-${n}-${slug}.md`;
    const filePath = path.join(ADR_DIR, filename);

    console.log(`[占号] 最大编号 ${pad(maxNum)} → 新编号 ADR-${n}（文件 ${filename}）`);

    if (fs.existsSync(filePath)) {
      // 撞号：理论上锁已防并发，此处为第二道防线（如人工/脚本直接放了同号文件）。
      // 重新扫描当前实际最大号并亮出，让调用方感知「已排到哪、该从哪起」。
      const curMax = Math.max(maxFromFiles(), maxFromRegistry());
      console.error(`[撞号] ${filename} 已存在，放弃写入`);
      console.error(`[协调] 当前实际最大编号为 ADR-${pad(curMax)}；请从 ADR-${pad(curMax + 1)} 起重新占号，或先跑 --dry-run 确认最新编号`);
      return 1;
    }

    // 1. 生成模板文件
    fs.writeFileSync(filePath, buildTemplate(num, args.title, slug, args.related), 'utf8');
    console.log(`[OK] 已生成 ${path.relative(ROOT, filePath)}`);

    // 2. 登记表占号
    const regText = fs.readFileSync(REG_FILE, 'utf8');
    const next = registerLine(regText, num, args.title);
    if (next === null) {
      console.error('[FAIL] 登记表未找到 ADR 表格行（格式异常），请人工在「## 登记表」末尾补一行');
      return 1;
    }
    fs.writeFileSync(REG_FILE, next, 'utf8');
    console.log('[OK] 已登记占号 adr/README.md');

    // 2.5 被取代标注
    if (args.supersedes.length) {
      if (!annotateSuperseded(args.supersedes, num)) {
        console.error('[FAIL] 被取代标注处理失败，请检查 --supersedes 参数');
        return 1;
      }
      console.log('[提示] 被取代的 ADR 状态如需同步为「❌ 已取代」，请编辑对应文件首部后跑 gen-docs-index.mjs');
    }

    // 3. 自动对账
    const res = spawnSync(process.execPath, [path.join('scripts', 'adr-check.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    process.stdout.write(res.stdout || '');
    process.stderr.write(res.stderr || '');
    if (res.status !== 0) {
      console.error('[FAIL] adr-check 对账未通过，请检查编号或登记表');
      return 1;
    }
    console.log('[OK] 新 ADR 占号闭环完成。请编辑文件：状态 / 决策人 / 相关 / 正文。');
    return 0;
  } finally {
    releaseLock();
  }
}

process.exit(main());
