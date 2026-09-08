/**
 * gate-report.ts — 门禁 FAIL 输出摘要与报告落盘共享层。
 *
 * 设计意图（2026-09 锐评推进「输出运行过程而非返回信息」）：
 * pre-push-gate 的 FAIL tail 曾用 `slice(-12)` 取原始输出末尾——对 JSON 输出
 * （如 check-knowledge-drift --json）末尾是 `}`，错误详情全被截掉；AI 只看
 * 尾部 ~25 行时不知道错在哪，只能重跑命令考古（思维链断点）。
 * 本模块把「提取错误详情 + 渲染 FAIL 摘要」收敛为纯函数：
 *
 *   - firstErrors(out, n)：从工具输出提取前 n 条错误——JSON 取 `errors` 数组
 *     （字符串项），无 errors 回退 `warns_list`，再回退原始输出末 n 行；
 *   - formatFailSummary(item, pass, total, reportPath)：样式 C 渲染——
 *     `[FAIL][归属] 命令  通过/总数  首个错误（截断）  复现: 命令  报告: <path>`
 *     让 AI 在 25 行尾部内一次拿到「归属 / 错误 / 复现 / 深挖入口」四要素；
 *   - writeGateReport(results, mode)：完整运行过程落盘 .git/gate-report-<ts>.json
 *     （结构化，无行数限制），stderr 只给路径指针。
 *
 * 依赖：零依赖（node:fs / node:path / _lib/scan-files.ts 的 ROOT）。
 *
 * 用法：
 *   import { firstErrors, formatFailSummary, writeGateReport } from './_lib/gate-report.ts';
 *
 * 退出码：本模块无独立 CLI（被 pre-push-gate.ts import）。
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./scan-files.ts";

/**
 * 从工具输出提取前 n 条错误详情（纯函数）。
 * 优先级：JSON `errors` 数组（字符串项）→ `warns_list` → 原始输出末 n 行。
 * @param out  工具 stdout/stderr 合并输出
 * @param n    最多取几条
 */
export function firstErrors(out: string, n: number): string[] {
  if (!out || n <= 0) return [];
  // 1. JSON 形态：错误详情可能藏在任意「非空字符串数组」键下——顶层与 _summary 的
  //    errors/warns_list/missing/duplicates/ghosts/violations 等都是列表型错误详情。
  //    不做键名穷举，按「值是非空 string[]」泛化提取，优先 known 键（errors/warns_list）。
  try {
    const parsed = JSON.parse(out);
    const s = parsed._summary || parsed;
    const candidates: Record<string, unknown>[] = [parsed, s];
    const arrs: string[][] = [];
    // 优先 known 键序：errors → warns_list → 其它非空字符串数组
    for (const key of ["errors", "warns_list"]) {
      for (const obj of candidates) {
        if (Array.isArray((obj as any)[key]) && ((obj as any)[key] as string[]).length) {
          arrs.push((obj as any)[key]);
        }
      }
    }
    if (!arrs.length) {
      for (const obj of candidates) {
        for (const [k, v] of Object.entries(obj)) {
          if (k === "_summary" || k === "summary") continue;
          if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) {
            arrs.push(v as string[]);
          }
        }
      }
    }
    if (arrs.length) {
      return arrs.flat().map(String).filter(Boolean).slice(0, n);
    }
  } catch {
    /* 非 JSON，走下方回退 */
  }
  // 2. 非 JSON：原始输出末 n 行（构建/编译错误的常见形态）
  return out.trim().split("\n").filter(Boolean).slice(-n);
}

export interface GateResultItem {
  label: string;
  ok: boolean;
  time: number;
  note: string;
  tail: string;
  /** 工具原始输出（record 时保留，cap 64KB 尾部）——首错提取的事实源。 */
  raw?: string;
  blockPolicy?: "hard" | "debt" | "failClosed";
}

