#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * new-adr.ts — 新 ADR 脚手架（占号 → 模板 → 登记 → 自检闭环）。
 *
 * 零依赖（仅 node:fs / node:path / node:url / node:child_process）。
 * 呼应 ADR-013 Phase 0.2「写文件前先在 adr/index.md 登记表占号」：
 *   1. 双源取最大编号（磁盘文件 + 登记表）→ +1 占号
 *   2. 生成 ADR-NNN-slug.md 四段模板（背景/决策/后果/数据溯源）
 *   3. 登记表插入占号行
 *   4. 自动运行 adr-check 验证对账
 *
 * ADR-320 体系分级（两级目录，存量 docs/adr/ 根不迁移）：
 *   架构级  --tier architecture --reason "一句理由" → docs/adr/architecture/（主编号延续，全量模板）
 *   执行级  --tier decisions --parent NNN           → docs/adr/decisions/（子编号 ADR-NNN-dN，轻量模板）
 *   缺省不猜级：既无 --tier 也无 --parent/--reason 时报错给用法（fail-loud）。
 *
 * 用法：
 *   node scripts/new-adr.ts "标题" --tier architecture --reason "跨域且难逆转" [--slug ...] [--related ...] [--supersedes ADR-0XX,...] [--dry-run]
 *   node scripts/new-adr.ts "标题" --tier decisions --parent 319 [--slug ...] [--dry-run]
 *   node scripts/new-adr.ts "标题" --dry-run        # 只算号不写文件
 *
 * --supersedes：新 ADR 取代既有 ADR 时，自动在对方首部加「被 [ADR-NNN] 取代」标注
 *               （呼应 AGENTS.md ADR 规则「触及就在对方首部标注」）。
 * 设计意图：ADR 新建工具（占号防撞 + ADR-320 分级路由）
 * 退出码：main()（失败）
 */
import fs from "node:fs";
import path from "node:path";
import {
  ADR_DIR,
  ARCHITECTURE_DIR,
  adrId,
  DECISIONS_DIR,
  hasMainAdr,
  listAdrFiles,
  maxMainNum,
  nextSubForParent,
} from "./_lib/adr-files.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

const REG_FILE = path.join(ADR_DIR, "index.md"); // 登记表已并入 index（ADR 双文件合并）

function usage() {
  console.error(
    '用法: node scripts/new-adr.ts "标题" --tier architecture --reason "一句理由" [--slug kebab-name] [--related 内容] [--supersedes ADR-0XX,...] [--dry-run]\n' +
      '      node scripts/new-adr.ts "标题" --tier decisions --parent NNN [--slug kebab-name] [--dry-run]\n' +
      "  --tier        architecture（架构决策，主编号延续，须配 --reason 一句理由）|\n" +
      "                decisions（执行决策日志，子编号挂靠主 ADR，须配 --parent，ADR-320）\n" +
      "  --reason      架构级准入理由一句（方向性 + 难逆转 + 跨域影响面）\n" +
      "  --parent      执行级挂靠的主 ADR 编号（如 319 → 产出 ADR-319-dN）\n" +
      "  --slug        文件名 kebab-case（缺省从标题提取 ASCII，无 ASCII 则必填）\n" +
      "  --related     相关文档/代码位置（写入模板「相关」行）\n" +
      "  --supersedes  被本 ADR 取代的既有 ADR（逗号分隔，自动在对方首部加「被 [ADR-NNN] 取代」标注）\n" +
      "  --dry-run     只计算并打印新编号与落位目录，不写任何文件",
  );
}

// ── 编号占号（双源取最大 +1，三区感知）──────────────────

/** 主编号最大值：磁盘三区（decisions 子编号行不参与占号）。 */
function maxFromFiles(files = listAdrFiles()) {
  return maxMainNum(files);
}

/** 登记表主编号行最大值（| ADR-NNN | 纯主编号行，忽略 -dN 行）。 */
function maxFromRegistry() {
  let max = 0;
  try {
    const text = fs.readFileSync(REG_FILE, "utf8");
    for (const m of text.matchAll(/^\|\s*ADR-(\d{3})\s*\|/gm)) {
      max = Math.max(max, parseInt(m[1]!, 10));
    }
  } catch {
    /* 登记表不存在则只以磁盘为准 */
  }
  return max;
}

const pad = (n: number) => String(n).padStart(3, "0");

// ── slug 生成 ───────────────────────────────────────────

