#!/usr/bin/env node
/**
 * audit-complexity-cross.ts — 「行数 × 认知」交叉巡检（情报型，不挂门禁）。
 *
 * 立因：`line-counter` 回答「多长」，`check-complexity` 回答「多绕」。两者分开跑，
 * 交叉盲区=「**行数大但认知绿**」的函数——通常是**声明式配置瀑布**（深度恒 0，
 * depth 加权 0），认知低合理；也可能是**命令式流程**（顺序逻辑、无深嵌套）——
 * 这类「单函数做太多事」在复杂度指标里是绿的，但按单一职责原则仍该拆。
 *
 * 本脚本做三件事：
 *   1. 交叉：报「行数 tier 红/橙 且 认知绿（≤15）」的前端函数（排除 class 与 vendor）。
 *   2. 标出函数「本质」线索（由 `--kind-hint` 提示，非自动判定）——声明式配置通常
 *      以 `return [` / 大量对象字面量开始，命令式流程通常以 try/for/循环体开始。
 *   3. 输出：友好表格（默认）+ --json（子代理/CI 消费）。
 *
 * 指标口径（复现两工具，勿在本文重复定义）：
 *   - line-counter：黄>30 / 橙>60 / 红>90（函数行数）
 *   - check-complexity：黄>15 / 橙>30 / 红>45（Sonar 认知复杂度简化版）
 *
 * 用法：
 *   node scripts/audit-complexity-cross.ts                          # 全前端交叉
 *   node scripts/audit-complexity-cross.ts --json                   # JSON
 *   node scripts/audit-complexity-cross.ts --scope preview-3d      # 按域收窄
 *   node scripts/audit-complexity-cross.ts --min-lines 60          # 行数阈值（默认 90）
 *
 * 退出码：0（情报型，命中与否均 0）；工具调用失败 1。
 *
 * 免责：**不做自动判定**「该拆/不该拆」——声明式瀑布拆成「每节点一函数」反而分散，
 * 该决策留给治理方人工判断。本脚本只把盲区候选**摆上台面**。
 *
 * 依赖:node:child_process / node:fs / ./_lib/(parse-args.ts、scan-files.ts)（零外部包，
 * 复用仓内既有的行数与复杂度口径实现，不引第三方）。
 * 设计意图:补 line-counter 与 check-complexity 两工具的交叉盲区——「行数红但认知绿」
 *   的函数前者照单全收、后者判绿，这类单函数承担过多职责的债正落在两者之间；
 *   情报型不挂门禁，故退出码恒 0，命中与否交人判而非机器拦。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "./_lib/parse-args.ts";
import { getRoot } from "./_lib/scan-files.ts";

const ROOT = getRoot();

/** line-counter 函数级 kind（排除 class：line-counter 按顶层符号计，class 整体≠函数） */
const FN_KINDS = new Set(["func", "method", "arrow", "type"]);

/** line-counter 行数红/橙阈值（与 line-counter 分级一致；红>90、橙>60） */
const LINES_RED = 90;
const LINES_ORANGE = 60;

/** 认知绿阈值（check-complexity 黄>15，故 ≤15 为绿） */
const CX_GREEN_MAX = 15;

/** vendor 目录：与 check-complexity `VENDORED_DIRS` 同口径（非本仓代码不计债） */
const VENDORED_MARK = "/vendor/";
const MOLANG_LIB = "/molang-lib/";

interface CrossItem {
  file: string;
  name: string;
  lines: number;
  lineTier: string;
  kind: string;
  cxGreen: boolean;
  startLine: number;
  kindHint: string;
}

