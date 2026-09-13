#!/usr/bin/env node
/**
 * static-tools.ts — 静态工具清单执行器（pre-push-gate 域块，ADR-206 阶段 2）。
 *
 * 从 pre-push-gate.ts 的 main 闭包里搬出两段「按清单跑静态检查」的执行器：
 *   - runTools(ctx, tools)    通用清单执行器（--all / --docs / 按域补挂三处共用）
 *   - runScopedDocDrift(ctx)  知识卡 / 文档漂移的 --files 裁剪执行器
 *
 * 为什么值得单独成模块：两段合计约 120 行，却承载 4 处极易漂移的判定细节——
 *   `_summary` 判定优先级（委托 gate-parse.parseToolOutput）、gen 产物 autoFix 重验、
 *   scopedFiles 的数组式传参（绕 cmd 8K 墙）、scoped 时 note 的裁剪范围标注。
 * 它们混在 main 的域调度里时，改一处需通读全部域块；搬出后 pre-push-gate 只管
 * 「何时跑」，本模块管「怎么跑」。
 *
 * record 行为像素级不变（label / note / tail / raw / blockPolicy / time 原样），
 * 由三模式 dry-run baseline diff 守护（ADR-206 §3）。搬移期唯一实质改动：
 * autoFix 重验的 parseToolOutput 补回 tool 入参——此前漏传，解析失败的 note 会
 * 丢失工具名，与首轮调用口径不一致。
 *
 * 依赖：node:child_process（经 GateCtx 的 sh/shAsync）/ _lib/proc（数组式 procRun）
 *       / _lib/gate-parse / _lib/gate-config / _lib/gate-ctx / _lib/scan-files
 *
 * 用法：
 *   import { runTools, runScopedDocDrift } from "./gate-blocks/static-tools.ts";
 *   runTools(ctx, FRONTEND_STATIC_TOOLS);
 *
 * 退出码：本模块无独立 CLI（被 pre-push-gate.ts import）。
 *
 * 设计意图：让「静态工具怎么跑」成为可单测单元，把 main 的域调度层与工具执行层解耦
 * ——ADR-206 的目标态（pre-push-gate 只留 ~400 行调度骨架）。
 */
import type { GateTool } from "../gate-config.ts";
import { type ExecResult, GATE_TIMEOUT_MS, type GateCtx } from "../gate-ctx.ts";
import { parseToolOutput } from "../gate-parse.ts";
import { run as procRun } from "../proc.ts";
import { ROOT } from "../scan-files.ts";

/**
 * 按清单串行执行静态工具，逐条 record。
 *
 * 刻意不并行（ADR-088 实证回退）：并行版 2m15s vs 串行基线 75s——spawn 开销吃掉
 * sub-second 工具的并行收益。域间并行（Go ∥ 前端）保留在 pre-push-gate 调度层，
 * 静态工具段一律串行。
 */
