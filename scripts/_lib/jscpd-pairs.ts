/**
 * jscpd-pairs.ts — jscpd 文件对提取与「搬迁漂移」匹配共享层。
 *
 * 背景（2026-09-01 ADR-144 复盘）：jscpd-go 门禁按「文件对路径」记账，
 * 对文件搬迁失明——classify.go 从 go/types/ 搬到 go/packs/ 后，重复对 key
 * 随路径变化被误报为「新增重复对」，实际零新债（旧 baseline 三对全命中漂移）。
 * 本层把 pair 归一化（R24 review P3 语义）与漂移识别抽出为纯函数：
 *
 *   - pairsFrom：jscpd v5 报告 → 归一化文件对集合（`a#b` 字符串，排序去重）
 *   - matchDrift：added 对 ↔ fixed 对按 basename 集匹配，识别两类路径漂移：
 *       exact   = basename 集完全相同（纯搬迁：目录变了、文件没变）
 *       partial = basename 集部分交集（拆文件：一份 helper 随迁成两处）
 *   - 匹配语义：一个 added 只出一条最优匹配（exact > partial > 无），
 *     保证 `drifted.length ≤ added.length`，调用方可直接拿去标注输出。
 *
 * 消费方：scripts/jscpd-go.ts（门禁失败输出 + _summary.drifted）。
 * 行为锁定：tests/test_jscpd_pairs.ts（含 ADR-144 真实案例回归）。
 */

/** 把 `a#b` 对归一化为排序稳定形式（`b#a` 与 `a#b` 同一对）。 */
export function normPair(p: string): string {
  const [a, b] = p.split('#');
  return [a, b].sort().join('#');
}

/** 取 posix 路径的 basename。 */
function base(p: string): string {
  return p.split('/').pop() || p;
}

/** 取 `a#b` 对的 basename 集合（排序，供交集比较）。 */
function basenameSet(pair: string): string[] {
  return pair.split('#').map(base).sort();
}

/** 两个 basename 集的交集元素。 */
function intersect(xs: string[], ys: string[]): string[] {
  const yset = new Set(ys);
  return xs.filter((x) => yset.has(x));
}

/**
 * 从 jscpd v5 报告提取归一化唯一文件对。
 * 反斜杠（Windows jscpd 输出）→ 正斜杠；`a#b`/`b#a` 视为同一对；输出排序。
 * 报告缺 duplicates 字段 / 空数组 → 返回 []（fail-closed 由调用方负责）。
 */
export function pairsFrom(report: {
  duplicates?: Array<{ firstFile?: { name?: string }; secondFile?: { name?: string } }>;
}): string[] {
  const set = new Set<string>();
  for (const d of report.duplicates || []) {
    const a = (d.firstFile?.name || '').split('\\').join('/');
    const b = (d.secondFile?.name || '').split('\\').join('/');
    if (!a || !b) continue; // schema 异常条目跳过（调用方有结构校验兜底）
    set.add([a, b].sort().join('#'));
  }
  return [...set].sort();
}

export interface DriftMatch {
  /** 新增对（当前扫描出现） */
  added: string;
  /** 旧对（baseline 消失），即漂移来源 */
  fixed: string;
  /** exact = 纯搬迁（basename 集相同）；partial = 拆/并文件（部分交集） */
  type: 'exact' | 'partial';
  /** 交集的 basename 列表（partial 时至少 1 个；exact 时 2 个） */
  shared: string[];
}

/**
 * 识别 added 对中的「搬迁漂移」：对每个 added，在 fixed 里找 basename 集相同
 * （exact）或部分交集（partial）的旧对，一个 added 只取一条最优（exact > partial；
 * 同型取字典序首个，保证确定性）。返回与 added 同序的结果数组（仅命中项）。
 *
 * 注意：这是「提示」不是「豁免」——漂移对仍计入 added，由调用方决定展示方式；
 * 是否放行门禁由人看过提示后 --update 决定，本层不做任何账本写操作。
 */
export function matchDrift(added: string[], fixed: string[]): DriftMatch[] {
  const fixedSets = fixed.map((p) => ({ pair: p, set: basenameSet(p) }));
  const out: DriftMatch[] = [];
  for (const pair of added) {
    const set = basenameSet(pair);
    let best: { pair: string; type: 'exact' | 'partial'; shared: string[] } | null = null;
    for (const f of fixedSets) {
      const shared = intersect(set, f.set);
      if (shared.length === 0) continue;
      const type = shared.length === set.length && set.length === f.set.length ? 'exact' : 'partial';
      // exact 优先；同型取字典序首个（确定性，防调用方 diff 抖动）
      if (
        !best ||
        (type === 'exact' && best.type === 'partial')
      ) {
        best = { pair: f.pair, type, shared };
      }
    }
    if (best) out.push({ added: pair, fixed: best.pair, type: best.type, shared: best.shared });
  }
  return out;
}
