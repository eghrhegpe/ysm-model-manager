#!/usr/bin/env node
/**
 * check-params.ts — 前端函数参数陷阱扫描（长参数列表 / 布尔陷阱）。
 *
 * 设计意图：line-counter（多长）/ check-complexity（多绕）/ check-type-safety（多漏）
 * 都盯「函数内」，本工具补最后一块——「函数边界」。一个函数参数 >6 个、或夹杂多个
 * bool 参数（真/假语义靠调用位猜），是调用方最容易写错的地方。布尔陷阱越重，
 * 越该改成对象参数（options）或拆解。与其余扫描器同域同档，供拆解立项。
 *
 * 指标（Sonar/Common 简化）：
 *   1. 参数个数（params）：一个函数一次出现 n 个形参。
 *   2. 布尔参数（boolParams）：型别为 boolean / 联合含 boolean 的形参个数。
 *      陷阱分 trapScore = params + boolParams（布尔参数占位已计入 params，另 +1 加重，
 *      故一个 bool 参数贡献权重 2——多个 bool 并列是典型「布尔陷阱」气味）。
 *   3. 清单门：params≥threshold=6（长参数）或 boolParams≥2（布尔陷阱）即亮；
 *      三档 🟨≥threshold（橙=2x 红=3x）按陷阱分归类。
 *
 * 复用：命名函数收集走 check-complexity.`collectNamedFunctions`（同一收集口径），
 * 排名/分级/惰性 ts-morph 加载与 check-complexity 同款——只新增参数提取这一处差异。
 *
 * 依赖：ts-morph（frontend/node_modules，惰性加载；缺失 WARN 跳过 0）+ 共享层。
 *
 * 用法：
 *   node scripts/check-params.ts                                  # 全前端，默认 threshold 6
 *   node scripts/check-params.ts --scope frontend/src/preview-3d  # 按域收窄
 *   node scripts/check-params.ts --threshold 5 --json             # 调档 / JSON
 *   node scripts/check-params.ts --files "$(git diff --name-only)" # 只扫本次变更文件（增量）
 *   node scripts/check-params.ts --changed                        # 同上，自动相对默认分支基线
 *   node scripts/check-params.ts --max-files 100                  # 变更域文件数上限（超限降级跳过）
 *   node scripts/check-params.ts --strict                         # 有命中时 exit 1
 *
 * `_summary` 契约（门禁消费，gate-parse.parseToolOutput 判定）：
 *   ok     = 无命中（items 为空）
 *   errors = 命中数（长参数 / 布尔陷阱）
 *   warns_list = FAIL 时前 20 条单行明细（顶层 ok 仅为人类可读，门禁读 _summary）
 *   scopeFilter = 变更域过滤留痕（mode/requested/matched），见 _lib/changed-scope.ts
 *   degraded + skippedReason = 变更域文件数超过 --max-files 上限时的跳过留痕：ok 仍
 *     true（没扫到违规 ≠ 断言无违规），但门禁 note 显式带 degraded——「本次跳过」与
 *     「扫描通过」不得同形（gate-parse 第 6 条）。代价是本次无参数陷阱守卫。
 *
 * 退出码：0（情报型，判定见 _summary.ok）；ts-morph 缺失 0 WARN（degraded）；
 * --max-files 超限 0 WARN（degraded，见上）；--strict 且有命中 1；初始化/变更域解析
 * 失败（scope 不存在 / 无文件 / --files 空 / --changed 不可解析）1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inChangedScope, resolveChangedScope } from "./_lib/changed-scope.ts";
import { buildScanVerdict } from "./_lib/gate-parse.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { getRoot, relPosix } from "./_lib/scan-files.ts";
import { collectNamedFunctions } from "./check-complexity.ts";

const ROOT = getRoot();

// ─── 参数解析（必须在 main() 内，见下方红线注释）──────────
// ⚠️ 参数解析与 unknown 拦截**严禁放模块顶层**：本模块被 tests/ 契约测试 import，
// 且自身 import check-complexity——CLI 型脚本互相 import 时，顶层的 parseArgs 会吃掉
// 宿主的 argv，宿主独有的 flag 报「未知参数」并 exit(1)（2026-09-13 实证，已同
// check-complexity 一并修复）。顶层只允许纯定义与纯函数。

const MAX_FILES_DEFAULT = 200;

/** 初始化/用法类失败的唯一出口：fail-closed，JSON 模式只写 _summary（gate 合并双流）。 */
function failClosed(msg: string, json: boolean): never {
  if (json)
    console.log(
      JSON.stringify(
        { ok: false, mode: "params", _summary: { ok: false, errors: 0, error: msg } },
        null,
        2,
      ),
    );
  else console.error(`[check-params] ${msg}`);
  process.exit(1);
}

