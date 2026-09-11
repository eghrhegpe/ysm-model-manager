#!/usr/bin/env node
/**
 * check-complexity.ts — 前端函数复杂度扫描（认知复杂度 + 嵌套深度）。
 *
 * 设计意图：与 line-counter（函数行数）互补的「复杂度维」巡检——line-counter 回答
 * 「多长」，本工具回答「多绕」。一个 120 行 8 层嵌套的 if/switch 迷宫远比同长度
 * 线性代码难维护；行数看不出这点。测量「可否维护」里复杂度这一维，供拆解立项。
 *
 * 指标（Sonar Cognitive Complexity 语义，简化版）：
 *   1. 认知复杂度：控制流结构每命中一次 +1，且该结构若处于嵌套层级深度 d 则额外 +d
 *      （d 为外围 if/loop/switch/catch 层数）——扁平行代码得分低、深嵌套得分高。
 *      计分结构：if、for/while/do/for-in/for-of、switch、catch（均为嵌套型）；
 *      else、case、逻辑运算符 &&/||/??（每个一次）、三元 ?:（均为即时型，不增层）。
 *   2. 嵌套深度：整个函数最大控制流嵌套层数。
 *
 * 实现：核心规约器 `cognitiveFromSeq` 是零依赖纯函数（输入 = 结构事件序列，输出
 * { cognitive, maxNesting }），契约测试直接喂事件序列锁死算法；ts-morph 薄层
 * `fnBodyToEvents` 只把 AST 节点翻译成事件流（nest → 进嵌套、flat → 即时计分），
 * 不含任何复杂度语义，双端漂移风险收敛到「事件翻译」这一处。
 *
 * 依赖：运行时惰性 load ts-morph（frontend/node_modules）；无 ts-morph 时跳过扫描
 * 以 WARN 退出 0（情报型，不阻断；与 line-counter 一致）。
 *
 * 用法：
 *   node scripts/check-complexity.ts                                    # 全前端默认黄>15
 *   node scripts/check-complexity.ts --scope frontend/src/preview-3d    # 按域收窄
 *   node scripts/check-complexity.ts --threshold 20                     # 自定义黄档（橙=2x红=3x）
 *   node scripts/check-complexity.ts --json                             # JSON（子代理/CI 消费）
 *
 * 退出码：0（情报型）；ts-morph 缺失 0 WARN；初始化失败 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { getRoot, relPosix } from "./_lib/scan-files.ts";

const ROOT = getRoot();

// ─── 参数解析 ─────────────────────────────────────────────
const raw = parseArgs(process.argv.slice(2), {
  bools: ["json"],
  strings: ["scope", "threshold"],
  defaults: { threshold: 15 }, // 🟨>15，🟧=2x，🟥=3x
});
if (raw.unknown?.length) {
  console.error(`❌ 未知参数: ${raw.unknown.join(", ")}（--help 查看用法）`);
  process.exit(1);
}
if (raw.threshold !== null) {
  const n = parseInt(raw.threshold as string, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`[check-complexity] --threshold 需正整数，收到 ${raw.threshold}，用默认 15`);
    raw.threshold = 15;
  } else {
    raw.threshold = n;
  }
}
const args = {
  json: raw.json as boolean,
  scope: (typeof raw.scope === "string" ? raw.scope : null) ?? "frontend/src",
  threshold: raw.threshold as number,
};

// ─── 核心规约器（纯函数，零依赖，契约测试直接消费）────────────
// 事件类型：
//   { k:"nest", kind }                 -> 进嵌套：计 +1+depth，depth++
//   { k:"nestClose" }                  -> depth--
//   { k:"flat", kind }                 -> 即时计分 +1+depth，不增层；但 children 仍需平铺

export type CxEvent =
  | { k: "nest"; kind: "if" | "loop" | "switch" | "catch" }
  | { k: "nestClose" }
  | { k: "flat"; kind: "else" | "case" | "logic" | "ternary" };

/** 从事件序列规约出认知复杂度 + 最大嵌套深度。 */
export function cognitiveFromSeq(seq: CxEvent[]): { cognitive: number; maxNesting: number } {
  let cognitive = 0;
  let depth = 0;
  let maxNesting = 0;
  for (const ev of seq) {
    if (ev.k === "nest") {
      cognitive += 1 + depth;
      depth++;
      if (depth > maxNesting) maxNesting = depth;
    } else if (ev.k === "nestClose") {
      depth = Math.max(0, depth - 1);
    } else {
      cognitive += 1 + depth;
    }
  }
  return { cognitive, maxNesting };
}

// ─── ts-morph 事件发射层（只翻译 AST，不含复杂度语义）─────────

