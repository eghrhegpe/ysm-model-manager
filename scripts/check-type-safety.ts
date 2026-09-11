#!/usr/bin/env node
/**
 * check-type-safety.ts — 前端类型安全侵蚀扫描（any / @ts-ignore / 非空断言）。
 *
 * 设计意图：tsc / typecheck 回答「类型下限能不能过」，本脚本回答「类型上限怎么漏」——
 * 追踪 `any`、`@ts-ignore`、非空断言 `!` 这些逃离类型系统的信号随时间的聚集。
 * 与 line-counter（多长）/ check-complexity（多绕）/ check-deadcode（冗余）互补，
 * 构成「可否维护」里的类型安全维度；接入方式是把本脚本跑成可审查的侵蚀趋势报告。
 *
 * 设计取舍：
 *   1. 只扫生产文件（walk skipTest，排除 .test/.spec/__tests__），测试里的大量
 *      `!`/`as any` 是合理逃逸（构造桩数据），计入只会制造噪音。还排除 vendor/、.d.ts。
 *   2. 加权侵蚀分（EROSION_WEIGHTS）：@ts-ignore(4) > @ts-expect-error(3) > asc any(2)
 *      > :any(2) > <any>(1) > 非空断言 !(0.2，情报位——前端 DOM 访问大多合法，故极轻权）。
 *      一文件分数 = Σ weight×count，越重信号占比越高。
 *   3. 三档清单对齐 lain：🟨(≥threshold) / 🟧(≥2×) / 🟥(≥3×)。默认 threshold=8。
 *
 * 依据（实测 2026-09-10）：@ts-ignore/@ts-expect-error 全仓仅 3 处（设计干净）；
 * as any/:any/<any> 182 处但几乎全在测试（生产仅个位数）；非空断言 1143 处也几乎全测试。
 * 故本扫描默认生产域应是「晃尖近零」，新逃逸一出现即被点亮——正是侵蚀追踪的用途。
 *
 * 依赖：零依赖（node:fs / node:path / node:url + _lib/scan-files 共享层）。
 *
 * 用法：
 *   node scripts/check-type-safety.ts                                     # 全前端生产文件，默认 threshold 8
 *   node scripts/check-type-safety.ts --scope frontend/src/preview-3d     # 按域收窄
 *   node scripts/check-type-safety.ts --threshold 12                      # 调高黄档（橙=2× 红=3×）
 *   node scripts/check-type-safety.ts --strict                            # 任一文件 🟨+ 时 exit 1（可挂门禁）
 *   node scripts/check-type-safety.ts --json                              # JSON（子代理 / CI / doctor 消费）
 *
 * 退出码：默认 0（情报型）；初始化失败 1；--strict 且存在 🟨+ 文件时 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRoot, readText, relPosix, SRC_DIR, toPosix, walk } from "./_lib/scan-files.ts";
import { parseArgs } from "./_lib/parse-args.ts";

const ROOT = getRoot();

// ─── 参数解析 ─────────────────────────────────────────────
const raw = parseArgs(process.argv.slice(2), {
  bools: ["json", "strict"],
  strings: ["scope", "threshold"],
  defaults: { threshold: 8 }, // 🟨≥8，🟧=2×，🟥=3×
});
if (raw.unknown?.length) {
  console.error(`❌ 未知参数: ${raw.unknown.join(", ")}（--help 查看用法）`);
  process.exit(1);
}
if (raw.threshold !== null) {
  const n = parseInt(raw.threshold as string, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`[check-type-safety] --threshold 需正整数，收到 ${raw.threshold}，用默认 8`);
    raw.threshold = 8;
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

// ─── 信号定义与权重（唯一定义点，契约测试断言不改权）─────────
// normalized = 归一到小写，供契约测试无关大小写比对信号名。
export type TypeErosionSignal =
  | "tsIgnore"
  | "tsExpectError"
  | "asAny"
  | "colonAny"
  | "anyGeneric"
  | "nonNull";

/** 各信号权重：分越高该逃逸越危险。 @ts-ignore 最重（静默压制），非空断言最轻（DOM 常用合法）。 */
export const EROSION_WEIGHTS: Record<TypeErosionSignal, number> = {
  tsIgnore: 4,
  tsExpectError: 3,
  asAny: 2,
  colonAny: 2,
  anyGeneric: 1,
  nonNull: 0.2,
};

