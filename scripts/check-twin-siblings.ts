#!/usr/bin/env node
/**
 * check-twin-siblings.ts — 改动范围同构同胞提醒探针（P2② 补网，2026-10-05）。
 *
 * 依赖声明：零依赖（node:child_process / node:path / node:url + _lib/parse-args / _lib/scan-files）。
 *
 * 设计意图（元失败审计 §7.4「对孪生不对称的盲区」；3d-patterns §7.4 对策①②）：
 *   一次审计的四例同源自盲（a11y 协议换代未调和旧 dispose、恒真测试断言、catch-all 吞未枚举
 *   值、VRM boneCount 只修自己新增行）同根因：「修复/特性提交只看自己的 diff，不问同构同胞在哪」。
 *   check-redlines 的「广度扫描 + 误报压制」范式对此**结构性失明**——本探针补盲区：
 *   把本次改动的「新增语义行」归一化成结构指纹（字符串字面量→Q、数字字面量→N、空白折叠，
 *   标识符/运算符保留），在**未变更区**检索同类同胞行：
 *   - 未变更源文件：当前内容；
 *   - 变更文件：HEAD 版本（git show HEAD:<file>——变更前的状态全然是「未变更行」）；
 *     新文件（无 HEAD 版本）不入目标集，仅从当前全文抽指纹（全行皆新增）；
 *   - 测试文件 / bindings / 生成物（dist、public、completions）/ upstream 参照 / scripts/tests 池
 *     不扫（设计如此——同胞提醒面向生产源码）。
 *   指纹命中 ≥2 条未变更区同胞行才出 W7 候选清单（候选清单不是结论：同构 ≠ 需要改，
 *   人工判断同胞是否需要同步调整；纯提醒，误报的代价 = 看一眼）。
 *
 * 输出契约（commit-check.ts 第 4 步读 _summary.warns）：
 *   { "_summary": { issues: 0, warns: <候选指纹数>, skipped?: true }, warns: [{ shape, origin, total, hits }] }
 *
 * 退出码：恒 0（纯 WARN 提醒，不阻断提交；fail-open——git 不可用/文件不可读均降级跳过）。
 *   未知参数仍退 2（trap #12 白名单：--jso 拼错不得静默放行）。
 *
 * 用法：
 *   node scripts/check-twin-siblings.ts --files "frontend/src/a.ts\nfrontend/src/b.ts"   # 文本报告
 *   node scripts/check-twin-siblings.ts --files "..." --json                             # JSON（门禁调用）
 *
 * 挂载：scripts/_lib/commit-check.ts 第 4 步（commit-with-check 轻量清单；仅变更含源文件时运行；
 *   纯 WARN 不阻断，刻意不进 pre-push 全量门禁——变更域语义不适合 push 全量扫描，
 *   登记于 gate-coverage BYPASS_CHECKS「刻意旁路」组）。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT, readText, toPosix, walk } from "./_lib/scan-files.ts";

const ARGS = parseArgs(process.argv.slice(2), { bools: ["json"], strings: ["files"] });

// ── 阈值（语义由契约测试锁；数字可调）──
const MIN_SHAPE_LEN = 30; // 结构指纹 < 30 字符 → 太泛（`if (a) {` 之类）误报率爆炸，弃
const MIN_HITS = 2; // 指纹在同胞目标集中 ≥2 行才出候选（1 行同胞没有「漏改」风险）
const MAX_HITS = 10; // 每候选最多展示 10 条同胞行（其余计 total 不刷屏）
const MAX_CANDIDATES = 12; // 单轮最多 12 个候选指纹（大重构日防清单爆炸）
const SHAPE_CAP = 100; // 从 diff 新增行最多取 100 类结构指纹

/**
 * 把一行源码归一化成结构指纹：字符串字面量（单/双/反引号，单行闭合）→ Q，数字字面量 → N，
 * 空白折叠；标识符/运算符/关键字保留。
 * `el.setAttribute("aria-disabled", String(open))` → `el.setAttribute(Q, String(open))`——
 * 同胞 `el.setAttribute("aria-hidden", String(open))` 归一化后同指纹命中。
 */