function nestKindOf(kindName: string): "if" | "loop" | "switch" | "catch" | null {
  if (kindName === "IfStatement") return "if";
  if (kindName === "SwitchStatement") return "switch";
  if (kindName === "CatchClause") return "catch";
  if (
    kindName === "ForStatement" ||
    kindName === "ForInStatement" ||
    kindName === "ForOfStatement" ||
    kindName === "WhileStatement" ||
    kindName === "DoStatement"
  )
    return "loop";
  return null;
}

function flatKindOf(kindName: string): CxEvent | null {
  if (kindName === "ElseClause") return { k: "flat", kind: "else" };
  if (kindName === "CaseClause") return { k: "flat", kind: "case" };
  if (kindName === "LogicalExpression") return { k: "flat", kind: "logic" };
  if (kindName === "ConditionalExpression") return { k: "flat", kind: "ternary" };
  return null;
}

/** ts-morph 函数体节点 → 事件序列。 */
export function fnBodyToEvents(fnNode: unknown): CxEvent[] {
  const getBody = (fnNode as any)?.getBody;
  if (typeof getBody !== "function") return [];
  const body = getBody.call(fnNode);
  if (!body) return [];
  const seq: CxEvent[] = [];
  emitFromNode(body, seq, 200);
  return seq;
}

function emitFromNode(node: any, seq: CxEvent[], guard: number): void {
  if (guard <= 0 || !node) return;
  const kindName = typeof node.getKindName === "function" ? node.getKindName() : "";
  const nestKind = nestKindOf(kindName);
  if (nestKind) {
    seq.push({ k: "nest", kind: nestKind });
    for (const child of node.getChildren?.() ?? []) emitFromNode(child, seq, guard - 1);
    seq.push({ k: "nestClose" });
    return;
  }
  const flat = flatKindOf(kindName);
  if (flat) seq.push(flat);
  for (const child of node.getChildren?.() ?? []) emitFromNode(child, seq, guard - 1);
}

// ─── 顶层声明提取（函数 / 箭头 / 类方法）──────────────────
/** 返回包含节点行号的命名函数/方法/箭头函数集合。check-params 等复用同一收集口径。 */
export function collectNamedFunctions(
  sf: any,
): Array<{ node: any; name: string; kind: string; line: number }> {
  const out: Array<{ node: any; name: string; kind: string; line: number }> = [];
  const getLine = (n: any) =>
    typeof n.getStartLineNumber === "function" ? n.getStartLineNumber() : 0;
  try {
    for (const fn of sf.getFunctions?.() ?? []) {
      const n = fn.getName?.();
      if (n) out.push({ node: fn, name: n, kind: "function", line: getLine(fn) });
    }
    for (const arr of sf.getVariableDeclarations?.() ?? []) {
      const init = arr.getInitializer?.();
      if (init && init.getKindName?.() === "ArrowFunction") {
        const n = arr.getName?.();
        if (n) out.push({ node: init, name: n, kind: "arrow", line: getLine(arr) });
      }
    }
    for (const cls of sf.getClasses?.() ?? []) {
      for (const method of cls.getMethods?.() ?? []) {
        const n = method.getName?.();
        if (n) out.push({ node: method, name: n, kind: "method", line: getLine(method) });
      }
    }
  } catch {
    /* 个别畸形节点跳过 */
  }
  return out;
}

// ─── 三档分级 ────────────────────────────────────────────
function tierOf(cognitive: number, yellow: number): string | null {
  if (cognitive > yellow * 3) return "red";
  if (cognitive > yellow * 2) return "orange";
  if (cognitive > yellow) return "yellow";
  return null;
}

// ── walk 同步版（复用 scan-files，但顶层只 import 纯函数）──
function walkSource(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name.startsWith(".") ||
        entry.name === "dist" ||
        entry.name === "vendor"
      )
        continue;
      out.push(...walkSource(full));
    } else if (entry.isFile()) {
      if (/\.(ts|js)$/.test(entry.name) && !/\.(test|spec)\.[jt]s$/.test(entry.name))
        out.push(full);
    }
  }
  return out;
}

