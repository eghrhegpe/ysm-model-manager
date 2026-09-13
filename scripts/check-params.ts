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
 *   node scripts/check-params.ts --strict                         # 有命中时 exit 1
 *
 * `_summary` 契约（门禁消费，gate-parse.parseToolOutput 判定）：
 *   ok     = 无命中（items 为空）
 *   errors = 命中数（长参数 / 布尔陷阱）
 *   warns_list = FAIL 时前 20 条单行明细（顶层 ok 仅为人类可读，门禁读 _summary）
 *
 * 退出码：0（情报型，判定见 _summary.ok）；ts-morph 缺失 0 WARN（degraded）；--strict
 * 且有命中 1；初始化失败（scope 不存在 / 无文件）1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScanVerdict } from "./_lib/gate-parse.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { getRoot, relPosix } from "./_lib/scan-files.ts";
import { collectNamedFunctions } from "./check-complexity.ts";

const ROOT = getRoot();

// ─── 参数解析 ─────────────────────────────────────────────
const raw = parseArgs(process.argv.slice(2), {
  bools: ["json", "strict"],
  strings: ["scope", "threshold"],
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
const args = {
  json: raw.json as boolean,
  strict: raw.strict as boolean,
  scope: (typeof raw.scope === "string" ? raw.scope : null) ?? "frontend/src",
  threshold: raw.threshold as number,
};

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
  const threshold = args.threshold;

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
  if (!fs.existsSync(rootAbs)) {
    const msg = `--scope 目录不存在：${args.scope}`;
    if (args.json)
      console.log(
        JSON.stringify({ ok: false, mode: "params", _summary: { ok: false, errors: 0, error: msg } }, null, 2),
      );
    else console.error(msg);
    process.exit(1);
  }

  const files = walkSource(rootAbs).map((f) => path.resolve(f));
  if (files.length === 0) {
    const msg = `--scope 下无 .ts/.js 文件：${args.scope}`;
    if (args.json)
      console.log(
        JSON.stringify({ ok: false, mode: "params", _summary: { ok: false, errors: 0, error: msg } }, null, 2),
      );
    else console.error(msg);
    process.exit(1);
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
          _summary: verdict,
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
  if (items.length === 0) {
    console.log("✅ 无长参数/布尔陷阱，函数边界在上限侧是干净的。");
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