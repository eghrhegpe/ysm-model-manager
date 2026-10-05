#!/usr/bin/env node
/**
 * gen-routes-quick.ts — AI 急速版路由表自动生成器（ADR-114 §急速表）。
 *
 * 从知识卡 frontmatter 的 quick_groups / quick_intents / quick_risk_lines / pitfalls
 * 字段生成 docs/knowledge/routes-quick.md，替代手工维护版。
 *
 * 输入（知识卡 frontmatter，全部可选；缺字段视为该卡不参与急速表）:
 *   quick_groups:     场景分组名（值即分组标题；与 quick_intents 循环配对）。
 *                     受控词表 = scripts/_lib/knowledge-cards.ts 的 QUICK_GROUPS——
 *                     词表外组名入「未归类」桶并 WARN，勿在卡里发明野生组名
 *   quick_intents:    用户意图关键词（每行一个，与 quick_groups 循环配对：
 *                     意图多于分组时并入最后分组，分组多于意图时多余分组不输出；
 *                     配对不均恒打 WARN，绝不静默丢弃——2026-08-31 审计修复）
 *   quick_risk_lines: 红线警告（按索引与 quick_intents 配对；缺省则该行红线填 -；
 *                     超出意图条数的行渲染为「通用红线」附加行，不再静默丢弃）。
 *                     面向 AI/人的自然语言，禁写 `file|symbol` 锚语法（那是 invariant_anchors 的语法）
 *   pitfalls:         陷阱列表，格式 "「位置」描述 → 正确做法"（如无前缀则整段作陷阱描述）
 *
 * 输出分组:
 *   - 按 QUICK_GROUPS 受控词表序渲染（2026-10-05 治理：80 野生组收敛 14 组；
 *     词表外组名并入「未归类」桶置尾 + WARN），组内按 quick_intents 排序（稳定）
 *   - pitfalls 独立汇总到「高频陷阱速查」段
 *   - 关联 ADR 取自卡片的 adr: 字段；无则填 -
 *   - 仅处理 status ∈ {active, 缺省} 且带 quick_groups 的卡（2026-10 由 tier: architecture 闸换成
 *     status 闸：原过滤静默挡掉 52 张带 quick_* 的 leaf 卡、反向放行 6 张 draft/snapshot arch 卡；
 *     路由表该管生命周期（活/冻结），不卡入口/细节层级。draft/snapshot/archived/superseded 一律剔除）
 *
 * 用法:
 *   node scripts/gen-routes-quick.ts            # 写入 docs/knowledge/routes-quick.md
 *   node scripts/gen-routes-quick.ts --check    # 只校验不写入，不同则 exit 1（CI 用）
 *   node scripts/gen-routes-quick.ts --json     # JSON 摘要（pre-push-gate runTools 契约，--check 可组合）
 *   node scripts/gen-routes-quick.ts --help     # 用法说明
 *
 * 零依赖（仅 node:fs / node:path）。
 * 退出码: 0 成功, 1 失败。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getList, getScalar, parseFrontmatter } from "./_lib/frontmatter.ts";
import { KNOW_DIR, KNOWLEDGE_NON_CARDS, QUICK_GROUPS } from "./_lib/knowledge-cards.ts";
import { parseArgs } from "./_lib/parse-args.ts";

const OUT_PATH = path.join(KNOW_DIR, "routes-quick.md");
const BANNER =
  "<!-- 本文件由 scripts/gen-routes-quick.ts 自动生成，请勿手改。重跑：node scripts/gen-routes-quick.ts -->";
const END_MARK = "<!--  END_GENERATED_SECTION -->";
/** 词表外组名的收容桶标题（置尾渲染，WARN 提示回填规范组名）。 */
export const UNCLASSIFIED_GROUP = "未归类";
const GROUP_RANK = new Map(QUICK_GROUPS.map((g, i) => [g, i] as const));

