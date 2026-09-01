/**
 * _lib/deadcode-attrib.ts — 死代码/重复代码发现项归属（纯函数）。
 *
 * 设计：check-deadcode-baseline 的门禁按域裁剪——新增发现项只有落在
 * 「本次责任文件集」（staged / 未推送提交改动）内才阻断提交；
 * 他人遗留债务不拦路，由调用方自动收编进基线并留痕。
 * 责任集为 null = 无法归属（无 git 上下文），严格模式全阻断（fail-closed）。
 */
import { toPosix } from './to-posix.ts';

/** 从发现项 key 提取涉及文件（posix，工具 cwd 相对路径）。
 * knip 键形如 `file|type|name`；jscpd 键形如 `f1#f2`。无法解析返回 []。 */
export function findingFiles(key: string): string[] {
  if (typeof key !== 'string') return [];
  if (key.includes('|')) {
    return [key.slice(0, key.indexOf('|'))].filter(Boolean);
  }
  if (key.includes('#')) {
    const i = key.indexOf('#');
    return [key.slice(0, i), key.slice(i + 1)].filter(Boolean);
  }
  return [];
}

/** 判断发现项是否归属责任文件集。
 * 兼容三种形态：候选补 `frontend/` 前缀后命中、根路径直配、候选自带前缀直配。 */
export function attributable(key: string, responsibleSet: Set<string> | null): boolean {
  if (!responsibleSet) return true; // null = 严格模式
  for (const f of findingFiles(key)) {
    const p = toPosix(f);
    if (responsibleSet.has(p)) return true;
    if (responsibleSet.has(`frontend/${p}`)) return true;
    if (p.startsWith('frontend/') && responsibleSet.has(p.slice('frontend/'.length))) return true;
  }
  return false;
}

/** 拆分新增发现项 → { blocking, absorbable }。
 * responsibleSet 为 null 时全部 blocking（严格兜底）。 */
export function splitNewFindings(newKeys: string[], responsibleSet: Set<string> | null): { blocking: string[]; absorbable: string[] } {
  const blocking: string[] = [];
  const absorbable: string[] = [];
  for (const k of newKeys) {
    (attributable(k, responsibleSet) ? blocking : absorbable).push(k);
  }
  return { blocking, absorbable };
}

/** 单工具结果可信度：findings 非空即可信（有发现必是执行+解析成功）；
 * 为空时只有「执行成功（out 非 null）且输出解析成功（未置 parseFailed）」才可信——
 * 否则空 findings 是「工具没跑/输出解析失败」的假零，写盘会洗白既有债务。 */
function trusted(findings: string[], out: string | null, parseFailed: boolean): boolean {
  return findings.length > 0 || (out !== null && !parseFailed);
}

/** 基线写盘守卫（纯决策）：knip 与 jscpd 两工具结果都可信才允许自动收编/更新基线写盘。
 * 防洗白：任一工具「未执行成功或输出解析失败」时禁止写盘（code_review P2 回归）。 */
export function canWriteBaseline(knipFindings: string[], knipOut: string | null, knipParseFailed: boolean, jscpdFindings: string[], jscpdOut: string | null, jscpdParseFailed: boolean): boolean {
  return trusted(knipFindings, knipOut, knipParseFailed) && trusted(jscpdFindings, jscpdOut, jscpdParseFailed);
}
