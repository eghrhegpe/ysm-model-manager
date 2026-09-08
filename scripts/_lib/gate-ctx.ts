/**
 * gate-ctx.ts — pre-push-gate 共享执行上下文（P0 收敛，ADR-206）。
 *
 * 把 pre-push-gate.ts 里散落在 main 闭包内的执行管道收拢为唯一 `GateCtx`：
 *   - record() 闭包工厂（统一结果收集 + blocked 阻断标记）
 *   - sh / shAsync / git / gofmtCheck 原始 exec 助手
 *   - plan / byDomain / files / push refs 跨域共享态
 *
 * 域块（gate-blocks/*）不再直连 main 局部变量，一律经 ctx 传入，
 * 终结"改一处要通读上千行 main"的神对象问题（锐评 P0）。
 * 本模块无顶层副作用（不读 stdin、不跑 main），契约测试可安全 import。
 *
 * 依赖：node:child_process / _lib/proc / _lib/scan-files / _lib/domain-classify
 */
import { spawn } from "node:child_process";
import type { Plan } from "./domain-classify.ts";
import { run as procRun, shq } from "./proc.ts";
import { ROOT } from "./scan-files.ts";

const TIMEOUT = 300_000;

/** 纯命令执行结果。 */
export interface ExecResult {
  rc: number;
  out: string;
}

/** record() 推入 results 的单条结果（与 writeGateReport 消费形状对齐）。 */
export interface GateResult {
  label: string;
  ok: boolean;
  time: number;
  note: string;
  tail: string;
  // 显式 | undefined：exactOptionalPropertyTypes 下 record() 的 rawCapped（string|undefined）
  // 直接赋给 raw? 会报 TS2379
  raw?: string | undefined;
}

/** record() 的可选参数。 */
export interface RecordOpts {
  time?: number;
  note?: string;
  tail?: string;
  raw?: string;
  blockPolicy?: "hard" | "debt" | "failClosed";
}

/** pre-push-gate 共享执行上下文。 */
export interface GateCtx {
  plan: Plan;
  byDomain: Record<string, string[]>;
  files: string[]; // 本次变更文件集（--files / push 模式填充；--all / --docs 为空）
  pushLocalRef: string;
  pushLocalOid: string;
  pushRemoteOid: string;
  results: GateResult[];
  /** 活值 getter：反映 record()/setBlocked() 的最新阻断状态（值快照会恒 false → fail-open）。 */
  readonly blocked: boolean;
  /** 供 failClosed 特例（如 redlines scanHealthy=false）在 record 外置阻断。 */
  setBlocked(v: boolean): void;
  record(label: string, ok: boolean, opts?: RecordOpts): void;
  sh(cmd: string, opts?: { cwd?: string; timeout?: number }): ExecResult;
  shAsync(cmd: string, opts?: { cwd?: string; timeout?: number }): Promise<ExecResult>;
  git(args: string[], opts?: { cwd?: string }): { rc: number; out: string };
  gofmtCheck(goFiles: string[]): string[];
}

/** 创建 GateCtx（exec 助手 + record + 共享态）。init 无默认——由 main 组装后注入。 */
export function createGateCtx(init: {
  plan: Plan;
  byDomain: Record<string, string[]>;
  files: string[];
  pushLocalRef: string;
  pushLocalOid: string;
  pushRemoteOid: string;
}): GateCtx {
  const results: GateResult[] = [];
  let blocked = false;

  const sh = (cmd: string, { cwd = ROOT, timeout = TIMEOUT } = {}): ExecResult => {
    // shell 执行命令（win32 兼容 .cmd）；统一委托 _lib/proc.ts（超时/错误分类契约）。
    // out 回退 err：ENOENT/超时诊断在 r.err，空 out 时保留原因（P3 复核）。
    const r = procRun(cmd, [], { cwd, timeout, shell: true });
    return { rc: r.rc, out: r.out || r.err || "" };
  };

  const shAsync = (cmd: string, { cwd = ROOT, timeout = TIMEOUT } = {}): Promise<ExecResult> =>
    new Promise((resolve) => {
      const child = spawn(cmd, [], {
        cwd,
        shell: true,
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
      });
      // 输出上限：超限停止追加（尾部保留），与 record() 的 64KB raw cap 同纪律，
      // 防 go test/vite 级刷屏输出在 gate 进程内无界膨胀。
      const OUT_CAP = 1 << 20; // 1MB
      let buf = "";
      let capped = false;
      child.stdout.on("data", (d) => {
        if (buf.length < OUT_CAP) buf += d.toString();
        else capped = true;
      });
      child.stderr.on("data", (d) => {
        if (buf.length < OUT_CAP) buf += d.toString();
        else capped = true;
      });
      child.on("close", (code) =>
        resolve({ rc: code ?? -1, out: capped ? `${buf}\n…(输出超 1MB 截断)` : buf }),
      );
      child.on("error", (err) => resolve({ rc: -1, out: err.message }));
    });

  const git = (args: string[], { cwd = ROOT } = {}) => {
    // core.quotepath=false：非 ASCII 文件名输出原始 UTF-8，避免引号/八进制转义破坏域匹配。
    // 数组参数直走 procRun（无 shell 拼接）：git ref 允许 $/`/;/| 等元字符，
    // 拼字符串后交 sh() 经 shell 执行会构成命令注入（pre-push stdin 的 localRef 可被攻击者控制）。
    const r = procRun("git", ["-c", "core.quotepath=false", ...args], { cwd });
    return { rc: r.ok ? 0 : r.rc, out: r.out || "" };
  };

  const record = (label: string, ok: boolean, opts: RecordOpts = {}) => {
    const { time = 0, note = "", tail = "", raw, blockPolicy } = opts;
    // raw cap 64KB 尾部：防超大输出（go test/vite）撑爆报告；JSON 检查输出远小于此不 overwrite。
    const rawCapped =
      raw === undefined ? undefined : raw.length > 65536 ? `\u2026${raw.slice(-65536)}` : raw;
    results.push({ label, ok, time, note, tail, raw: rawCapped });
    if (!ok && blockPolicy !== "debt" && blockPolicy !== "failClosed") blocked = true;
  };

  const gofmtCheck = (goFiles: string[]): string[] => {
    // 空列表早退：裸 `gofmt -l`（无文件参数）会读 stdin，gate 可能挂死到超时。
    if (goFiles.length === 0) return [];
    // gofmt -l 只读检出未格式化文件（不修改）。修复由 pre-commit 提交时自动完成；
    // 此处仍检出说明提交绕过了 pre-commit（--no-verify 等），阻断并提示手动修复。
    return sh(`gofmt -l ${goFiles.map(shq).join(" ")}`)
      .out.trim()
      .split("\n")
      .filter((f) => f.endsWith(".go"));
  };

  return {
    ...init,
    results,
    // 活值 getter（P1 修复）：`blocked,` 值快照在创建时拷贝 false，此后 record()/setBlocked()
    // 只改闭包变量，消费者读 ctx.blocked 永远 false → 失败检查静默放行（fail-open）。
    get blocked() {
      return blocked;
    },
    setBlocked: (v: boolean) => (blocked = v),
    record,
    sh,
    shAsync,
    git,
    gofmtCheck,
  };
}