function fm(text: string, key: string) {
  return getScalar(parseFrontmatter(text), key);
}
function fmList(text: string, key: string) {
  return getList(parseFrontmatter(text), key);
}
function cell(s: string) {
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

/** 卡片 adr: 字段 → ADR-XXX 字符串；无则 -。 */
function adrLabel(text: string) {
  const adrs = fmList(text, "adr")
    .map((a) => String(a))
    .filter((a) => /ADR-\d+/i.test(a));
  return adrs.length ? adrs.join(", ") : "-";
}

/**
 * 解析单条 pitfalls 记录: "「位置」描述 → 正确做法" → { trap, pos, fix }。
 *
 * export：契约测试 tests/test_gen_routes_quick_pitfall.ts 锁定列切分不变量
 * （该项目此前零测试覆盖，导致两条静默截断缺陷长期存活——见下方注释）。
 */
export function parsePitfall(raw: string) {
  const s = String(raw).trim();
  // 箭头切分（2026-09-13 修复）：优先空格包围的 " → "（常规写法），再兼容「位置」紧跟
  // 箭头的 "」→"（无空格）。旧实现只认前者，`「位置」→ 修复` 这 6 条写法整体落入陷阱列、
  // 「正确做法」列退化为 "-"。切分点只认「」之后或空格包围的箭头，不切入「」内部——
  // `「标签→控件」` 这类位置短语自身含箭头，须整段保留。
  const SPACED = " → ";
  const spaced = s.indexOf(SPACED);
  let leftEnd: number;
  let rightStart: number;
  if (spaced !== -1) {
    leftEnd = spaced;
    rightStart = spaced + SPACED.length; // 跳过整个 " → "
  } else {
    const tight = s.match(/」\s*→\s*/); // 「位置」→ 修复（无空格）
    if (tight) {
      const ti = tight.index ?? 0;
      leftEnd = ti + 1; // 切到 」 之后（left 仍含 」）
      rightStart = ti + tight[0].length;
    } else {
      leftEnd = s.length;
      rightStart = -1;
    }
  }
  const left = s.slice(0, leftEnd).trim();
  const right = rightStart === -1 ? "-" : s.slice(rightStart).trim();
  const bracketPos = left.match(/「(.+?)」/);
  const pos = bracketPos?.[1] ?? left.match(/`(.+?)`/)?.[1];
  // 陷阱列 = left 剥掉「位置」标记后的剩余文本。
  // 仅在 pos 取自 code span 时才剥离首个 inline code——旧实现无条件剥离，当 pos 来自「」时
  // 会把正文首个 code 一并吃掉（全库 9 条 pitfall 实证：陷阱列静默丢内容，如
  // `--new-from-rev` / `Promise.race` / `<span class="label">`）。
  let trap = left
    .replace(bracketPos ? /「[^」]+」/ : /`[^`]+`/, "")
    .replace(/\s+→\s*$/, "")
    .trim();
  if (!trap) trap = pos || "-";
  // pos 可能自身含反引号（卡片 pitfall 用「含 `code` 的短语」）——剥离内层避免嵌套 code span 破列
  return { trap, pos: pos ? `\`${pos.replace(/`/g, "")}\`` : "-", fix: cell(right) };
}

/**
 * 风险行超配提取（纯函数，契约测试锁定）：quick_risk_lines 按索引与 quick_intents 配对，
 * 返回超出意图条数的行。2026-10-05 起 render 把超配行渲染为「通用红线」附加行（挂首分组）
 * 而非丢弃——红线是卡级资产，一条都不该少；旧实现静默丢弃（features-dialogs 7 红线只出
 * 1 条），2026-09-13 曾补 WARN，但 WARN 只让丢失可见、内容仍然丢了，本版根治。
 * 缺红线方向（risks < intents）由渲染兜底填「-」，不丢内容，不算超配。
 */
export function excessRiskLines(risks: string[], intents: string[]): string[] {
  return risks.slice(intents.length);
}

