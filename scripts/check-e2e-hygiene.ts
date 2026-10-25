#!/usr/bin/env node
/**
 * check-e2e-hygiene.ts - e2e 反模式静态门禁（观察期，非阻断）
 *
 * 职责：扫描 frontend/e2e + frontend/e2e-web 下的 *.spec.ts，捕捉三类违背
 * docs/knowledge/e2e-visual-feedback.md 教条的「零闸守」反模式：
 *   R1 固定 sleep 等就绪：waitForTimeout(<ms>) - 教条明禁固定等待等就绪。
 *       ms >= 1000 -> high（硬闸候选）；ms < 1000 -> warn（如 menu-visual 的 250/200/350）。
 *   R2 软断言假绿：toBeGreaterThan(0) / toBeGreaterThanOrEqual(1) - 存在性被 >0 稀释，
 *       掩盖「数量/顺序错了却仍绿」的假绿（.not 负向安全，已排除）。
 *   R3 守卫废置：screenshotWithBaseline 全树引用数 <=1（仅自身定义）即判定死代码待删；
 *       而 ad-hoc page.screenshot/shot() 仍在用 -> 字节级防假绿「旗舰守卫」从没落地。
 *       注意（2026-10 历史实证）：能力已 inline 迁为 sha256 两两互异闸（water-wave-evidence /
 *       fog-horizon-evidence / menu-visual 直接 createHash('sha256') 两两互异）；2026-10-25
 *       已删 visual-baseline.ts 死代码、menu-visual 的 shot() 接 sha256 互异闸。故 R3 现仅作
 *       残留 ad-hoc 截图无闸的巡检（其余 spec 已迁），并随硬化战役收口消项。
 *
 * 行为：默认仅报告不阻断（退出码恒 0，输出 [WARN]），属 debt 观察期。
 *   --strict 时命中 high 级即 exit 1，供未来升 hard 闸。
 *   --json   机读输出（_summary + findings）。
 * 依赖：node:fs / node:path / scripts/_lib/scan-files.ts（零外部依赖）
 *
 * 用法：node scripts/check-e2e-hygiene.ts [--strict] [--json]
 *
 * 退出码：默认 0（观察期非阻断）；--strict 且命中 high -> 1
 *
 * 设计意图：把 e2e 知识卡教条变成可观测/可执行的闸门，治 critique #1「教条零闸守」。
 *   直接改 menu-visual 接 screenshotWithBaseline 需真跑 Playwright+Chromium（本环境难验证），
 *   故优先落地离线可验的静态门禁；观察期满后 R1(high)/R2/R3 可翻为硬闸。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { walk, getRoot, relPosix } from "./_lib/scan-files.ts";

const ROOT = getRoot();
const E2E_DIRS = [
  path.join(ROOT, "frontend/e2e"),
  path.join(ROOT, "frontend/e2e-web"),
];

type Severity = "high" | "warn";
interface Finding {
  rule: "R1" | "R2" | "R3";
  severity: Severity;
  file: string;
  line?: number;
  detail: string;
}

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const JSON_OUT = args.includes("--json");

const findings: Finding[] = [];

// 全局计数（R3 用）
let sbRefs = 0; // screenshotWithBaseline 引用数（含定义自身）
let adhocShots = 0; // page.screenshot / shot() 直接调用数（树级，供概要）
const fileAdhoc = new Map<string, number>(); // 每 spec 的 ad-hoc 截图数
const fileGated = new Set<string>(); // 已接 sha256 互异闸的 spec

const lineOf = (src: string, idx: number): number =>
  src.slice(0, idx).split("\n").length;

for (const dir of E2E_DIRS) {
  if (!existsSync(dir)) continue;
  const files = walk(dir, { exts: [".spec.ts"], rel: true }) as Array<{
    abs: string;
    rel: string;
  }>;
  for (const f of files) {
    const rel = relPosix(f.abs);
    const src = readFileSync(f.abs, "utf8");

    // ---- R1: 固定 sleep 等就绪 ----
    const reR1 = /waitForTimeout\(\s*(\d+)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = reR1.exec(src)) !== null) {
      const ms = Number(m[1]);
      const sev: Severity = ms >= 1000 ? "high" : "warn";
      findings.push({
        rule: "R1",
        severity: sev,
        file: rel,
        line: lineOf(src, m.index),
        detail:
          "waitForTimeout(" + ms + ") 固定等待等就绪（教条明禁；>=1000ms 为硬闸候选）",
      });
    }

    // ---- R2: 软断言假绿（排除 .not 负向安全）----
    const reR2 =
      /(?<![.]not)[.]toBeGreaterThan\(\s*0\s*\)|(?<![.]not)[.]toBeGreaterThanOrEqual\(\s*1\s*\)/g;
    while ((m = reR2.exec(src)) !== null) {
      findings.push({
        rule: "R2",
        severity: "high",
        file: rel,
        line: lineOf(src, m.index),
        detail:
          m[0] + " 软断言（存在性被 >0 稀释，掩盖数量/顺序错却假绿）",
      });
    }

    // ---- R3 计数（树级 + 文件级）----
    const sbCount = (src.match(/screenshotWithBaseline/g) || []).length;
    sbRefs += sbCount;
    const adhoc =
      (src.match(/page[.]screenshot\(/g) || []).length +
      (src.match(/(?<![A-Za-z_])shot\(\s*["']/g) || []).length;
    adhocShots += adhoc;
    // 本 spec 是否已接 sha256 两两互异闸（water-wave/fog 用 createHash('sha256')，
    // menu-visual 用 assertShotsDistinct 包装 + createHash('sha256')）——接了即不算缺口。
    const gated = /createHash\(\s*["']sha256["']\)|assertShotsDistinct/.test(src);
    if (adhoc > 0) fileAdhoc.set(rel, (fileAdhoc.get(rel) || 0) + adhoc);
    if (gated) fileGated.add(rel);
  }
}

// R3：残留 ad-hoc 截图无 sha256 互异闸的 spec 巡检。
// screenshotWithBaseline 已删（2026-10-25）；字节级防假绿能力已 inline 迁为 sha256
// 两两互异闸（water-wave-evidence / fog-horizon-evidence / menu-visual 已接）。
// 本判据只点名「有 ad-hoc 截图却没接 sha256 互异闸」的 spec，随硬化战役收口消项。
const ungated = [...fileAdhoc.entries()].filter(([f]) => !fileGated.has(f));
for (const [f, c] of ungated) {
  findings.push({
    rule: "R3",
    severity: "warn",
    file: f,
    detail:
      "ad-hoc 截图=" + c + " 落 _shots/ 人肉回看，未接 sha256 两两互异闸（防假绿）；" +
      "对齐 water-wave-evidence / fog-horizon-evidence / menu-visual 的 createHash('sha256') 互异闸范式" +
      "（R3，随硬化战役收口）",
  });
}

// ---- 输出 ----
const highCount = findings.filter((f) => f.severity === "high").length;

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        _summary: {
          ok: true,
          total: findings.length,
          high: highCount,
          strict: STRICT,
          wouldFail: STRICT && highCount > 0,
        },
        findings,
      },
      null,
      2,
    ),
  );
  process.exit(STRICT && highCount > 0 ? 1 : 0);
}

if (findings.length === 0) {
  console.log("[OK] check-e2e-hygiene: 无 e2e 反模式（教条零闸守已转可观测）");
} else {
  console.log(
    "[WARN] check-e2e-hygiene: 发现 " + findings.length +
      " 处 e2e 反模式（" + highCount + " high，观察期非阻断）",
  );
  for (const f of findings) {
    const loc = f.line ? f.file + ":" + f.line : f.file;
    console.log(
      "  [" + f.severity.toUpperCase() + "] " + f.rule + "  " + loc + "  " + f.detail,
    );
  }
  if (STRICT && highCount > 0) {
    console.log("[STRICT] 命中 " + highCount + " 处 high 级反模式 -> exit 1");
  }
}

// 观察期非阻断：默认 exit 0；--strict 且命中 high -> exit 1。
process.exit(STRICT && highCount > 0 ? 1 : 0);