export function runTools(ctx: GateCtx, tools: readonly GateTool[]): void {
  for (const entry of tools) {
    const tool = entry.tool;
    const extraArgs = entry.args || [];
    // 解法 C：gen-*.ts 自动继承 autoFix=true（命名约定驱动）
    // 显式声明 autoFix 优先；否则按 tool.startsWith('gen-') 判定
    const effectiveAutoFix = entry.autoFix ?? tool.startsWith("gen-");
    // 文件驱动模式（commit-with-check 等）下，check-go-diff-coverage 必须按
    // --staged 只查本次暂存区——否则回退 base=origin/main 全库 diff，把
    // origin/main 之后所有未推送改动（含并行会话提交）误算进本次覆盖门禁，
    // 纯签名重构会被误报 0% 阻断（ADR-145 实践实证）。push 模式 files 为空，
    // 不加 --staged，保持全库比对（推送时本就该查全部待推改动）。
    const stagedArg =
      ctx.files.length > 0 && tool === "check-go-diff-coverage.ts" ? "--staged" : "";
    // 增量裁剪通道（2026-09-13）：清单里声明 scopedFiles:true 的工具改用数组式 procRun
    // 传 `--files <本次变更文件集>`。两个理由，缺一不可：
    //   1. 防存量债淹没：check-complexity / check-params / check-type-safety 是全库阈值型，
    //      未触碰文件的既有命中（complexity 301 条 / params 54 条）会把每次推送刷成全红。
    //   2. 数组式（shell:false）：--files 换行大列表经 shell:true 会撞 cmd.exe 8191 上限
    //      （check-redlines 同款注释，ADR-129 实证），procRun 数组直传走 Windows
    //      CreateProcess 32767 上限。脚本侧按自身 --scope 过滤非本域文件（传全量变更集
    //      即可，无需在 gate 侧做域判定——改纯 Go/文档时 matched=0 → 合法 PASS）。
    // --all / --docs 模式 files 为空 → scoped=false，退回全库（向后兼容）。
    const scoped = entry.scopedFiles === true && ctx.files.length > 0;
    const invoke = (extra: string[]): ExecResult => {
      if (scoped) {
        const rr = procRun(
          "node",
          [
            `scripts/${tool}`,
            "--json",
            ...(stagedArg ? [stagedArg] : []),
            ...extra,
            "--files",
            ctx.files.join("\n"),
          ],
          { cwd: ROOT, timeout: GATE_TIMEOUT_MS },
        );
        return { rc: rr.rc, out: rr.out || rr.err || "" };
      }
      return ctx.sh(`node scripts/${tool} --json ${stagedArg} ${extra.join(" ")}`);
    };
    const t0 = Date.now();
    const r = invoke(extraArgs);
    // P1 修复（2026-08-17）：审计类工具退出码不可靠（i18n/孤儿/命名/卫生默认恒 0），
    // 必须解析 --json 的 _summary 判定——与文件头「不得依赖退出码」契约对齐。
    // 判定语义收敛到 _lib/gate-parse.ts（parseToolOutput，契约测试锁死）：
    //   _summary.ok → errors===0 → 退回 rc；解析失败 note 明示非 JSON 回退。
    const parsed = parseToolOutput(r.out, r.rc, tool);
    let ok = parsed.ok;
    let note = parsed.note;
    const tail = parsed.tail;
    // autoFix（2026-08-23 用户诉求"gen 产物老要 AI 手打刷新"）：--check FAIL 的
    // gen 产物工具自动跑写盘版刷新后重验——修"提交间隙 gen 产物过期 → doctor FAIL"
    // 的鸡生蛋（pre-commit 只在提交时跑 gen；间隙跑 doctor 需手打对应 gen 脚本）
    // ⚠️ autoFix 写盘语义契约（ADR-234）：此处是 pre-push-gate 里
    // **唯一会写仓库文件**的执行点——gen 脚本 FAIL 时写盘刷新产物后重验。
    //   1. 刻意不受 --dry-run 限制：commit-with-check 走 --files --dry-run，
    //      gen 产物过期若不刷新会阻断提交流（pre-commit 的 GEN_CMDS 兜底在提交阶段，
    //      来不及救本次 gate 判定）；「dry-run 只检查不修改」的契约仅指 gofmt/仓库源码，
    //      不含 gen 产物刷新
    //   2. 写盘发生在 pre-push 钩子内，被推送的 oid 是钩子调用前的快照——刷新产物
    //      **不进入本次推送**，属预期行为（随下次 commit/push 进入变更集）；
    //      钩子内严禁 amend / git add（见 pre-push-gate.ts 头部已知坑：amend 致 oid 分叉）
    //   3. push 后工作树 gen 产物呈脏态 = autoFix 已工作的正常痕迹，勿当作回归修复
    if (!ok && effectiveAutoFix) {
      const fixR = ctx.sh(`node scripts/${tool} --json`); // 写盘刷新（无 --check）
      if (fixR.rc === 0) {
        const re = invoke(extraArgs);
        // tool 入参不可省：解析失败时 note 靠它标明是哪个工具在退化（阶段 2 补齐）。
        const reOk = parseToolOutput(re.out, re.rc, tool).ok;
        if (reOk) {
          ok = true;
          note = `autoFix: node scripts/${tool} 已自动刷新`;
        } else {
          note = note
            ? `${note}（autoFix 已尝试但仍 FAIL）`
            : `node scripts/${tool} autoFix 已尝试但仍 FAIL`;
        }
      }
    }
    if (scoped) {
      // note 追加裁剪范围：_summary 的 errors 是「本次变更文件内」的命中数，
      // 不带范围会与全库数字（301/54）混淆，AI 无法判断归因范围。
      const scopeNote = `--files 裁剪：本次变更 ${ctx.files.length} 文件`;
      note = note ? `${note}（${scopeNote}）` : scopeNote;
    }
    // label = 完整检查命令（AI 失败时可直接抄，无需翻文档找脚本名）。
    // scoped 时 label 沿用全扫命令（--files 是门禁内部裁剪机制，AI 手动复查直接全扫
    // 即可看到完整命中方向——同 runScopedDocDrift 口径）；范围信息落在上方 note。
    const cmdLabel = `node scripts/${tool} --json${stagedArg ? ` ${stagedArg}` : ""}${extraArgs.length ? ` ${extraArgs.join(" ")}` : ""}`;
    ctx.record(cmdLabel, ok, {
      time: Date.now() - t0,
      note,
      raw: r.out,
      // warns_list 摘要优先（FAIL 可读性）；否则回退原始输出尾部
      tail: !ok ? tail || r.out.trim().split("\n").slice(-12).join("\n") : "",
      blockPolicy: entry.blockPolicy,
    });
  }
}

/**
 * 文档漂移按 --files 裁剪执行器（与 check-redlines 同款数组式 procRun）。
 *
 * commit/push 文件驱动模式：仅校验本次变更知识卡，避免并行会话未跟踪草稿卡阻断本次提交。
 * doc-drift / knowledge-drift 默认全扫 docs/knowledge/，此处强制 --files 裁剪。
 * 数组式传参（shell:false）承载换行分隔的 --files 大列表（避开 cmd 8K 墙，见 check-redlines 注释）。
 */
export function runScopedDocDrift(ctx: GateCtx): void {
  if (ctx.files.length === 0) return;
  for (const tool of ["check-doc-drift.ts", "check-knowledge-drift.ts"]) {
    const t0 = Date.now();
    const r = procRun("node", [`scripts/${tool}`, "--json", "--files", ctx.files.join("\n")], {
      cwd: ROOT,
      timeout: GATE_TIMEOUT_MS,
    });
    const out = r.out || r.err || "";
    const parsed = parseToolOutput(out, r.rc, tool);
    const ok = parsed.ok;
    const note = parsed.note;
    // doc-drift/knowledge-drift 无 warns_list 契约，统一回退原始输出尾部
    const tail = !ok ? out.trim().split("\n").slice(-12).join("\n") : "";
    // label = 完整命令（--files 为内部裁剪机制，AI 手动复查时直接全扫即可）
    ctx.record(`node scripts/${tool} --json`, ok, {
      time: Date.now() - t0,
      note,
      raw: out,
      tail: !ok ? tail : "",
    });
  }
}
