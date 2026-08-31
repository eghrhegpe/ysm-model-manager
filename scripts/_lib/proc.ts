/**
 * proc.ts — 统一子进程执行封装（跨平台、超时、错误分类、cwd 约定）。
 *
 * 背景（ADR-043 / 18 轮 mjs 审核实证）：各脚本内联 execFileSync 反复踩同样的坑——
 *   - Windows MSYS 吞反斜杠（doctor grep 假绿）、cmd.exe 解析 `2>/dev/null` 出错；
 *   - npx/tsc 无扩展名 shim 需 shell:true（cmd.exe），原生可执行文件则不应 shell；
 *   - cwd 缺省按调用方 process.cwd() 解析相对路径（ripgrep P2：非 ROOT 目录扫错树）；
 *   - 错误分类混乱：ENOENT / status 1（无匹配）/ 超时 / 真实失败 混为一谈。
 * 本库统一收敛：超时 + 错误分类 + shell 策略 + cwd 约定，消灭各自内联。
 *
 * 用法：
 *   import { run, runSafe, shq } from './_lib/proc.ts';
 *   const r = run('git', ['status', '--short'], { cwd: ROOT });
 *   const hits = runSafe('rg', [...], { cwd: ROOT });
 */
import { execFileSync, type ExecFileSyncOptions, type StdioOptions } from 'node:child_process';

/** 默认超时：30s（长任务显式覆盖）。 */
export const DEFAULT_TIMEOUT = 30_000;
/** 默认 stdout 缓冲上限（64MB，与 ripgrep.ts 既有契约一致）。 */
export const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * 子进程执行结果。
 * - ok=true  rc=0（或 allowExit1 且 rc=1）
 * - ok=false rc=-1 = ENOENT；rc=-2 = 超时；其他 = 实际退出码
 */
export interface ProcResult {
  /** 是否成功执行 */
  ok: boolean;
  /** 退出码：0 成功；1 allowExit1；-1 ENOENT；-2 超时 */
  rc: number;
  /** stdout 内容（合并模式全量；stdio='inherit' 时为空串） */
  out: string;
  /** 失败原因（可选，ok=true 时不设置） */
  err?: string;
}

/**
 * 运行子进程（数组参数，无 shell 拼接），返回归一化结果。
 * @param bin 可执行文件名（git / go / node / rg / gofmt 等）
 * @param args 参数数组（原始值，不拼 shell）
 * @param opts 选项
 */
export function run(
  bin: string,
  args: string[],
  {
    cwd = process.cwd(),
    timeout = DEFAULT_TIMEOUT,
    shell = false,
    allowExit1 = false,
    maxBuffer = DEFAULT_MAX_BUFFER,
    env,
    stdio,
    mergeStderr = true,
  }: {
    cwd?: string;
    timeout?: number;
    shell?: boolean;
    allowExit1?: boolean;
    maxBuffer?: number;
    env?: NodeJS.ProcessEnv;
    stdio?: StdioOptions;
    mergeStderr?: boolean;
  } = {},
): ProcResult {
  const o: ExecFileSyncOptions = { cwd, encoding: 'utf-8', timeout, maxBuffer };
  // 显式 shell:true 时按平台选 shell（win32 自动 cmd.exe / POSIX 自动 /bin/sh），
  // 承载管道/重定向命令（pre-push-gate sh()）；默认无 shell，避免 cmd.exe 找不到
  // Git Bash 工具（doctor run() 实证）与 `2>/dev/null` 类 POSIX 重定向被 cmd.exe 误解析
  if (shell) o.shell = true;
  if (env) o.env = { ...process.env, ...env };
  // stdio 透传：默认缺省 = pipe 捕获 out；
  // commit-with-check 委托 pre-push-gate 需 inherit 实时透传门禁输出
  if (stdio) o.stdio = stdio;
  try {
    const stdout = execFileSync(bin, args, o);
    return { ok: true, rc: 0, out: (stdio && stdio !== 'pipe') ? '' : String(stdout) };
  } catch (e: unknown) {
    const err = e as Error & { status?: number; code?: string; killed?: boolean; stdout?: string | Buffer; stderr?: string | Buffer };
    if (err.code === 'ENOENT') {
      return { ok: false, rc: -1, out: '', err: `command not found: ${bin}` };
    }
    // mergeStderr=false：失败时 out 仅 stdout（JSON 消费方语义，perf-gate/gui-flow-gate
    // 需要 stdout-only 的 JSON 响应，stderr 多为 watcher/编译噪音会污染 JSON.parse）
    const out = mergeStderr
      ? String(String(err.stdout || '') + String(err.stderr || ''))
      : String(err.stdout || '');
    const stderrText = mergeStderr ? '' : String(err.stderr || '');
    // 超时判定：POSIX 抛 e.killed=true；Windows 抛 code='ETIMEDOUT'
    if (err.killed || err.code === 'ETIMEDOUT') {
      const timeoutMsg = `command timed out after ${timeout}ms: ${bin} ${args.join(' ')}`;
      return {
        ok: false,
        rc: -2,
        out,
        err: stderrText ? `${timeoutMsg}\n${stderrText}` : timeoutMsg,
      };
    }
    if (err.status === 1 && allowExit1) {
      return { ok: true, rc: 1, out };
    }
    const errMsg = `${bin} 执行失败（rc=${err.status ?? 'unknown'}）`;
    return {
      ok: false,
      rc: err.status ?? -1,
      out,
      err: stderrText ? `${errMsg}\n${stderrText}` : errMsg,
    };
  }
}

/**
 * 容错版 run：失败打 stderr WARN 并返回空串（供「恒 exit 0」的提示工具用）。
 */
export function runSafe(bin: string, args: string[], opts?: Parameters<typeof run>[2]): string {
  const r = run(bin, args, opts);
  if (r.ok) return r.out;
  console.error(`[warn] ${bin} 执行跳过（${r.err || '未知失败'}）`);
  return '';
}

/** Windows 兼容的文件名转义（cmd.exe 双引号包裹；POSIX 用单引号）。 */
export function shq(s: string): string {
  const str = String(s);
  if (process.platform === 'win32') return `"${str.replace(/"/g, '""')}"`;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}