/**
 * 组合正则：一次遍历逐行匹配，按捕获组归类到信号——避免 `Array<any>` 同时命中
 * `:any` 与 `<any>` 被双计。捕获组顺序与 EROSION_WEIGHTS 键一致。
 *   1 tsIgnore        2 tsExpectError    3 asAny
 *   4 colonAny        5 anyGeneric       6 nonNull
 */
const SIGNAL_RE =
  /(^[^\S\r\n]*\/\/\s*@ts-ignore\b)|(^[^\S\r\n]*\/\/\s*@ts-expect-error\b)|(\bas\s+any\b)|(:\s*any\b|\b(?:Array|Promise)<any\w*?>)|(\b<any\b)|([A-Za-z0-9_)\]]!)/g;

/** 逐行统计：返回各信号计数。正则跨行无状态（每信号每行独立 global）。契约测试锁此翻译层。 */
export function countLineSignals(line: string): Record<TypeErosionSignal, number> {
  const counts = EMPTY_COUNTS();
  SIGNAL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SIGNAL_RE.exec(line)) !== null) {
    if (m[1]) counts.tsIgnore += 1;
    else if (m[2]) counts.tsExpectError += 1;
    else if (m[3]) counts.asAny += 1;
    else if (m[4]) counts.colonAny += 1;
    else if (m[5]) counts.anyGeneric += 1;
    else if (m[6]) counts.nonNull += 1;
  }
  return counts;
}

// ─── 纯函数（契约测试直接消费）────────────────────────────
/** 加权侵蚀分：Σ weight×count（保留浮点，展示层取整）。 */
export function erosionOf(counts: Record<TypeErosionSignal, number>): number {
  let s = 0;
  for (const sig of Object.keys(EROSION_WEIGHTS) as TypeErosionSignal[]) {
    s += EROSION_WEIGHTS[sig] * (counts[sig] ?? 0);
  }
  return s;
}

export type ErosionTier = "clean" | "yellow" | "orange" | "red";

/** 三档归类：clean(<t) / yellow(≥t) / orange(≥2t) / red(≥3t)。 */
export function tierOf(score: number, threshold: number): ErosionTier {
  if (score >= threshold * 3) return "red";
  if (score >= threshold * 2) return "orange";
  if (score >= threshold) return "yellow";
  return "clean";
}

/**
 * 生产源文件判定：排除测试、vendor、声明文件。纯谓词，供 walk 过滤 + 契约测试复用。
 * rel = 相对 frontend/src 的正斜杠路径（如 preview-3d/menu/env.ts）。
 */
export function isProdSourceFile(rel: string): boolean {
  if (/(^|\/)vendor\//.test(rel)) return false; // 三方 vendor（babylon-mmd 等）
  if (/\.d\.[cm]?ts$/.test(rel)) return false; // 声明文件
  if (/(^|\/)__tests__\//.test(rel)) return false; // 测试目录
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)) return false; // 测试文件
  return true;
}

// ─── 扫描执行 ────────────────────────────────────────────
interface FileErosion {
  file: string; // 仓库相对路径
  counts: Record<TypeErosionSignal, number>;
  score: number;
  tier: ErosionTier;
  hotspots: string[]; // 侵蚀分最高的 N 行（抽样，不含格式）
}

const EMPTY_COUNTS = (): Record<TypeErosionSignal, number> => ({
  tsIgnore: 0,
  tsExpectError: 0,
  asAny: 0,
  colonAny: 0,
  anyGeneric: 0,
  nonNull: 0,
});

function scanSingle(abs: string, rel: string, threshold: number): FileErosion | null {
  if (!isProdSourceFile(rel)) return null;
  const text = readText(abs);
  const counts = EMPTY_COUNTS();
  const hotspots: Array<{ score: number; text: string }> = [];
  const lines = text.split("\n");
  lines.forEach((ln) => {
    const lc = countLineSignals(ln);
    // 注释行：`// @ts-ignore` 这类指令本就写在注释行上，必须保留 tsIgnore/tsExpectError；
    // 但注释正文里的 "as any"/"<any>"/"!" 是说明文字非真实侵蚀，剔除。
    const t = ln.trim();
    const isCommentLine = t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("*/");
    if (isCommentLine) {
      lc.asAny = 0;
      lc.colonAny = 0;
      lc.anyGeneric = 0;
      lc.nonNull = 0;
    }
    const score = erosionOf(lc);
    if (score === 0) return;
    for (const k of Object.keys(counts) as TypeErosionSignal[]) counts[k] += lc[k] ?? 0;
    hotspots.push({ score, text: t.slice(0, 90) });
  });
  const score = erosionOf(counts);
  hotspots.sort((a, b) => b.score - a.score);
  return {
    file: relPosix(abs),
    counts,
    score,
    tier: tierOf(score, threshold),
    hotspots: hotspots.slice(0, 5).map((h) => h.text),
  };
}