/** 跑一个 CLI 脚本并返回解析后的 JSON（失败抛错由 main 收口） */
function runJson(script: string, extraArgs: string[] = ["--json"]): unknown {
  const out = execFileSync(process.execPath, [script, ...extraArgs], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

/** 判定函数本质线索（启发式，非严格）：读函数开头 35 行粗判声明式/命令式 */
function kindHintOf(file: string, startLine: number): string {
  let head = "";
  try {
    const raw = readFileSync(`${ROOT}/${file}`, "utf8");
    head = raw.split("\n").slice(startLine - 1, startLine + 34).join("\n").toLowerCase();
  } catch {
    return "未知（读文件失败）";
  }
  const isDecl = /return\s*\[|=>\s*\(\{|=>\s*\{|push\(|: \{|: \[/.test(head);
  const isCmd = /\btry\s*\{|\bfor\s*\(|\bif\s*\(/.test(head);
  if (isDecl && !isCmd) return "声明式配置";
  if (isCmd && !isDecl) return "命令式流程";
  return "混合";
}

/** 交叉分析：返回候选清单（行数红/橙 且 认知绿）；scope 默认 frontend/src（子串匹配，Go 文件天然被排） */
function crossAnalyze(scope: string, minLines: number): CrossItem[] {
  const lcJson = runJson("scripts/line-counter.ts", ["--funcs", "--json"]) as {
    items?: Array<{ file: string; name: string; kind: string; startLine: number; lines: number; tier: string }>;
  };
  const cxJson = runJson("scripts/check-complexity.ts") as {
    items?: Array<{ file: string; name: string }>;
  };

  // 认知黄+ 排除集（不在该集 = 认知绿）
  const cxWarned = new Set<string>();
  for (const i of cxJson.items ?? []) cxWarned.add(`${i.file}|${i.name}`);

  const out: CrossItem[] = [];
  for (const lc of lcJson.items ?? []) {
    if (!FN_KINDS.has(lc.kind)) continue;
    if (lc.file.includes(VENDORED_MARK) || lc.file.includes(MOLANG_LIB)) continue;
    if (!lc.file.includes(scope)) continue;
    if (lc.lines < minLines) continue;
    if (lc.tier !== "red" && lc.tier !== "orange") continue;
    const key = `${lc.file}|${lc.name}`;
    if (cxWarned.has(key)) continue; // 认知黄+ 已可见，非盲区
    out.push({
      file: lc.file,
      name: lc.name,
      lines: lc.lines,
      lineTier: lc.tier,
      kind: lc.kind,
      cxGreen: true,
      startLine: lc.startLine,
      kindHint: kindHintOf(lc.file, lc.startLine),
    });
  }
  return out.sort((a, b) => b.lines - a.lines);
}

function main(): number {
  const args = parseArgs(process.argv.slice(2), {
    bools: ["json"],
    strings: ["scope", "min-lines"],
    defaults: {},
  });
  if (args.unknown?.length) {
    console.error(`[audit-complexity-cross] 未知参数: ${args.unknown.join(", ")}`);
    console.error("用法: node scripts/audit-complexity-cross.ts [--scope <域>] [--min-lines N] [--json]");
    return 1;
  }
  const scope = typeof args.scope === "string" && args.scope ? args.scope : "frontend/src";
  const minLines = (() => {
    const v = parseInt(String(args["min-lines"] ?? "90"), 10);
    return Number.isFinite(v) && v >= 1 ? v : 90;
  })();

  let items: CrossItem[];
  try {
    items = crossAnalyze(scope, minLines);
  } catch (e) {
    console.error(
      `[audit-complexity-cross] 工具调用失败: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "complexity-cross",
          summary: {
            scope,
            minLines,
            candidates: items.length,
          },
          items,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`行数×认知 交叉巡检（行数 ≥${minLines} 且认知 ≤${CX_GREEN_MAX}）`);
  console.log(`作用域: ${scope}｜候选: ${items.length} 个\n`);
  if (items.length === 0) {
    console.log("（无候选——该域内不存在「行数大但认知绿」的函数级盲区）");
    return 0;
  }
  console.log(
    `${"行数".padStart(4)}  ${"函数".padEnd(28)} ${"文件".padEnd(36)} ${"本质".padEnd(12)} 行数档`,
  );
  console.log("-".repeat(96));
  for (const it of items) {
    const rel = it.file.replace("frontend/src/", "");
    console.log(
      `${String(it.lines).padStart(4)}  ${it.name.padEnd(28)} ${rel.padEnd(36)} ${it.kindHint.padEnd(12)} ${it.lineTier}`,
    );
  }
  console.log("\n（声明式配置通常不该拆——拆成每节点一函数反而分散；");
  console.log("  命令式流程值得人工评估单一职责。本脚本只摆事实，不替决策。）");
  return 0;
}

process.exit(main());