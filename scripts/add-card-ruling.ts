#!/usr/bin/env node
/**
 * add-card-ruling.ts — 把「单点执行裁定」追加为知识卡的「裁定记录」条目（第三刀：ADR 增量门槛）。
 *
 * 配套 new-adr.ts 的准入三问门：--tier decisions 三问全否时，本裁定不立 ADR，改走本工具
 * 写入所属知识卡正文的「## 裁定记录」小节，一行一条。
 *
 * 格式（每条一行，锚点走 ADR-162「文件|符号」，禁行号/计数）：
 *   - `YYYY-MM-DD`：一句决策｜理由一句｜回退 = `文件|符号`
 *
 * 用法：
 *   node scripts/add-card-ruling.ts <kind> --decision "..." --why "..." --revert "文件|符号" [--date YYYY-MM-DD]
 *
 *   <kind>   知识卡文件名 kebab-case（不含 .md），须真实存在于 docs/knowledge/
 *   --decision 一句决策（必填）
 *   --why      一句理由（必填）
 *   --revert   回退锚点，形如 `文件|符号` 或 `文件`（必填，ADR-162 格式校验）
 *   --date     日期（缺省今天）
 *   --dry-run  只打印将写入的行与落点，不改文件
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 * 设计意图：把 ADR 增量门槛的降格出口变成一条命令
 * 退出码：1（校验失败或找不到卡）
 */
import fs from "node:fs";
import path from "node:path";
import { KNOW_DIR } from "./_lib/knowledge-cards.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT } from "./_lib/scan-files.ts";

const ANCHOR_RE = /^[^\s|]+(\|[^\s|]+)?$/; // 「文件|符号」或「文件」
const LINE_NUM_RE = /:\s*\d/; // ADR-162 禁「文件:行号」——锚点不得含行坐标

function usage() {
  console.error(
    '用法: node scripts/add-card-ruling.ts <kind> --decision "..." --why "..." --revert "文件|符号" [--date YYYY-MM-DD] [--dry-run]\n' +
      "  <kind>     知识卡文件名 kebab-case（不含 .md）\n" +
      "  --decision 一句决策（必填）\n" +
      "  --why      一句理由（必填）\n" +
      "  --revert   回退锚点 `文件|符号` 或 `文件`（必填，ADR-162 格式）\n" +
      "  --date     日期（缺省今天 YYYY-MM-DD）\n" +
      "  --dry-run  只打印结果不写文件",
  );
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 定位正文起点（frontmatter 结束行后的第一个非空行索引）；无 frontmatter 返回 0。 */
function bodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i]?.trim() === "---") return i + 1;
  return 0;
}

/** 生成裁定条目一行。 */
function buildLine(date: string, decision: string, why: string, revert: string): string {
  return `- \`${date}\`：${decision}｜${why}｜回退 = \`${revert}\``;
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2), {
    bools: ["dry-run"],
    strings: ["decision", "why", "revert", "date"],
  });
  if (parsed.help) {
    usage();
    return 0;
  }
  if (parsed.unknown.length) {
    console.error(`[FAIL] 未知参数: ${parsed.unknown.join(", ")}`);
    usage();
    return 1;
  }
  const kind = parsed._[0] ?? null;
  const decision = ((parsed.decision ?? "") as string).trim();
  const why = ((parsed.why ?? "") as string).trim();
  const revert = ((parsed.revert ?? "") as string).trim();
  const date = ((parsed.date ?? "") as string).trim() || today();

  if (!kind) {
    console.error("[FAIL] 缺 <kind>（知识卡文件名 kebab-case）");
    usage();
    return 1;
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(kind)) {
    console.error(`[FAIL] <kind>「${kind}」非法，须 kebab-case（小写字母/数字/-/_）`);
    return 1;
  }
  if (!decision || !why) {
    console.error("[FAIL] --decision 与 --why 必填（各一句）");
    return 1;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`[FAIL] --date 格式须 YYYY-MM-DD（实际「${date}」）`);
    return 1;
  }
  if (!ANCHOR_RE.test(revert) || LINE_NUM_RE.test(revert)) {
    console.error(
      `[FAIL] --revert 锚点格式非法：应「文件|符号」或「文件」（ADR-162，禁「文件:行号」行坐标）: ${revert}`,
    );
    return 1;
  }

  const file = path.join(KNOW_DIR, `${kind}.md`);
  if (!fs.existsSync(file)) {
    console.error(
      `[FAIL] 知识卡不存在: ${path.relative(ROOT, file)}（<kind> 须 docs/knowledge/ 下真实卡名）`,
    );
    return 1;
  }
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  const line = buildLine(date, decision, why, revert);

  // 幂等：完全相同的条目已存在则跳过
  if (lines.includes(line)) {
    console.log(`[SKIP] ${kind} 已有同条裁定记录（幂等）`);
    return 0;
  }

  const start = bodyStart(lines);
  const head = lines.slice(0, start);
  const body = lines.slice(start);
  const headerIdx = body.findIndex((l) => l.trim() === "## 裁定记录");
  let result: string[];
  if (headerIdx !== -1) {
    // 已有「裁定记录」节：追加到该节最后一条 bullet 之后
    let last = headerIdx;
    for (let i = headerIdx + 1; i < body.length; i++) {
      if (/^##\s/.test(body[i]!.trim())) break;
      if (/^\s*-/.test(body[i]!)) last = i;
    }
    body.splice(last + 1, 0, line);
    result = head.concat(body);
  } else {
    // 新建「裁定记录」节：插到「## 相关」之前（无相关则追加到文末）
    const section = ["", "## 裁定记录", "", line, ""];
    const relIdx = body.findIndex((l) => l.trim() === "## 相关");
    if (relIdx !== -1) body.splice(relIdx, 0, ...section);
    else body.push(...section);
    result = head.concat(body);
  }

  const out = result.join("\n");
  if (parsed["dry-run"]) {
    console.log(`[dry-run] 将写入 ${kind}「裁定记录」：`);
    console.log(`  ${line}`);
    console.log("  未写文件");
    return 0;
  }
  fs.writeFileSync(file, out, "utf8");
  console.log(`[OK] 已写入 ${path.relative(ROOT, file)}「裁定记录」`);
  console.log(`  ${line}`);
  return 0;
}

process.exit(main());
