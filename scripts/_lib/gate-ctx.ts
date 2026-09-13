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
import { run as procRun } from "./proc.ts";
import { ROOT } from "./scan-files.ts";

/**
 * 门禁子进程统一超时（5 分钟）。**单一事实源**（ADR-206 阶段 2）：本模块的 sh/shAsync
 * 默认值与 gate-blocks/* 里数组式 procRun 的调用共用，避免 `300_000` 在
 * pre-push-gate / gate-ctx / 各域块各存一份、改一处漏三处。
 */
export const GATE_TIMEOUT_MS = 300_000;
const TIMEOUT = GATE_TIMEOUT_MS;
/** sh/shAsync 共用的输出尾部上限（2026-09-13 对齐，锐评 P2 #5）：错误诊断集中在末尾，保尾部。 */
const OUT_CAP = 1 << 20; // 1MB

/** 纯命令执行结果。 */
export interface ExecResult {
  rc: number;
  out: string;
  /**
   * 是否因超时被终止（2026-09-13）。spawn 的 timeout 触发后进程被 SIGTERM 杀死，
   * close 事件的 code 为 null——与「命令真跑了但返回非零」不可区分，调用方会把它
   * 误报成编译/测试失败。置 true 时 out 已追加超时原因（tail 可见）。
   */
  timedOut?: boolean;
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
  /**
   * 阻断策略，**必须落库**——gate-report.policyTag() 靠它区分 FAIL 明细的归属标签
   * （debt→存量债 / failClosed→失守 / hard→本次引入｜待归因）。2026-09-13 修复：
   * 此前只用于判定 blocked 而不存入 results，导致 policyTag 读到 undefined，
   * 所有 FAIL（含 debt 存量债）在明细里一律显示「本次引入」，误导 AI 归因。
   *
   * 显式 `| undefined`：record() 的 opts.blockPolicy 本身就可能是 undefined
   * （调用方未声明策略），exactOptionalPropertyTypes 下不能赋给裸 `?` 字段。
   */
  blockPolicy?: "hard" | "debt" | "failClosed" | undefined;
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
    //
    // ⚠️ 不变式（2026-09-13，锐评 P1）：shell:true 使本函数每条命令都过 cmd.exe 解析。
    // **禁止把任何运行期用户可控字符串（stdin ref、文件路径、CLI 参数）传入本函数**——
    // 那类输入必须走数组式 procRun（见 git() 注释）。本函数只接受 gate 源码内的
    // 开发者常量命令（go test && ...、npx vite build 等需 shell 链接/.cmd 解析的场景）。
    // 违反此界线的先例是旧版 gofmtCheck（已数组化）；新增「含外部输入」的执行一律数组化。
    // 调用点合规由 tests/test_gate_sh_invariants.ts 锁死（禁插值 push-stdin 派生标识符
    // + 动态命令冻结清单），把本注释不变式从「人自觉」升级为「可执行契约」（锐评 P1 #4）。
    const r = procRun(cmd, [], { cwd, timeout, shell: true });
    // 与 shAsync 语义对齐（2026-09-13 锐评 P2 #5）：同一 ExecResult 契约，同步/异步两条
    // exec 路径不得漂移——① procRun 超时分类 rc=-2 透传为 timedOut=true + 原因追加进 out
    // （超时被杀不得与「编译 FAIL」同形）；② 输出 1MB 尾部 cap 同 shAsync 纪律。
    const timedOut = r.rc === -2;
    let out = r.out || r.err || "";
    if (out.length > OUT_CAP) out = `…${out.slice(-OUT_CAP)}`;
    if (timedOut) out += `\n[gate] 命令超时被终止（timeout=${timeout}ms）`;
    return { rc: r.rc, out, timedOut };
  };

  const shAsync = (cmd: string, { cwd = ROOT, timeout = TIMEOUT } = {}): Promise<ExecResult> =>
    new Promise((resolve) => {
      const child = spawn(cmd, [], {
        cwd,
        shell: true,
        // 不用 spawn 自带的 timeout 选项：它是否 emit 'timeout' 事件跨 Node 版本不一致，
        // 而超时标记是本函数的契约（见 ExecResult.timedOut）。自管计时器行为完全确定。
        stdio: ["ignore", "pipe", "pipe"],
      });
      // 输出上限：滚动尾部保留——超限从头裁剪，只留最后 1MB（OUT_CAP 见模块头，与 sh 同源）；
      // 编译/测试的关键报错集中在输出末尾，保头部会吞掉真正诊断信息。
      let buf = "";
      const append = (d: Buffer) => {
        buf += d.toString();
        if (buf.length > OUT_CAP) buf = "…" + buf.slice(-OUT_CAP);
      };
      // 超时态（2026-09-13）：超时被杀的子进程 close code 为 null——与「命令跑了但 FAIL」
      // 退化为同一形状（rc=-1/非零）。记 timedOut 并把原因追加进 out，使 FAIL 明细的
      // tail 能明示「超时」而非冒充编译错误。
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("close", (code) => {
        clearTimeout(timer);
        const tailNote = buf.startsWith("…") ? "\n(输出超 1MB，已保留尾部)" : "";
        const toNote = timedOut ? `\n[gate] 命令超时被终止（timeout=${timeout}ms）` : "";
        resolve({ rc: code ?? -1, out: buf + tailNote + toNote, timedOut });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          rc: -1,
          out: err.message,
          // spawn 本身失败（ENOENT 等）不算超时，但同样是「命令没跑成」——
          // 保留 timedOut=false，由调用方从 rc/out 诊断。
          timedOut: false,
        });
      });
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
    // blockPolicy 必须一并落库（2026-09-13 修复）：它不只是「是否阻断」的输入，
    // 更是 FAIL 明细归属标签的事实源（gate-report.policyTag 读 item.blockPolicy）。
    // 漏存 → debt 存量债在明细里被标成「本次引入」，误导 AI 把存量债当自己引入的回归。
    results.push({ label, ok, time, note, tail, raw: rawCapped, blockPolicy });
    if (!ok && blockPolicy !== "debt" && blockPolicy !== "failClosed") blocked = true;
  };

  const gofmtCheck = (goFiles: string[]): string[] => {
    // 空列表早退：裸 `gofmt -l`（无文件参数）会读 stdin，gate 可能挂死到超时。
    if (goFiles.length === 0) return [];
    // gofmt -l 只读检出未格式化文件（不修改）。修复由 pre-commit 提交时自动完成；
    // 此处仍检出说明提交绕过了 pre-commit（--no-verify 等），阻断并提示手动修复。
    // 数组式 procRun（2026-09-13，锐评 P1）：与 git() 同一安全哲学——文件路径不经
    // shell 拼接（旧版 sh(`gofmt -l ${shq(...)}`) 与「数组防注入」不变式在同一文件里分裂，
    // 是给后续 sh 调用方递梯子）。gofmt 是 Go 工具链二进制，无 .cmd 解析需求。
    const r = procRun("gofmt", ["-l", ...goFiles], { cwd: ROOT, timeout: TIMEOUT });
    // out 回退 err：与 sh() 同口径（ENOENT 等诊断在 err）——err 行不含 .go 后缀，
    // 过滤后仍为 []，与旧版 sh 路径行为等价（gofmt 缺失的假绿由 Go 域 go build 先行兜底）。
    return (r.out || r.err || "")
      .trim()
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