export function normalizeLine(line: string): string {
  let s = line.trim().replace(/\s+/g, " ");
  s = s.replace(/'(?:\\.|[^'\\\n])*'/g, "Q");
  s = s.replace(/"(?:\\.|[^"\\\n])*"/g, "Q");
  s = s.replace(/`(?:\\.|[^`\\\n])*`/g, "Q");
  s = s.replace(/(?<![\w$])(?:\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?|0x[\da-fA-F_]+)(?![\w$])/gi, "N");
  return s;
}

/** diff 新增行（带新文件行号 + 来源文件，git 管道在主流程填充）。 */
export interface AddedLine {
  text: string;
  file: string;
  line: number;
}

/** 结构指纹 + 出处（本次变更哪个文件哪行引入）。 */
export interface Shape {
  shape: string;
  origin: string;
}

/** 同胞目标行（未变更区一行；text 为原始行）。 */
export interface TargetLine {
  file: string;
  line: number;
  text: string;
}

/** 候选同胞清单条目（W7 候选清单范式：非结论，需人工确认）。 */
export interface Candidate {
  shape: string;
  origin: string;
  total: number;
  hits: string[];
}

/** 从 diff 新增行抽结构指纹（纯函数，契约测试锁核）。 */
export function extractShapes(added: AddedLine[], cap = SHAPE_CAP): Shape[] {
  const out: Shape[] = [];
  const seen = new Set<string>();
  for (const a of added) {
    const shape = normalizeLine(a.text);
    if (shape.length < MIN_SHAPE_LEN) continue; // 太短 → 太泛
    if (!shape.includes("(")) continue; // 无调用/控制结构 → 无同胞语义
    if (/^(\/\/|\/\*|\*)/.test(shape)) continue; // 注释行
    if (/^import\b/.test(shape)) continue; // 纯 import 声明（import 同胞无「漏改」风险）
    if (seen.has(shape)) continue;
    seen.add(shape);
    out.push({ shape, origin: `${a.file}:${a.line}` });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * 指纹 × 同胞目标检索（纯函数，契约测试锁核）：
 * 目标行先廉价预筛（长度 ≥30 & 含 `(` & 非注释非 import——与 extractShapes 同口径），
 * 再按归一化指纹分组；某 shape 组 ≥ MIN_HITS 即出候选。
 */
export function matchShapes(shapes: Shape[], targets: TargetLine[]): Candidate[] {
  const groups = new Map<string, string[]>();
  for (const t of targets) {
    const raw = t.text.trim();
    if (raw.length < MIN_SHAPE_LEN || !raw.includes("(")) continue;
    if (/^(\/\/|\/\*|\*)/.test(raw)) continue;
    if (/^import\b/.test(raw)) continue;
    const s = normalizeLine(t.text);
    let g = groups.get(s);
    if (g === undefined) g = groups.set(s, []).get(s)!;
    g.push(`${t.file}:${t.line}`);
  }
  const out: Candidate[] = [];
  for (const c of shapes) {
    const hits = groups.get(c.shape);
    if (!hits || hits.length < MIN_HITS) continue;
    out.push({ shape: c.shape, origin: c.origin, total: hits.length, hits: hits.slice(0, MAX_HITS) });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

// ── git 管道（fail-open：任何失败降级跳过，不阻断）──
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

/** 文件在 HEAD 的内容（变更文件「未变更行」基线）；新文件/非 git 仓 → null（cat-file -e 静默探存在性，无 stderr 噪音）。 */
function gitHeadContent(rel: string): string | null {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${rel}`], { cwd: ROOT, stdio: "ignore" });
  } catch {
    return null;
  }
  try {
    return execFileSync("git", ["show", `HEAD:${rel}`], {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: GIT_MAX_BUFFER,
    }).replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

/** diff 新增行（新文件行号按 hunk 头推；git 失败 → 空）。 */
function gitAddedLines(rel: string): AddedLine[] {
  let out: string;
  try {
    out = execFileSync("git", ["diff", "HEAD", "--", rel], {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: GIT_MAX_BUFFER,
    });
  } catch {
    return [];
  }
  const added: AddedLine[] = [];
  let newLine = 0;
  for (const l of out.split("\n")) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      newLine = parseInt(h[1]!, 10);
      continue;
    }
    if (l.startsWith("+") && !l.startsWith("+++")) {
      added.push({ text: l.slice(1), file: rel, line: newLine });
      newLine++;
    } else if (l.startsWith(" ") || l.startsWith("\t")) {
      newLine++; // 上下文行推进新文件行号；删除行/元信息行不推进
    }
  }
  return added;
}

