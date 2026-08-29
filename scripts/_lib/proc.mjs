/**
 * proc.mjs — 统一子进程执行封装（跨平台、超时、错误分类、cwd 约定）。
 *
 * 背景（ADR-043 / 18 轮 mjs 审核实证）：各脚本内联 execFileSync 反复踩同样的坑——
 *   - Windows MSYS 吞反斜杠（doctor grep 假绿）、cmd.exe 解析 `2>/dev/null` 出错；
 *   - npx/tsc 无扩展名 shim 需 shell:true（cmd.exe），原生可执行文件则不应 shell；
 *   - cwd 缺省按调用方 process.cwd() 解析相对路径（ripgrep P2：非 ROOT 目录扫错树）；
 *   - 错误分类混乱：ENOENT / status 1（无匹配）/ 超时 / 真实失败 混为一谈。
 * 本库统一收敛：超时 + 错误分类 + shell 策略 + cwd 约定，消灭各自内联。
 *
 * 零依赖（仅 node:child_process / node:path）。
 *
 * 用法：
 *   import { run, runSafe } from './_lib/proc.mjs';
 *   const r = run('git', ['status', '--short'], { cwd: ROOT });   // → { ok, rc, out }
 *   const hits = runSafe('rg', [...], { cwd: ROOT });             // 失败返回 []（提示工具用）
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** 默认超时：30s（长任务显式覆盖）。 */
export const DEFAULT_TIMEOUT = 30_000;
/** 默认 stdout 缓冲上限（64MB，与 ripgrep.mjs 既有契约一致）。 */
export const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * 运行子进程（数组参数，无 shell 拼接），返回归一化结果。
 * @param {string} bin 可执行文件名（git / go / node / rg / gofmt 等）
 * @param {string[]} args 参数数组（原始值，不拼 shell）
 * @param {object} [opts]
 *   - cwd {string}            工作目录（默认 process.cwd()；建议显式传 ROOT）
 *   - timeout {number}        超时毫秒（默认 30s）
 *   - shell {boolean}         Windows 下经 cmd.exe 执行（npx/tsc 无扩展名 shim 必需；
 *                             原生 exe 留 false，避免 cmd.exe 找不到 Git Bash 工具）
 *   - allowExit1 {boolean}    允许退出码 1 视为成功（rg 无匹配 / knip 发现死代码等）
 *   - maxBuffer {number}      输出缓冲上限
 *   - env {object}            额外环境变量（合并覆盖 process.env）
 * @returns {{ ok: boolean, rc: number, out: string, err?: string }}
 *   ok=true  rc=0（或 allowExit1 且 rc=1）；ok=false 且 rc=-1 表示未执行成功（ENOENT/超时/异常）
 */
export function run(bin, args, { cwd = process.cwd(), timeout = DEFAULT_TIMEOUT, shell = false, allowExit1 = false, maxBuffer = DEFAULT_MAX_BUFFER, env, stdio } = {}) {
  const o = { cwd, encoding: 'utf-8', timeout, maxBuffer };
  // 显式 shell:true 时按平台选 shell（win32 自动 cmd.exe / POSIX 自动 /bin/sh），
  // 承载管道/重定向命令（pre-push-gate sh()）；默认无 shell，避免 cmd.exe 找不到
  // Git Bash 工具（doctor run() 实证）与 `2>/dev/null` 类 POSIX 重定向被 cmd.exe 误解析
  if (shell) o.shell = true;
  if (env) o.env = { ...process.env, ...env };
  // stdio 透传（'inherit'/'ignore'/'pipe' 等）：默认缺省 = pipe 捕获 out；
  // commit-with-check 委托 pre-push-gate 需 inherit 实时透传门禁输出（子代理锐评）。
  if (stdio) o.stdio = stdio;
  try {
    const stdout = execFileSync(bin, args, o);
    return { ok: true, rc: 0, out: stdio && stdio !== 'pipe' ? '' : String(stdout) };
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { ok: false, rc: -1, out: '', err: `command not found: ${bin}` };
    }
    const out = String((e.stdout || '') + (e.stderr || ''));
    if (e.killed) {
      return { ok: false, rc: -2, out, err: `command timed out after ${timeout}ms: ${bin} ${args.join(' ')}` };
    }
    if (e.status === 1 && allowExit1) {
      return { ok: true, rc: 1, out };
    }
    return { ok: false, rc: e.status ?? -1, out, err: `${bin} 执行失败（rc=${e.status ?? 'unknown'}）` };
  }
}

/**
 * 容错版 run：失败返回 []（供「恒 exit 0」的提示工具用，如 comment-checker/check-redlines）。
 * 注意：失败打 stderr WARN（ADR-043：不得静默假绿，仍能被用户/AI 察觉扫描不可用）。
 * @param {string} bin
 * @param {string[]} args
 * @param {object} [opts] 同 run()
 * @returns {string} 成功时 stdout；失败时 ''（并打印 WARN）
 */
export function runSafe(bin, args, opts = {}) {
  const r = run(bin, args, opts);
  if (r.ok) return r.out;
  console.error(`[warn] ${bin} 执行跳过（${r.err || '未知失败'}）`);
  return '';
}

/** Windows 兼容的文件名转义（cmd.exe 双引号包裹；POSIX 用单引号）。 */
export function shq(s) {
  const str = String(s);
  if (process.platform === 'win32') return `"${str.replace(/"/g, '""')}"`;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}