function toSlug(title: string, explicit: string) {
  if (explicit)
    return explicit
      .replace(/[^a-z0-9-]/gi, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  const m = title.match(/[a-zA-Z0-9]+/g);
  if (!m) return null;
  return m.join("-").toLowerCase();
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 模板（architecture 全量 / decisions 轻量）──────────

function buildArchitectureTemplate(
  num: number,
  title: string,
  slug: string,
  related: string,
  reason: string,
) {
  const n = pad(num);
  const rel = related ? `**相关**：\`${related}\`` : "**相关**：待补（`docs/adr/` / 关联代码路径）";
  return `# ADR-${n}：${title}

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：${today()}
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：${reason}
- ${rel}

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->
<!-- TODO: 问题背景与动机 -->

## 2. 决策（Decision）

<!-- TODO: 方案与理由 -->

## 3. 后果（Consequences）

<!-- TODO: 正面 / 负面 / 已知遗留 -->

## 4. 数据溯源

<!-- TODO: 来源 → 结果 -->

<!-- 文件名: ${slug}.md → 实际文件 architecture/ADR-${n}-${slug}.md（ADR-320 architecture 全量模板） -->
`;
}

function buildDecisionsTemplate(
  parent: number,
  sub: number,
  title: string,
  slug: string,
  related: string,
) {
  const rel = related ? `\n- **相关**：\`${related}\`` : "";
  return `# ADR-${pad(parent)}-d${sub}：${title}

- **状态**：📝 提议中（Proposed）
- **日期**：${today()}
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-${pad(parent)}${rel}

---

## 背景（一句）

<!-- TODO: 主 ADR 的哪个执行切片、当时卡在哪，一句话。 -->

## 决策（三行）

<!-- TODO: 拍板内容 ≤3 行——参数/口径/范围。 -->

## 后果（一句）

<!-- TODO: 影响面/回退方式，没有就写「无」。 -->

<!-- 文件名: ${slug}.md → 实际文件 decisions/ADR-${pad(parent)}-d${sub}-${slug}.md（ADR-320 decisions 轻量模板） -->
`;
}

// ── 登记表占号（分区插入：主编号行进「登记表（新→旧）」，decisions 行进「执行决策日志」节）─

function registerLine(
  regText: string,
  id: string,
  title: string,
  zone: "architecture" | "decisions",
) {
  const newLine = `| ${id} | ${title.replace(/\|/g, "\\|")} | 📝 提议中 | ${today()} |`;
  const lines = regText.split(/\r?\n/);
  const sectionHeader =
    zone === "architecture" ? "## 登记表（新→旧）" : "## 登记表（执行决策日志）";

  // 在目标分节内找最后一行 ADR 表格行；分节缺名时 decisions 追加新节，main 回退全局最后一行
  let sectionStart = lines.findIndex((l) => l.trim() === sectionHeader);
  if (sectionStart === -1) {
    if (zone === "decisions") {
      const block = [
        "",
        "## 登记表（执行决策日志）",
        "",
        "| 编号 | 标题 | 状态 | 日期 |",
        "|------|------|------|------|",
        newLine,
      ].join("\n");
      return `${regText.replace(/\s*$/, "\n")}${block}\n`;
    }
    sectionStart = 0; // main：分节头缺失（人工改造过）→ 全文最后一行兜底
  }

  let lastRow = -1;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s/.test(line.trim())) break; // 进入下一分节
    if (/^\|\s*ADR-\d{3}(-d\d+)?\s*\|/.test(line)) lastRow = i;
  }
  if (lastRow === -1) {
    // 分节存在但暂无数据行（仅有表头）→ 插在分节头之后（gen-docs-index 重写时归位）
    lines.splice(sectionStart + 1, 0, newLine);
    return lines.join("\n");
  }
  lines.splice(lastRow + 1, 0, newLine);
  return lines.join("\n");
}

// ── 被取代标注（AGENTS.md ADR 规则）───────────────────
// 新 ADR（supersedingId）取代既有主编号 ADR：在对方首部状态行下加「被 [ADR-NNN] 取代」。
// 幂等：对方已有「被取代」标注则跳过。三区查找（ADR-320）。

function annotateSuperseded(targetRefs: string[], supersedingId: string) {
  let ok = true;
  const files = listAdrFiles();
  for (const ref of targetRefs) {
    const m = String(ref).match(/(\d{1,3})/);
    if (!m) {
      console.error(`[FAIL] --supersedes 无法解析「${ref}」，需形如 ADR-012 或 012`);
      ok = false;
      continue;
    }
    const tNum = parseInt(m[1]!, 10);
    const target = files.find((f) => f.num === tNum && f.sub === null);
    if (!target) {
      console.error(`[FAIL] 未找到 ADR-${pad(tNum)} 文件（三区均无）`);
      ok = false;
      continue;
    }
    let text = fs.readFileSync(target.absPath, "utf8");
    if (/^-\s*\*\*被取代\*\*/m.test(text)) {
      console.log(`[SKIP] ${target.id} 已有「被取代」标注`);
      continue;
    }
    const statusM = text.match(/^(-\s*\*\*状态\*\*[：:][^\n]*)$/m);
    if (!statusM) {
      console.error(`[FAIL] ${target.id} 缺少状态行，无法插入标注`);
      ok = false;
      continue;
    }
    const idx = statusM.index! + statusM[0].length;
    text = `${text.slice(0, idx)}\n- **被取代**：[${supersedingId}] 取代${text.slice(idx)}`;
    fs.writeFileSync(target.absPath, text, "utf8");
    console.log(`[OK] ${target.id} 首部已标注「被 [${supersedingId}] 取代」`);
  }
  return ok;
}