function main(): void {
  const base = path.resolve(ROOT, args.scope);
  if (!fs.existsSync(base)) {
    console.error(`[check-type-safety] --scope 路径不存在: ${args.scope}`);
    process.exit(1);
  }
  const filesOnly = args.scope === "frontend/src";
  const target = filesOnly ? SRC_DIR : base;

  const results: FileErosion[] = [];
  const relBase = path.relative(ROOT, target);
  const files = walk(target, { skipDir: (n) => n.startsWith(".") || n === "node_modules" || n === "css" });
  for (const fp of files) {
    const abs = typeof fp === "string" ? fp : fp.abs;
    const rel = path.join(relBase, path.relative(target, abs));
    const r = scanSingle(abs, toPosix(rel), args.threshold);
    if (r) results.push(r);
  }

  results.sort((a, b) => b.score - a.score);
  const active = results.filter((r) => r.tier !== "clean");
  // 重点一览：含任一重信号（as any / @ts-* / <any>）的文件，不等阈值也亮——让仅有的几处
  // 真实侵蚀点可见（数值化债务），分级清单留给 --strict 门禁。
  const heavy = (r: FileErosion) => r.counts.tsIgnore + r.counts.tsExpectError + r.counts.asAny + r.counts.colonAny + r.counts.anyGeneric > 0;
  const heavyActive = results.filter((r) => r.tier === "clean" && heavy(r));

  // ── 聚合 ──
  const totals: Record<TypeErosionSignal, number> = EMPTY_COUNTS();
  for (const r of results) for (const k of Object.keys(totals) as TypeErosionSignal[]) totals[k] += r.counts[k];

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          scope: relPosix(target),
          threshold: args.threshold,
          files: results.length,
          activeFiles: active.length,
          totals,
          filesByTier: {
            red: results.filter((r) => r.tier === "red").length,
            orange: results.filter((r) => r.tier === "orange").length,
            yellow: results.filter((r) => r.tier === "yellow").length,
          },
          active: active.map((r) => ({ file: r.file, score: Math.round(r.score * 10) / 10, tier: r.tier, counts: r.counts })),
          heavyActive: heavyActive.map((r) => ({ file: r.file, score: Math.round(r.score * 10) / 10, counts: r.counts })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`=== 类型安全侵蚀扫描（冷却 ${relPosix(target)}，threshold=${args.threshold}）===`);
    console.log(`生产文件 ${results.length}，侵蚀活跃 ${active.length}`);
    const sigName: Record<TypeErosionSignal, string> = {
      tsIgnore: "@ts-ignore",
      tsExpectError: "@ts-expect-error",
      asAny: "as any",
      colonAny: ":any",
      anyGeneric: "<any>",
      nonNull: "!非空",
    };
    const sigLine = (Object.keys(sigName) as TypeErosionSignal[])
      .map((k) => `${sigName[k]}=${totals[k]}`)
      .join("  ");
    console.log(`聚合: ${sigLine}`);
    console.log("");
    for (const r of [...active, ...heavyActive]) {
      const mark = r.tier === "red" ? "🟥" : r.tier === "orange" ? "🟧" : r.tier === "yellow" ? "🟨" : "◽";
      console.log(`${mark} ${r.score.toFixed(1)}  ${r.file}`);
      for (const h of r.hotspots) console.log(`     ${h}`);
    }
    if (active.length === 0 && heavyActive.length === 0)
      console.log("✅ 生产域无侵蚀信号，类型系统在上限侧是稳的。");
    else if (active.length === 0)
      console.log("⚠️  重信号仅此几处（未达分级阈值），类型系统总体上限侧仍稳。");
  }

  if (args.strict && active.length > 0) {
    console.error(`[check-type-safety] --strict: ${active.length} 文件落入 🟨+，阻断`);
    process.exit(1);
  }
}

/** 相对 frontend/src 的生产路径过滤复用 isProdSourceFile；toPosix 由共享层提供。无本地手写。 */

const isCli = (() => {
  const arg0 = process.argv[1];
  if (!arg0) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(arg0);
})();
if (isCli) {
  main();
}