/**
 * 归属标签（内部）。blockPolicy 只反映「是否阻断」，不反映「归属」：
 *   debt → 存量债（声明为债务/环境降级，不阻断）
 *   failClosed → 失守（扫描本身不可用）
 *   hard → attributable（push/files 模式，检查针对本次变更）→ 本次引入；
 *          全扫模式（--all/--docs）无法归因 → 待归因（不冒充「本次引入」，
 *          2026-09-08 实证：docs 模式把并行会话留下的存量债标成本次引入，误导归因）。
 */
function policyTag(p: string | undefined, attributable: boolean): string {
  if (p === "debt") return "存量债";
  if (p === "failClosed") return "失守";
  return attributable ? "本次引入" : "待归因";
}

/**
 * 首错提取（内部）。详情优先级：raw(JSON) > 策展 tail > raw 末行 > note。
 * 回归锚：tail 可能是 runTools slice(-12) 的 JSON 碎片（`{` / `"x": 0,`），
 * 绝不能当首错展示；raw 是 record 时保留的原始输出，结构化提取的事实源。
 */
function firstErrorLine(item: GateResultItem): string {
  const none = "无错误详情（见完整报告）";
  if (item.raw) {
    let isJson = false;
    try {
      JSON.parse(item.raw);
      isJson = true;
    } catch {
      /* 非 JSON */
    }
    if (isJson) {
      const fe = firstErrors(item.raw, 1);
      if (fe.length) return fe[0]!;
      return item.note || none; // JSON 但无可提取数组（如 type-consistency 只有计数）
    }
  }
  // 策展 tail：跳过 parseToolOutput 的 'warns_list:' 头部行，剥 '- ' 列表前缀
  const lines = (item.tail || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l !== "warns_list:");
  if (lines.length) {
    const l = lines[0]!;
    return l.startsWith("- ") ? l.slice(2) : l;
  }
  if (item.raw) {
    const fe = firstErrors(item.raw, 1);
    if (fe.length) return fe[0]!;
  }
  return item.note || none;
}

/** 单行截断（防超长错误撑爆 25 行预算）。 */
function truncate(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 渲染 FAIL 摘要（样式 C，纯函数）——AI 只看尾部 ~25 行也能决策：
 *   [FAIL][存量债] node scripts/x.ts --json  16/20 通过 2.3s  errors=3
 *       → 知识卡 animation-system.md 的 source_files 引用不存在: x.js
 *       复现: node scripts/x.ts --json
 * @param item         单条检查结果（raw 优先作详情源）
 * @param passCount    已通过项数（整体进度）
 * @param total        总项数
 * @param attributable hard 失败是否可归因于本次变更（push/files=true；全扫=false）
 */
export function formatFailSummary(
  item: GateResultItem,
  passCount: number,
  total: number,
  attributable = true,
): string {
  const tag = policyTag(item.blockPolicy, attributable);
  const head = `[FAIL][${tag}] ${item.label}  ${passCount}/${total} 通过 ${(item.time / 1000).toFixed(1)}s  ${item.note || ""}`;
  const body = `\n      → ${truncate(firstErrorLine(item))}`;
  const tail = `\n      复现: ${item.label}`;
  return `${head}${body}${tail}`;
}

/** 报告文件固定前缀（.git 下不被 git 跟踪）。 */
export function reportPathFor(ts: string): string {
  return path.join(ROOT, ".git", `gate-report-${ts}.json`);
}

/**
 * 完整运行过程落盘（结构化 JSON，无行数限制）。
 * @param results 全部检查结果（含 OK）
 * @param meta    模式/结论/退出码等元信息
 * @returns 报告文件路径；写入失败返回 null（不阻断门禁）
 */
export function writeGateReport(
  results: GateResultItem[],
  meta: { mode: string; blocked: boolean; domainSummary: string },
): string | null {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const p = reportPathFor(ts);
    const payload = {
      ts,
      mode: meta.mode,
      blocked: meta.blocked,
      domainSummary: meta.domainSummary,
      total: results.length,
      pass: results.filter((r) => r.ok).length,
      fail: results.filter((r) => !r.ok).length,
      results,
    };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), "utf-8");
    return p;
  } catch {
    return null; // 报告写入失败不阻断门禁
  }
}