// ─── 主流程 ─────────────────────────────────────────────
async function main() {
  const yellow = args.threshold;

  // 惰性加载 ts-morph（情报型：缺依赖不硬失败）。经 createRequire 从 frontend 解析——
  // scripts/ 是 ESM，无法直接 require；且 ts-morph 挂在 frontend/node_modules 依赖树上。
  const { createRequire } = await import("node:module");
  const require_ = createRequire(path.join(ROOT, "frontend", "package.json"));
  let Project: any = null;
  try {
    ({ Project } = require_("ts-morph"));
  } catch {
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            degraded: true,
            mode: "complexity",
            _summary: { skippedDueToNoTsMorph: true },
            items: [],
          },
          null,
          2,
        ),
      );
    } else {
      console.warn("[check-complexity] 未找到 ts-morph（frontend/node_modules 缺失），跳过扫描。");
      console.warn("   (cd frontend && npm install) 后重试。");
    }
    return;
  }

  const rootAbs = path.isAbsolute(args.scope) ? args.scope : path.join(ROOT, args.scope);
  if (!fs.existsSync(rootAbs)) {
    const msg = `--scope 目录不存在：${args.scope}`;
    if (args.json)
      console.log(JSON.stringify({ ok: false, mode: "complexity", error: msg }, null, 2));
    else console.error(msg);
    return;
  }

  const files = walkSource(rootAbs).map((f) => path.resolve(f));
  if (files.length === 0) {
    const msg = `--scope 下无 .ts/.js 文件：${args.scope}`;
    if (args.json)
      console.log(JSON.stringify({ ok: false, mode: "complexity", error: msg }, null, 2));
    else console.error(msg);
    return;
  }

  // 逐文件解析（不经 tsconfig include，只加目标文件，别名不影响复杂度统计）
  const project = new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true });
  const items: Array<{
    file: string;
    name: string;
    kind: string;
    line: number;
    cognitive: number;
    maxNesting: number;
    tier: string;
  }> = [];
  let totalFuncs = 0;
  let skippedNoControlFlow = 0;
  const parseFailures: string[] = [];

  for (const f of files) {
    let sf: any;
    try {
      sf = project.addSourceFileAtPath(f);
    } catch (e: any) {
      parseFailures.push(`${relPosix(f)}: ${e?.message ?? e}`);
      continue;
    }
    const rel = relPosix(f);
    for (const c of collectNamedFunctions(sf)) {
      const seq = fnBodyToEvents(c.node);
      if (seq.length === 0) {
        skippedNoControlFlow++;
        continue;
      }
      totalFuncs++;
      const { cognitive, maxNesting } = cognitiveFromSeq(seq);
      const t = tierOf(cognitive, yellow);
      if (!t) continue;
      items.push({
        file: rel,
        name: c.name,
        kind: c.kind,
        line: c.line,
        cognitive,
        maxNesting,
        tier: t,
      });
    }
  }

  const TIER_ORDER: Record<string, number> = { red: 0, orange: 1, yellow: 2 };
  items.sort(
    (a, b) =>
      TIER_ORDER[a.tier]! - TIER_ORDER[b.tier]! ||
      b.cognitive - a.cognitive ||
      b.maxNesting - a.maxNesting,
  );

  const counts = {
    red: items.filter((i) => i.tier === "red").length,
    orange: items.filter((i) => i.tier === "orange").length,
    yellow: items.filter((i) => i.tier === "yellow").length,
  };

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "complexity",
          _summary: {
            scannedFuncs: totalFuncs,
            skippedNoControlFlow,
            parseFailures: parseFailures.length,
            thresholds: { yellow, orange: yellow * 2, red: yellow * 3 },
            counts,
          },
          items,
          parseFailures: parseFailures.slice(0, 10),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`=== 函数复杂度扫描（黄>${yellow} / 橙>${yellow * 2} / 红>${yellow * 3}）===`);
  console.log(
    `函数 ${totalFuncs} 个；无控制流跳过 ${skippedNoControlFlow} 个；解析失败 ${parseFailures.length} 个`,
  );
  console.log(
    `命中：🟥 ${counts.red} · 🟧 ${counts.orange} · 🟨 ${counts.yellow} · 合计 ${items.length}`,
  );
  if (items.length === 0) {
    console.log("（干净，无命中）");
    return;
  }
  let curTier: string | null = null;
  for (const it of items) {
    if (curTier !== it.tier) {
      curTier = it.tier;
      console.log(
        `── ${curTier === "red" ? "🟥 RED" : curTier === "orange" ? "🟧 ORANGE" : "🟨 YELLOW"} ──`,
      );
    }
    console.log(
      `  ${it.tier === "red" ? "🟥" : it.tier === "orange" ? "🟧" : "🟨"} ${it.file}:${it.line}  ${it.name} <${it.kind}>  认知${it.cognitive} 嵌套${it.maxNesting}`,
    );
  }
}

// 仅脚本作为 CLI 被直接执行时才跑主流程；被导入（契约测试）时不触发副效应。
const isCli = (() => {
  const arg0 = process.argv[1];
  if (!arg0) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(arg0);
})();
if (isCli) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((e: any) => {
    console.error(`[check-complexity] 执行失败: ${e?.message ?? e}`);
    process.exit(1);
  });
}