/** 参数解析与校验（仅 CLI main 调用；被 import 时绝不触碰 process.argv）。 */
function resolveArgs() {
  const raw = parseArgs(process.argv.slice(2), {
    bools: ["json", "strict", "changed"],
    strings: ["scope", "threshold", "files", "max-files"],
    defaults: { threshold: 6 }, // 🟨≥6，🟧=2x，🟥=3x
  });
  if (raw.unknown?.length) {
    console.error(`❌ 未知参数: ${raw.unknown.join(", ")}（--help 查看用法）`);
    process.exit(1);
  }
  if (raw.threshold !== null) {
    const n = parseInt(raw.threshold as string, 10);
    if (!Number.isFinite(n) || n < 1) {
      console.error(`[check-params] --threshold 需正整数，收到 ${raw.threshold}，用默认 6`);
      raw.threshold = 6;
    } else {
      raw.threshold = n;
    }
  }
  if (raw["max-files"] !== null) {
    const n = parseInt(raw["max-files"] as string, 10);
    if (!Number.isFinite(n) || n < 1) {
      console.error(`[check-params] --max-files 需正整数，收到 ${raw["max-files"]}，用默认 ${MAX_FILES_DEFAULT}`);
      raw["max-files"] = MAX_FILES_DEFAULT;
    } else {
      raw["max-files"] = n;
    }
  }
  return {
    json: raw.json as boolean,
    strict: raw.strict as boolean,
    changed: raw.changed as boolean,
    scope: (typeof raw.scope === "string" ? raw.scope : null) ?? "frontend/src",
    threshold: raw.threshold as number,
    maxFiles: (raw["max-files"] as number) ?? MAX_FILES_DEFAULT,
    files: raw.files,
  };
}

// ─── 纯函数（契约测试直接消费）────────────────────────────
/** 陷阱分：params + boolParams（bool 另 +1 加重 → 权重 2）。 */
export function trapScore(params: number, boolParams: number): number {
  return params + boolParams;
}

/** 三档归类：clean(<t) / yellow(≥t) / orange(≥2t) / red(≥3t)。 */
export function trapTier(score: number, threshold: number): "clean" | "yellow" | "orange" | "red" {
  if (score >= threshold * 3) return "red";
  if (score >= threshold * 2) return "orange";
  if (score >= threshold) return "yellow";
  return "clean";
}

/** 触发清单的理由（供展示；门 = 有任一理由即亮）。 */
export function trapReasons(params: number, boolParams: number, threshold: number): string[] {
  const reasons: string[] = [];
  if (params >= threshold) reasons.push(`参数过长(${params}≥${threshold})`);
  if (boolParams >= 2) reasons.push(`布尔陷阱(bool×${boolParams})`);
  return reasons;
}

/**
 * 超大变更集降级决策（纯函数，契约测试锁定）：变更域文件数 > 上限 → 跳过扫描。
 *
 * 背景：check-params 是三个档位扫描器中唯一「重」的——`getType()` 逐参数触发类型检查，
 * 全库 59.4s；增量耗时近似线性于进入扫描的文件数（55 文件 7.9s、单文件 0.4s，实测）。
 * 整目录搬家那种 300+ 文件的推送可到分钟级，与其让门禁干等，不如跳过并留 degraded 痕——
 * 代价只是本次无参数陷阱守卫（debt 挂载本就允许）。
 *
 * 边界语义：**恰好等于上限不降级**（> 而非 >=）；上限 <1 属调用方 bug，由参数校验拦截。
 */
