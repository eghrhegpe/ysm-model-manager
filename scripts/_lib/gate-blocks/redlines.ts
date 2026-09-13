#!/usr/bin/env node
/**
 * redlines.ts — 治理红线门禁执行器（ADR-206 阶段 4，failClosed 特例隔离）。
 *
 * 从 pre-push-gate.ts 的 main 闭包搬出 check-redlines 段。它是全门禁里**唯一**走
 * 「三态」判定的块，故单独成模块而非并入 data-docs-domain：
 *
 *   ok=false + scanHealthy=true   → 有新增红线违规，属**债务**（不阻断，推送后处理）
 *   ok=false + scanHealthy=false  → 扫描本身没跑成（rg 缺失/执行失败）→ **必须阻断**
 *   解析失败                      → 同 failClosed（不许静默放行）
 *
 * 三条语义并存意味着 record 的 blockPolicy 只能是 failClosed（debt 语义不符，
 * hard 会把红线债务变成硬阻断）；「扫描不可用」这一条须由调用方在 record 之外
 * 用 `ctx.setBlocked(true)` 单独置位——这是 ADR-206 §2.4 明确保留的显式特例，
 * 不许塞进通用契约（redlines 的 scanHealthy 与菜单表的 `mz.ok === true` 语义不同）。
 *
 * 数组式 procRun（shell:false）不可改为 shell 拼串：`--files` 大列表（整目录搬家可达
 * 300+ 文件）经 shell:true 会超 cmd.exe 8191 上限，check-redlines 进程起不来 →
 * 被误判「输出解析失败」而 fail-closed 误阻断推送（2026-08-31 ADR-129 utils/3d →
 * preview-3d 实证）。数组直传走 Windows CreateProcess 32767 上限。
 *
 * record 行为像素级不变（label / note / tail / raw / blockPolicy / time 原样），
 * 由三模式 dry-run baseline diff 守护（ADR-206 §3）。
 *
 * 依赖：_lib/gate-ctx（GateCtx、GATE_TIMEOUT_MS）/ _lib/gate-parse（tryParseJson）
 *       / _lib/proc（数组式 procRun）/ _lib/scan-files（ROOT）
 *
 * 用法：
 *   import { runRedlines } from "./gate-blocks/redlines.ts";
 *   runRedlines(ctx); // 自行判定 ctx.plan.redlines
 *
 * 退出码：本模块无独立 CLI（被 pre-push-gate.ts import）。
 */
import { GATE_TIMEOUT_MS, type GateCtx } from "../gate-ctx.ts";
import { tryParseJson } from "../gate-parse.ts";
import { run as procRun } from "../proc.ts";
import { ROOT } from "../scan-files.ts";

/** 变更域过滤（--files）+ fail-closed 三态判定的红线检查。 */
/**
 * 可注入执行器（测试接缝，与 features→backend 的 `deps?.fn || 生产默认` 同形）。
 * 本模块直接调用模块级 `procRun`，若不开口则三态判定（健康/债务/不可用）只能靠
 * 「真的让 rg 缺失」来覆盖——不可测。开口后单测可注入合成输出，无需真实子进程。
 */
export interface RedlinesDeps {
  procRun?: typeof procRun;
}

export function runRedlines(ctx: GateCtx, deps: RedlinesDeps = {}): void {
  if (!ctx.plan.redlines) return;
  const exec = deps.procRun ?? procRun;
  const t0 = Date.now();
  // 变更域过滤（--files，2026-08-26）：文件驱动/push 模式把本次变更文件传给
  // check-redlines——仅「变更文件内」的违规计入新增阻断，仓库内其他文件既有债务
  // 不干扰当前提交（否则只改 Go/文档会被未提交 frontend 存量新增红线卡住）。
  // --all / --docs 模式 files 为空、不传 --files → 全库基线比对，向后兼容。
  // 数组参数直走 procRun（无 shell）——理由见文件头（cmd.exe 8K 墙）。
  const rlArgs = ["scripts/check-redlines.ts", "--json", "--baseline"];
  if (ctx.files.length) rlArgs.push("--files", ctx.files.join("\n"));
  const rlRaw = exec("node", rlArgs, { cwd: ROOT, timeout: GATE_TIMEOUT_MS });
  const rl = { rc: rlRaw.rc, out: rlRaw.out || rlRaw.err || "" };
  let newV = null,
    ok = false,
    scanHealthy = false,
    baseCount = 0,
    rlTail = "";
  // 特殊块：需要整对象（顶层 results 供 tail 展示 + _summary 判定），解析失败 → fail-closed 阻断
  const rlParsed = tryParseJson(rl.out) as { _summary?: any; results?: any[] } | null;
  if (rlParsed) {
    const s = rlParsed._summary;
    newV = s.newViolations ?? null;
    baseCount = s.baselineViolations ?? 0;
    ok = s.ok === true;
    // 扫描健康门（fail-closed）：rg 缺失/执行失败时 check-redlines 输出
    // scanHealthy:false——必须阻断推送，否则红线门禁静默放行（P1 修复）
    scanHealthy = s.scanHealthy === true;
    // 违规详情（供 tail 展示方向，不阻断推送）
    if (!ok && Array.isArray(rlParsed.results)) {
      rlTail = rlParsed.results
        .filter((r: any) => r.count > 0)
        .map(
          (r: any) =>
            `[${r.rule_id} ${r.name}] ` +
            r.violations.map((v: any) => `${v.file}:${v.line}`).join(", "),
        )
        .join("\n");
    }
  } else {
    /* parse fail */ ok = false;
    scanHealthy = false;
  }
  // 基线债务（红线新增）不阻断推送：推送后修；发布前全量 doctor 仍会报告（2026-08-13 决策）
  // failClosed：扫描本身不可用（rg 缺失/fail-closed）才阻断——由下方 !scanHealthy 兜底
  ctx.record("node scripts/check-redlines.ts --json --baseline", ok, {
    time: Date.now() - t0,
    raw: rl.out,
    blockPolicy: "failClosed",
    // note 顺序：newV===null 唯一标识 JSON parse 失败（rg 不可用时 newViolations
    // 非 null——runBaseline fail-closed 返回 allKeys），必须先于 scanHealthy 判定
    note:
      newV === null
        ? "输出解析失败——fail-closed 阻断，红线门禁未执行"
        : !scanHealthy
          ? "扫描不可用（rg 缺失/执行失败）——fail-closed 阻断，红线门禁未执行"
          : ok
            ? `红线零新增（基线 ${baseCount} 条）`
            : `${newV} 条新增红线违规（基线 ${baseCount} 条）——债务项，推送后处理`,
    tail: rlTail,
  });
  if (!scanHealthy) ctx.setBlocked(true);
}
