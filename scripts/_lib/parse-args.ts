/**
 * parse-args.ts
 * 统一参数解析 —— 零依赖，为 scripts/*.mjs 消除重复的 argv 手写解析。
 *
 * 用法：
 *   import { parseArgs } from './_lib/parse-args.ts';
 *
 *   const args = parseArgs(process.argv.slice(2), {
 *     bools: ['check', 'json', 'strict'],
 *     strings: ['scope', 'format', 'file'],
 *     defaults: { format: 'mermaid', scope: null },
 *   });
 *   // → { _: [], check: false, json: false, strict: false, format: 'mermaid', scope: null, file: null, unknown: [], help: false }
 *
 *   位置参数（无前缀的裸参数）收集在 `_` 数组中。
 *   未知参数收集在 `unknown` 数组（调用方应据此白名单拦截、退 1，对齐致命陷阱 #12）；
 *   `--help` / `-h` 置 help=true（调用方退 0）。
 *   未知参数或缺少值的 value flag 会输出 stderr 警告，不改变退出码。
 */
/** 解析结果：位置参数 `_` / 未知参数 unknown / help 标志 + 动态 flag 值（索引签名）。 */
export interface ParseArgsResult {
  _: string[];
  unknown: string[];
  help: boolean;
  [key: string]: unknown;
}

export function parseArgs(
  argv: string[] = [],
  {
    bools = [],
    strings = [],
    arrays = [],
    defaults = {},
  }: { bools?: string[]; strings?: string[]; arrays?: string[]; defaults?: Record<string, unknown> } = {},
): ParseArgsResult {
  const result: ParseArgsResult = { _: [], ...defaults, unknown: [], help: false };

  // 预填 bools/strings/arrays 默认值
  for (const k of bools) if (!(k in result)) result[k] = false;
  for (const k of strings) if (!(k in result)) result[k] = null;
  for (const k of arrays) if (!(k in result)) result[k] = [];

  const known = new Set([...bools, ...strings, ...arrays]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // P2（code_review）：--help / -h 显式支持，不再被当未知参数/位置参数
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (!arg.startsWith("--") || arg === "--") {
      // 位置参数（-- 作为分隔符，后续所有参数均为位置参数）
      result._.push(arg);
      if (arg === "--") {
        // 把剩余所有参数都当作位置参数
        for (let j = i + 1; j < argv.length; j++) result._.push(argv[j]!);
        break;
      }
      continue;
    }

    // P2（code_review）：支持 `--flag=value`（--dir=X / --check=false）——
    // 此前 name='dir=X' 被当未知参数丢弃，连值一起丢
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const isBool = bools.includes(name);
    const isString = strings.includes(name);
    const isArray = arrays.includes(name);

    if (!known.has(name)) {
      // P1（code_review）：未知 flag 记录到 unknown 数组（调用方白名单拦截、退 1，
      // 对齐陷阱 #12）——此前仅 warn，消费方无法检测，--checkk 拼错会照常写盘
      result.unknown.push(`--${name}`);
      console.warn(`⚠️  未知参数: --${name}`);
      continue;
    }

    if (isBool) {
      if (inline === undefined) result[name] = true;
      else result[name] = /^(1|true|yes)$/i.test(inline); // --check=false → false（P2）
    } else if (isArray) {
      // arrays 多值 flag（R5，2026-09-08）：收集后续所有非 `--` 开头参数到数组，
      // 支持内联 `--files=a,b,c`（push 原样，调用方自定分隔）。值不进位置参数 `_`。
      if (inline !== undefined) {
        (result[name] as string[]).push(inline);
        continue;
      }
      // 截断条件 = 任意 `-` 前缀（对齐迁移前 commit-with-check 手写解析的旧契约）：
      // 只截 `--` 会把单横杠 flag（`--files a -m msg` 的 `-m`/`msg`）吞进数组，
      // -m 兼容 shim 取不到值 → 合法调用回归成 usage error（code_review P1）
      while (i + 1 < argv.length && !argv[i + 1]?.startsWith("-")) {
        (result[name] as string[]).push(argv[++i]!);
      }
    } else if (isString) {
      if (inline !== undefined) {
        result[name] = inline;
        continue;
      } // --dir=X（P2）
      if (i + 1 >= argv.length || argv[i + 1]?.startsWith("--")) {
        console.warn(`⚠️  参数 --${name} 缺少值，使用默认值: ${JSON.stringify(result[name])}`);
        continue;
      }
      result[name] = argv[++i];
    }
  }

  return result;
}