// ── wx 原子占位锁（硬兜底：防多会话并行撞号）───────────
// 锁文件用 fs.openSync('wx') 原子创建：已存在即 EEXIST（冲突）。
// 锁内完成「读最大号 → 写文件 → 写登记表」整段，杜绝两个进程同时占同一号。
// 陈旧锁（mtime 超过 LOCK_STALE_MS）视为崩溃残留，删除后重试一次。

const LOCK_FILE = path.join(ADR_DIR, ".new-adr.lock");
const LOCK_STALE_MS = 10 * 60 * 1000; // 10 分钟

function acquireLock() {
  try {
    const fd = fs.openSync(LOCK_FILE, "wx");
    fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
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
  // 统一走共享 parseArgs（陷阱 #12 防御同款）：--dry-run 是 bool，其余为带值；
  // title 取位置参数 `_`[0]（共享库把裸参数收进 _，与自带版 positional[0] 等价）
  const parsed = parseArgs(process.argv.slice(2), {
    bools: ["dry-run"],
    strings: ["slug", "related", "supersedes", "tier", "parent", "reason"],
  });
  const args = {
    help: parsed.help,
    unknown: parsed.unknown,
    dryRun: parsed["dry-run"],
    slug: parsed.slug,
    related: parsed.related,
    supersedes: ((parsed.supersedes ?? "") as string)
      .split(/[，,]/)
      .map((s) => s.trim())
      .filter(Boolean), // 与自带版 --supersedes 逗号分隔语义一致
    tier: parsed.tier as string | undefined,
    parent: parsed.parent ? parseInt(String(parsed.parent), 10) : null,
    reason: (parsed.reason ?? "") as string,
    title: parsed._[0] ?? null,
  };

  // --help / -h：输出用法退出，绝不占号（修复 --help 被当标题的误用）
  if (args.help) {
    usage();
    return 0;
  }
  // 未知 flag：拒绝而非当标题占号（防 --foo 类误用）
  if (args.unknown.length) {
    console.error(`[FAIL] 未知参数: ${args.unknown.join(", ")}（--help 查看用法）`);
    usage();
    return 1;
  }

  if (!args.title) {
    usage();
    return 1;
  }

  // ── ADR-320 分级解析（缺省不猜级；--parent/--reason 可隐式定级）──
  let tier = args.tier;
  if (tier && tier !== "architecture" && tier !== "decisions") {
    console.error(`[FAIL] 未知 --tier「${tier}」，仅支持 architecture | decisions`);
    return 1;
  }
  if (!tier) {
    if (args.parent !== null) tier = "decisions";
    else if (args.reason) tier = "architecture";
  }
  if (!tier) {
    console.error(
      '[FAIL] ADR-320 分级必选：架构级 --tier architecture --reason "一句理由"；执行级 --tier decisions --parent NNN',
    );
    usage();
    return 1;
  }
  if (tier === "architecture" && !args.reason.trim()) {
    console.error(
      '[FAIL] 架构级须给 --reason "一句理由"（方向性/难逆转/跨域影响面，ADR-320 准入判据）',
    );
    return 1;
  }
  if (tier === "decisions" && (args.parent === null || Number.isNaN(args.parent))) {
    console.error("[FAIL] 执行级须给 --parent NNN 挂靠主 ADR（产出 ADR-NNN-dN 子编号，ADR-320）");
    return 1;
  }

  const slug = toSlug(args.title, args.slug as string);
  if (!slug) {
    console.error("[FAIL] 标题无 ASCII 字符，无法推导文件名，请用 --slug 显式指定 kebab-case");
    return 1;
  }

  // dry-run：只算号不落盘，无需加锁
  const filesPre = listAdrFiles();
  const maxNumPre = Math.max(maxFromFiles(filesPre), maxFromRegistry());
  if (args.dryRun) {
    if (tier === "architecture") {
      const n = pad(maxNumPre + 1);
      console.log(
        `[占号] 最大主编号 ${pad(maxNumPre)} → 新编号 ADR-${n}（文件 architecture/ADR-${n}-${slug}.md）`,
      );
    } else {
      const sub = nextSubForParent(filesPre, args.parent!);
      console.log(
        `[占号] 挂靠 ADR-${pad(args.parent!)} 现有子编号 ${sub - 1} → 新文件 decisions/ADR-${pad(args.parent!)}-d${sub}-${slug}.md`,
      );
    }
    console.log("[dry-run] 未写入任何文件");
    return 0;
  }

  // 执行级挂靠校验（主 ADR 必须真实存在，三区任一）
  if (tier === "decisions" && !hasMainAdr(filesPre, args.parent!)) {
    console.error(
      `[FAIL] 挂靠主 ADR-${pad(args.parent!)} 不存在（三区均无主编号 ${pad(args.parent!)}）`,
    );
    return 1;
  }

  // 获取 wx 原子锁（硬兜底）。冲突时亮出当前最大号，便于并发 AI 协调。
  if (!acquireLock()) {
    const curMax = Math.max(maxFromFiles(), maxFromRegistry());
    console.error("[锁冲突] 另一并发占号进行中（.new-adr.lock 已存在）");
    console.error(
      `[协调] 当前实际最大主编号为 ADR-${pad(curMax)}；请稍后重试，或先跑 --dry-run 确认最新编号`,
    );
    return 1;
  }

  try {
    // 锁内重读（拿锁后拿最新值）
    const files = listAdrFiles();
    const maxNum = Math.max(maxFromFiles(files), maxFromRegistry());

    let id: string;
    let filename: string;
    let dir: string;
    if (tier === "architecture") {
      const num = maxNum + 1;
      id = adrId(num, null);
      filename = `ADR-${pad(num)}-${slug}.md`;
      dir = ARCHITECTURE_DIR;
    } else {
      const sub = nextSubForParent(files, args.parent!);
      id = adrId(args.parent!, sub);
      filename = `ADR-${pad(args.parent!)}-d${sub}-${slug}.md`;
      dir = DECISIONS_DIR;
    }
    const filePath = path.join(dir, filename);

    console.log(`[占号] → ${id}（文件 ${path.relative(ADR_DIR, filePath)}）`);

    if (fs.existsSync(filePath)) {
      // 撞号：理论上锁已防并发，此处为第二道防线（如人工/脚本直接放了同号文件）。
      const curMax = Math.max(maxFromFiles(), maxFromRegistry());
      console.error(`[撞号] ${path.relative(ROOT, filePath)} 已存在，放弃写入`);
      console.error(
        `[协调] 当前实际最大主编号为 ADR-${pad(curMax)}；请先跑 --dry-run 确认最新编号`,
      );
      return 1;
    }

    // 0. 先读登记表 + 计算插入点（不写盘），写文件失败前不动登记表
    const regText = fs.readFileSync(REG_FILE, "utf8");
    const next = registerLine(regText, id, args.title, tier as "architecture" | "decisions");
    if (next === null) {
      console.error("[FAIL] 登记表插入点计算失败，未写入任何文件");
      return 1;
    }

    // 1. 确保分区目录存在 + 生成模板文件
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      filePath,
      tier === "architecture"
        ? buildArchitectureTemplate(
            maxNum + 1,
            args.title,
            slug,
            args.related as string,
            args.reason.trim(),
          )
        : buildDecisionsTemplate(
            args.parent!,
            nextSubForParent(files, args.parent!),
            args.title,
            slug,
            args.related as string,
          ),
      "utf8",
    );
    console.log(`[OK] 已生成 ${path.relative(ROOT, filePath)}`);

    // 2. 登记表占号（写失败回删已写的 ADR 文件，不留中间态）
    try {
      fs.writeFileSync(REG_FILE, next, "utf8");
    } catch (_err) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* 回删失败则保留文件，交人工处理 */
      }
      console.error(`[FAIL] 登记表写入失败，已回删 ${path.relative(ROOT, filePath)}`);
      return 1;
    }
    console.log("[OK] 已登记占号 adr/index.md");

    // 2.5 被取代标注（仅主编号语义，decisions 无取代链）
    if (args.supersedes.length) {
      if (!annotateSuperseded(args.supersedes, id)) {
        console.error("[FAIL] 被取代标注处理失败，请检查 --supersedes 参数");
        return 1;
      }
      console.log(
        "[提示] 被取代的 ADR 状态如需同步为「❌ 已取代」，请编辑对应文件首部后跑 gen-docs-index.ts",
      );
    }

    // 3. 自动对账
    const res = spawnSync(process.execPath, [path.join("scripts", "adr-check.ts")], {
      cwd: ROOT,
      encoding: "utf8",
    });
    process.stdout.write(res.stdout || "");
    process.stderr.write(res.stderr || "");
    if (res.status !== 0) {
      console.error("[FAIL] adr-check 对账未通过，请检查编号或登记表");
      return 1;
    }
    console.log("[OK] 新 ADR 占号闭环完成。请编辑文件：状态 / 决策人 / 相关 / 正文。");
    return 0;
  } finally {
    releaseLock();
  }
}

process.exit(main());