function targetsFrom(file: string, text: string, targets: TargetLine[]): void {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    targets.push({ file, line: i + 1, text: lines[i]! });
  }
}

function main(): void {
  if (ARGS.help) {
    console.log(
      '用法: node scripts/check-twin-siblings.ts --files "<换行/逗号分隔的变更文件>" [--json]\n' +
        "  改动范围同构同胞提醒探针（纯 WARN 不阻断；_summary.warns = 候选指纹数）。",
    );
    return;
  }
  if ((ARGS.unknown as string[]).length > 0) {
    console.error(`未知参数: ${(ARGS.unknown as string[]).join(", ")}（仅支持 --files / --json）`);
    process.exitCode = 2;
    return;
  }

  const rawFiles = String(ARGS.files ?? "")
    .split(/[\n,]/)
    .map((s) => toPosix(s.trim()))
    .filter(Boolean);
  const srcFiles = rawFiles.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
  if (srcFiles.length === 0) {
    if (ARGS.json) console.log(JSON.stringify({ _summary: { issues: 0, warns: 0, skipped: true } }));
    else console.log("[check-twin-siblings] 变更无源文件（.ts/.tsx/.js/.jsx），跳过");
    return;
  }

  // 1) 指纹：各变更源文件的 diff 新增行；新文件（无 HEAD 版本）= 当前全文皆新增
  const addedAll: AddedLine[] = [];
  const targets: TargetLine[] = [];
  for (const f of srcFiles) {
    const head = gitHeadContent(f);
    if (head === null) {
      try {
        addedAll.push(
          ...readText(path.join(ROOT, f))
            .split("\n")
            .map((t, i) => ({ text: t, file: f, line: i + 1 })),
        );
      } catch {
        /* 不可读 → 该文件无新增行可抽 */
      }
    } else {
      addedAll.push(...gitAddedLines(f));
      targetsFrom(f, head, targets); // 变更文件的 HEAD 版本 = 该文件的「未变更行」
    }
  }

  // 2) 同胞目标集：全仓未变更生产源文件（walk 全仓；变更文件走 HEAD 版本，测试/生成物/upstream 排除）
  const changedSet = new Set(srcFiles);
  for (const p of walk(ROOT, {
    exts: [".js", ".ts", ".tsx"],
    skipDir: (n) =>
      n.startsWith(".") ||
      ["node_modules", "bindings", "dist", "public", "css", "completions", "upstream", "tests"].includes(n),
    skipTest: true,
    rel: true,
  }) as Array<{ abs: string; rel: string }>) {
    const rel = toPosix(p.rel);
    if (changedSet.has(rel)) continue;
    try {
      targetsFrom(rel, readText(p.abs), targets);
    } catch {
      /* 单文件不可读不炸整轮 */
    }
  }

  // 3) 指纹 × 同胞检索 → 候选清单（恒 exit 0）
  const shapes = extractShapes(addedAll);
  const candidates = matchShapes(shapes, targets);
  if (ARGS.json) {
    console.log(JSON.stringify({ _summary: { issues: 0, warns: candidates.length }, warns: candidates }));
  } else {
    console.log(
      `[check-twin-siblings] 变更源文件 ${srcFiles.length} · 结构指纹 ${shapes.length} 类 · 同胞候选 ${candidates.length} 条`,
    );
    for (const c of candidates) {
      console.log(`  指纹 ${c.shape}（本次 ${c.origin} 新增）`);
      console.log(`    未变更区同类行 ${c.total}（展示 ≤${MAX_HITS}）: ${c.hits.join("  ")}`);
    }
    if (candidates.length > 0) {
      console.log("  提醒: 同构 ≠ 需要改——请判断这些同胞是否需要同步调整（元失败 §7.4 孪生盲区）");
    }
  }
}

// ── CLI 入口（isCli 守卫置模块末尾防 TDZ；import 本模块的契约测试不触发 main）──
function isCli(): boolean {
  try {
    return (
      process.argv[1] !== undefined &&
      path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}
if (isCli()) main();