export function scanCapDecision(
  scannedCount: number,
  maxFiles: number,
): { skip: true; reason: string } | { skip: false } {
  if (scannedCount > maxFiles)
    return {
      skip: true,
      reason: `变更域 ${scannedCount} 个文件超过上限 ${maxFiles}，跳过扫描（降级运行，本次无参数陷阱守卫）`,
    };
  return { skip: false };
}

// ─── 参数提取（ts-morph 参数节点 → {个数, 布尔个数}）─────────
/** 判一个参数是否布尔型（裸 boolean / 联合含 boolean）。未标注的按初始值兜底（ts-morph 已并入）。 */
function isBoolParam(p: any): boolean {
  const t = (p?.getType?.()?.getText?.() ?? "").toLowerCase();
  return t.includes("boolean");
}

function paramsOf(fn: any): { params: number; boolParams: number } {
  const ps = fn?.getParameters?.() ?? [];
  let boolParams = 0;
  for (const p of ps) if (isBoolParam(p)) boolParams++;
  return { params: ps.length, boolParams };
}

// ── walk 同步版（跳过测试/生成物，复用 check-complexity 同款）──
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
  const args = resolveArgs();
  const threshold = args.threshold;

  // 变更域解析（--files 优先 → --changed 自解析 → 全库）：放在最前，避免因 --files 为空 /
  // --changed 不可解析时白跑一次 ts-morph 装载。
  const changedRes = resolveChangedScope(args.files, args.changed);
  if (changedRes.error) failClosed(changedRes.error, args.json);
  const changedScope = changedRes.scope;
  const scopeMode = typeof args.files === "string" ? "files" : args.changed ? "changed" : "all";

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
            mode: "params",
            _summary: { ok: true, errors: 0, degraded: true, skippedDueToNoTsMorph: true },
            items: [],
          },
          null,
          2,
        ),
      );
    } else {
      console.warn("[check-params] 未找到 ts-morph（frontend/node_modules 缺失），跳过扫描。");
      console.warn("   (cd frontend && npm install) 后重试。");
    }
    return;
  }

  const rootAbs = path.isAbsolute(args.scope) ? args.scope : path.join(ROOT, args.scope);
  // 初始化失败 = 用法错误：显式 exit 1（此前 return 以 0 退出，与文件头契约不符且 fail-open）。
  if (!fs.existsSync(rootAbs)) failClosed(`--scope 目录不存在：${args.scope}`, args.json);

  const files = walkSource(rootAbs).map((f) => path.resolve(f));
  if (files.length === 0) failClosed(`--scope 下无 .ts/.js 文件：${args.scope}`, args.json);

  // 变更域裁剪：过滤在 walk 之后（先证明 scope 本身有效，避免「scope 拼错」被
  // 「过滤后为空」掩盖成 PASS）。过滤后为空 = 本次变更文件不在扫描范围 → 合法 PASS。
  const scanned = changedScope ? files.filter((f) => inChangedScope(relPosix(f), changedScope)) : files;
  const scopeFilter = {
    mode: scopeMode,
    requested: changedScope ? changedScope.size : null,
    matched: scanned.length,
    total: files.length,
  };

  // 超大变更集降级（见 scanCapDecision）：scanned 超过 --max-files 上限 → 跳过扫描。
  // ok 保持 true（没扫到违规 ≠ 断言无违规），但 _summary.degraded + skippedReason 让
  // 门禁 note 显式带 degraded 标记——「本次跳过」与「扫描通过」不得同形（gate-parse 第 6 条）。
  const cap = scanCapDecision(scanned.length, args.maxFiles);
  if (cap.skip) {
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            degraded: true,
            mode: "params",
            scope: relPosix(rootAbs),
            threshold,
            _summary: {
              ok: true,
              errors: 0,
              degraded: true,
              skippedReason: cap.reason,
              scopeFilter: { ...scopeFilter, cappedAt: args.maxFiles },
            },
            items: [],
          },
          null,
          2,
        ),
      );
    } else {
      console.warn(`[check-params] ${cap.reason}`);
      console.warn("   可调大 --max-files、用 --files 收窄到关键文件，或 --scope 直接扫单目录。");
    }
    return;
  }

  const project = new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true });
  const items: Array<{
    file: string;
    name: string;
    kind: string;
    line: number;
    params: number;
    boolParams: number;
    score: number;
    tier: string;
    reasons: string[];
  }> = [];
  let totalFuncs = 0;
  const parseFailures: string[] = [];

  for (const f of scanned) {
    let sf: any;
    try {
      sf = project.addSourceFileAtPath(f);
    } catch (e: any) {
      parseFailures.push(`${relPosix(f)}: ${e?.message ?? e}`);
      continue;
    }
    const rel = relPosix(f);
    for (const c of collectNamedFunctions(sf)) {
      totalFuncs++;
      const { params, boolParams } = paramsOf(c.node);
      const reasons = trapReasons(params, boolParams, threshold);
      if (reasons.length === 0) continue;
      items.push({
        file: rel,
        name: c.name,
        kind: c.kind,
        line: c.line,
        params,
        boolParams,
        score: trapScore(params, boolParams),
        tier: trapTier(trapScore(params, boolParams), threshold),
        reasons,
      });
    }
  }

  const TIER_ORDER: Record<string, number> = { red: 0, orange: 1, yellow: 2 };
  items.sort(
    (a, b) =>
      TIER_ORDER[a.tier]! - TIER_ORDER[b.tier]! ||
      b.score - a.score ||
      b.line - a.line,
  );

  // 违规口径 = 命中清单（长参数或布尔陷阱）；明细单行格式与文本模式一致，供门禁 tail 直读。
  const verdict = buildScanVerdict(
    items.length,
    items.map(
      (it) => `${it.file}:${it.line} ${it.name} p${it.params}/b${it.boolParams} [${it.reasons.join("; ")}]`,
    ),
  );

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: verdict.ok,
          mode: "params",
          scope: relPosix(rootAbs),
          threshold,
          totalFuncs,
          _summary: { ...verdict, scopeFilter },
          items,
          parseFailures,
        },
        null,
        2,
      ),
    );
    // JSON 模式阻断不留 stderr（gate 合并 stdout+stderr，混入文本会让 JSON.parse 失败）
    if (args.strict && !verdict.ok) process.exit(1);
    return;
  }

  console.log(`=== 参数陷阱扫描（${relPosix(rootAbs)}，长约≥${threshold}，布尔≥2，共 ${totalFuncs} 个函数）===`);
  if (scopeMode !== "all")
    console.log(
      `变更域过滤 --${scopeMode}：${scopeFilter.matched}/${scopeFilter.total} 个文件进入扫描`,
    );
  if (items.length === 0) {
    console.log(
      scopeMode !== "all" && scopeFilter.matched === 0
        ? "（本次变更文件均不在扫描范围内，视为通过）"
        : "✅ 无长参数/布尔陷阱，函数边界在上限侧是干净的。",
    );
    return;
  }
  for (const it of items) {
    const mark = it.tier === "red" ? "🟥" : it.tier === "orange" ? "🟧" : "🟨";
    console.log(`${mark} p${it.params}/b${it.boolParams} [${it.reasons.join("; ")}]  ${it.file}:${it.line}  ${it.name}`);
  }
  if (args.strict && !verdict.ok) {
    console.error(`[check-params] --strict: ${items.length} 处命中（长参数/布尔陷阱）→ 阻断`);
    process.exit(1);
  }
}

const isCli = (() => {
  const arg0 = process.argv[1];
  if (!arg0) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(arg0);
})();
if (isCli) {
  main().catch((e: any) => {
    console.error(`[check-params] 执行失败: ${e?.message ?? e}`);
    process.exit(1);
  });
}