export function render(
  cards: Array<{
    file: string;
    name: string;
    groups: string[];
    intents: string[];
    risks: string[];
    adr: string;
    pitfalls: string[];
  }>,
) {
  const rows: Array<{ group: string; intent: string; risk: string; adr: string; card: any }> = [];
  // 词表外组名收容（2026-10-05 治理）：组名漂移曾把本表拖成 80 组（69 组只挂 1 卡）。
  // 封闭词表 QUICK_GROUPS 之外的名字一律并入「未归类」桶置尾渲染 + 恒 WARN——
  // 让野生组名当场可见，而不是安静地再多长一个分组标题。
  const unknownGroups = new Map<string, Set<string>>();
  // 意图 ↔ 分组循环配对（2026-08-31 审计修复）：
  // 旧实现 Math.min(groups, intents) 仅按索引配对，go-scanner 1 组 5 意图只出 1 行、
  // preview-core 1 组 4 意图只出 1 行——其余意图静默丢弃、零警告（routes-quick 覆盖空转）。
  // 新语义：意图多于分组 → 多余意图并入最后分组（保意图不丢）；分组多于意图 → 多余分组不输出。
  // 两种不均都打 WARN，让 AI/人工立即看到配对异常。
  for (const c of cards) {
    const gLen = c.groups.length;
    const iLen = c.intents.length;
    for (const g of c.groups) {
      if (!GROUP_RANK.has(g)) {
        if (!unknownGroups.has(g)) unknownGroups.set(g, new Set());
        unknownGroups.get(g)!.add(c.file);
      }
    }
    // 降噪（2026-09-03）：单分组多意图（占全库 90/97 张）属正常形态，不再鸣笛；
    // 仅「分组≥2 且意图>分组」（疑似漏写分组名）或「分组>意图」（悬空分组）才 WARN，
    // 让真正的配对异常可见。输出逻辑不变，生成物字节级一致 → CI/doctor 零漂移。
    if (gLen >= 2 && iLen > gLen) {
      console.warn(
        `⚠️  ${c.file}: ${iLen} 条意图 > ${gLen} 个分组，疑似漏写分组名，多余 ${iLen - gLen} 条并入最后分组「${c.groups[gLen - 1]}」`,
      );
    } else if (gLen > iLen) {
      const extra = c.groups.slice(iLen);
      console.warn(
        `⚠️  ${c.file}: ${gLen} 个分组 > ${iLen} 条意图，多余分组不输出（悬空分组）: ${extra.join("、")}`,
      );
    }
    // 超配风险行（2026-10-05 ②）：不再丢弃也不再 WARN——渲染为「通用红线」附加行，
    // 挂首分组（多组卡的超配红线通常是卡级而非意图级，挂首组最不惊讶）。
    const primaryGroup = c.groups[0]!;
    for (const risk of excessRiskLines(c.risks, c.intents)) {
      rows.push({
        group: GROUP_RANK.has(primaryGroup) ? primaryGroup : UNCLASSIFIED_GROUP,
        intent: "通用红线",
        risk,
        adr: c.adr,
        card: c,
      });
    }
    for (let i = 0; i < iLen; i++) {
      const rawGroup = c.groups[Math.min(i, gLen - 1)]!;
      rows.push({
        group: GROUP_RANK.has(rawGroup) ? rawGroup : UNCLASSIFIED_GROUP,
        intent: c.intents[i]!,
        risk: c.risks.length > i ? c.risks[i]! : "-",
        adr: c.adr,
        card: c,
      });
    }
  }
  for (const [g, files] of unknownGroups) {
    console.warn(
      `⚠️  quick_groups 词表外组名「${g}」（卡: ${[...files].sort().join("、")}）→ 已渲染入「${UNCLASSIFIED_GROUP}」桶；规范词表 = scripts/_lib/knowledge-cards.ts 的 QUICK_GROUPS`,
    );
  }
  const pitfalls = cards.flatMap((c) => c.pitfalls.map((p) => parsePitfall(p)));

  // 按 group 值分组：渲染序 = QUICK_GROUPS 词表序（高频域在前），词表外（未归类桶）置尾；
  // 同秩（理论上是桶内同名）按名稳定排序。组内按 intent 排序。
  const groupMap = new Map();
  for (const r of rows) {
    if (!groupMap.has(r.group)) groupMap.set(r.group, []);
    groupMap.get(r.group).push(r);
  }
  const groupOrder = [...groupMap.keys()].sort((a: string, b: string) => {
    const ra = GROUP_RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = GROUP_RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, "zh-CN");
  });
  for (const g of groupOrder) {
    groupMap.get(g).sort((a: any, b: any) => a.intent.localeCompare(b.intent, "zh-CN"));
  }

  const out: string[] = [];
  out.push(BANNER, "", "# AI 急速版路由表（高频场景）", "");
  out.push("> 本表由知识卡 frontmatter 的 `quick_*` 字段自动生成。");
  out.push(
    "> 新增高频场景请在对应知识卡 frontmatter 补充 `quick_groups`/`quick_intents`/`quick_risk_lines`/`pitfalls`；组名必须取自受控词表（scripts/_lib/knowledge-cards.ts 的 QUICK_GROUPS），词表外组名落入「未归类」。",
  );
  out.push("");

  for (const g of groupOrder) {
    const rs = groupMap.get(g);
    out.push(
      `## 🎯 ${g}`,
      "",
      "| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |",
      "|----------|--------|----------|----------|",
    );
    for (const r of rs) {
      const primary = `[${cell(r.card.name)}](./${r.card.file})`;
      const risk = r.risk === "-" ? "-" : cell(r.risk);
      out.push(`| ${cell(r.intent)} | ${primary} | ${risk} | ${cell(r.adr)} |`);
    }
    out.push("");
  }

  if (pitfalls.length) {
    out.push("## 🚨 高频陷阱速查", "", "| 陷阱 | 位置 | 正确做法 |", "|------|------|----------|");
    for (const p of pitfalls) out.push(`| ${cell(p.trap)} | ${cell(p.pos)} | ${p.fix} |`);
    out.push("");
  }

  out.push("---", END_MARK);
  return `${out.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2), {
    bools: ["check", "json"],
    strings: [],
    defaults: {},
  });
  const JSON_OUT = args.json;
  if (args.help) {
    const src = fs.readFileSync(process.argv[1]!, "utf-8");
    const s = src.indexOf("/**"),
      e = src.indexOf("*/", s);
    console.log(
      src
        .slice(s, e + 2)
        .replace(/^ \* ?/gm, "")
        .trim(),
    );
    process.exit(0);
  }
  if (args.unknown.length) {
    console.error(`❌ 未知参数: ${args.unknown.join(", ")}（--help 查看用法）`);
    process.exit(1);
  }
  if (!fs.existsSync(KNOW_DIR)) {
    console.error("❌ docs/knowledge/ 不存在，请确认在仓库根目录运行");
    process.exit(1);
  }

  const cards: Array<{
    file: string;
    name: string;
    groups: string[];
    intents: string[];
    risks: string[];
    adr: string;
    pitfalls: string[];
  }> = [];
  for (const f of fs.readdirSync(KNOW_DIR).filter((f) => f.endsWith(".md"))) {
    if (KNOWLEDGE_NON_CARDS.has(f)) continue;
    const text = fs.readFileSync(path.join(KNOW_DIR, f), "utf8");
    if (!parseFrontmatter(text)) continue;
    // status 闸（替换原 tier: architecture 闸，理由见 JSDoc「输出分组」）：
    // 只收 active（缺 status 字段缺省 active）卡——draft/snapshot/archived/superseded 是冻结/草稿
    // 生命周期，不进 AI 路由表；tier 不再参与过滤（leaf 卡带 quick_* 同样可达）
    const status = fm(text, "status") || "active";
    if (status !== "active") continue;
    const groups = fmList(text, "quick_groups");
    if (!groups.length) continue;
    cards.push({
      file: f,
      name: fm(text, "name") || f.replace(/\.md$/, ""),
      groups,
      intents: fmList(text, "quick_intents"),
      risks: fmList(text, "quick_risk_lines"),
      adr: adrLabel(text),
      pitfalls: fmList(text, "pitfalls"),
    });
  }
  cards.sort((a, b) => a.file.localeCompare(b.file));

  const output = render(cards);
  const total = cards.reduce((s, c) => s + c.intents.length, 0);
  const pitCount = cards.reduce((s, c) => s + c.pitfalls.length, 0);
  console.error(`📄 ${cards.length} 张卡带 quick_groups，${total} 条高频意图，${pitCount} 条陷阱`);

  const summary = (ok: boolean, check: boolean, generated: boolean) =>
    JSON.stringify({
      ok,
      check,
      generated,
      count: total,
      intents: total,
      pitfalls: pitCount,
      cards: cards.map((c) => c.file),
    });

  if (args.check) {
    const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf8") : "";
    const synced = existing === output;
    if (JSON_OUT) {
      console.log(summary(synced, true, false));
    } else if (synced) {
      console.log(`✅ ${OUT_PATH} 已同步`);
    } else {
      console.error(`❌ ${OUT_PATH} 未同步，请运行: node scripts/gen-routes-quick.ts`);
    }
    process.exit(synced ? 0 : 1);
  }

  const tmp = `${OUT_PATH}.tmp`;
  fs.writeFileSync(tmp, output);
  fs.renameSync(tmp, OUT_PATH);
  if (JSON_OUT) {
    console.log(summary(true, false, true));
  } else {
    console.log(`✅ 已写入 ${path.relative(process.cwd(), OUT_PATH)}`);
  }
}

// CLI 守卫（2026-09-13）：对齐 check-complexity 惯例。本模块此前裸调用 main()，
// 导致任何 import（如契约测试引入 parsePitfall）都会触发写盘生成。
const isCli = (() => {
  const arg0 = process.argv[1];
  if (!arg0) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(arg0);
})();
if (isCli) main();
