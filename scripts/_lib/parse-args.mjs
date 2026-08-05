/**
 * parse-args.mjs
 * 统一参数解析 —— 零依赖，为 scripts/*.mjs 消除重复的 argv 手写解析。
 *
 * 用法：
 *   import { parseArgs } from './_lib/parse-args.mjs';
 *
 *   const args = parseArgs(process.argv.slice(2), {
 *     bools: ['check', 'json', 'strict'],
 *     strings: ['scope', 'format', 'file'],
 *     defaults: { format: 'mermaid', scope: null },
 *   });
 *   // → { _: [], check: false, json: false, strict: false, format: 'mermaid', scope: null, file: null }
 *
 *   位置参数（无前缀的裸参数）收集在 `_` 数组中。
 *   未知参数或缺少值的 value flag 会输出 stderr 警告，不清除 $exit。
 */
export function parseArgs(argv, { bools = [], strings = [], defaults = {} } = {}) {
  const result = { _: [], ...defaults };

  // 预填 bools/strings 默认值
  for (const k of bools) if (!(k in result)) result[k] = false;
  for (const k of strings) if (!(k in result)) result[k] = null;

  const known = new Set([...bools, ...strings]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || arg === '--') {
      // 位置参数（-- 作为分隔符，后续所有参数均为位置参数）
      result._.push(arg);
      if (arg === '--') {
        // 把剩余所有参数都当作位置参数
        for (let j = i + 1; j < argv.length; j++) result._.push(argv[j]);
        break;
      }
      continue;
    }

    const name = arg.slice(2);
    const isBool = bools.includes(name);
    const isString = strings.includes(name);

    if (!known.has(name)) {
      console.warn(`⚠️  未知参数: --${name}`);
      continue;
    }

    if (isBool) {
      result[name] = true;
    } else if (isString) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
        console.warn(`⚠️  参数 --${name} 缺少值，使用默认值: ${JSON.stringify(result[name])}`);
        continue;
      }
      result[name] = argv[++i];
    }
  }

  return result;
}
