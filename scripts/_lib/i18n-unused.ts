/**
 * i18n-unused.ts — i18n 未使用键判定纯函数层（scripts/_lib）。
 *
 * 解决什么问题（为什么需要）：
 *   仓库有 4 个 i18n 检查器（check-ctx-menu-i18n / i18n-check / i18n-key-naming /
 *   i18n-ui-check），但**没有一个查「未使用」**——它们只管缺失键 / 命名 / UI 漂移。
 *   后果是死键只增不减且无人报警：2026-09 实测 en 包 1459 键中 **174 个全仓无引用**
 *   （+8 个仅测试引用），占 12%。成因多为**迁移后遗留**——如右键菜单改用 `menu.*` 后
 *   `common.import/export/copy/move/rename/delete/confirm/clear` 八个通用动词全成死键；
 *   空状态改走 `workshop.githubNoIndex` 后 `content.errNoIndex*` 与 `error.noIndex` 留尸。
 *
 * 判定口径（**点分 token 精确匹配**，不用子串包含——这点是刻意的）：
 *   子串包含会**漏报真死键**：`import.queue` 是 `import.queueFull` 的前缀，若后者在用，
 *   子串法会把前者误判为「已用」。故实现为两步：
 *     ① extractDottedTokens(corpus)：把消费侧语料里**所有点分标识符**收成 Set；
 *     ② key 命中当且仅当该 Set 精确含有该 key。
 *   代价是注释里提到的键也算「已用」（偏保守）——见 extractDottedTokens 的详细权衡。
 *
 * 两级判定（保守优先）：
 *   - `used`      ：生产源里出现过（点分 token 命中）——正常；
 *   - `test-only` ：仅测试/脚本里出现，生产未用——**疑似**冗余（测试夹具可能替它兜底）；
 *   - `dead`      ：全仓（含测试/脚本）都不出现——真死键。
 *
 * 局限（务必知悉，勿据此盲删）：`t()` 传变量的动态查表无法静态判定。本模块另提供
 *   `countDynamicKeySites()` 把「动态查表点」计数吐出来，供报告标注置信度——
 *   动态点越多，`dead` 判定的假阳性风险越高（键可能由运行时字符串拼出）。
 *
 * 依赖：零依赖（纯字符串处理；文件 IO 由调用方注入）。
 *
 * 用法：
 *   import { parseLocaleKeys, extractDottedTokens, classifyKeyUsage } from './_lib/i18n-unused.ts';
 *
 * 退出码：本模块无独立 CLI（被 check-i18n-unused.ts import）。
 */

/** 键的使用级别（保守排序：used 最宽 → dead 最严）。 */
export type KeyUsageKind = "used" | "test-only" | "dead";

/** 单键判定结果。 */
export interface KeyUsageRow {
  key: string;
  usage: KeyUsageKind;
}

/**
 * 从语言包源码文本解析键名（匹配 `"key": value` 形态）。
 *
 * 只认行首缩进后的 `"…"` + 冒号——语言包是 `{ "k": "v" }` 扁平对象，
 * 值内可能含冒号（如 `"a: b"`），故必须锚定「引号闭合后紧跟冒号」。
 */
export function parseLocaleKeys(localeText: string): string[] {
  const out: string[] = [];
  for (const m of localeText.matchAll(/^\s*"([^"]+)"\s*:/gm)) {
    const k = m[1];
    if (k) out.push(k);
  }
  return out;
}

/**
 * 提取语料中的**点分标识符 token**（如 `preview.unloadModel`）——键引用的超集。
 *
 * ⚠️ 为什么不用「按引号抽字面量」（2026-09 实测踩坑，此处是本模块最关键的一处设计）：
 *   想当然的写法是按引号交替匹配 `"…"|'…'|`…``，但它**会吞掉嵌套引号**——
 *   模板串里嵌 `t()` 是本仓**最主要**的调用形态（`` `🗑 ${t("preview.unloadModel")}` ``），
 *   按引号抽会把整段 `` `🗑 ${t("preview.unloadModel")}` `` 当成**一个**字面量，
 *   内层的 `"preview.unloadModel"` 被一并吃掉 → 真在用的键被判死。
 *   实测该 bug 让「死键」从 174 虚增到 361（抽样 21 个里 12 个实为引用，假阳性 57%）。
 *   根因是**词法分析问题用正则 tokenize 解决**——嵌套结构必须避开引号感知。
 *
 *   改法：不解析引号，直接在**原文**上抽「点分标识符」token——
 *   内层 `t("x.y")` 与外层模板串互不干扰（无需 tokenize，天然免疫嵌套）。
 *   代价与取向：注释里提到的键也算「已用」（偏保守），宁可漏报死键也不误报——
 *   本闸的输出是给人删键用的，误报会让活键被删（UI 直接显示键名），代价远高于漏报。
 */
export function extractDottedTokens(corpus: string): Set<string> {
  const out = new Set<string>();
  for (const m of corpus.matchAll(/[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/g)) {
    out.add(m[0]);
  }
  return out;
}

/**
 * 逐键判定使用级别。
 *
 * @param keys      语言包键集合（通常取 en 包为准，另两包由一致性测试保证对齐）
 * @param prodLits  生产侧字面量集合（extractStringLiterals 产出）
 * @param allLits   全仓字面量集合（生产 + 测试 + 脚本）
 */
export function classifyKeyUsage(
  keys: readonly string[],
  prodLits: ReadonlySet<string>,
  allLits: ReadonlySet<string>,
): KeyUsageRow[] {
  return keys.map((key) => ({
    key,
    usage: prodLits.has(key) ? "used" : allLits.has(key) ? "test-only" : "dead",
  }));
}

/** 动态查表点计数（置信度标注用）。 */
export interface DynamicKeySites {
  /** `t(<非字面量>)` 调用点数——键由变量传入，静态不可知。 */
  dynamicT: number;
  /** 键的**构造式**出现（模板串 / 字符串拼接里以 `前缀.` 起头）——最危险的形态。 */
  constructed: number;
}

/**
 * 统计动态查表点。
 *
 * `constructed` 是 `dead` 判定的主要假阳性来源：`t(\`import.${x}\`)` 这类构造
 * 会让真实在用的键**不以字面量出现**，从而被判死。实测本仓该形态为 0 处
 *（`t()` 传变量 18 处，但值均来自同仓字面量数据），故 `dead` 可信度高。
 */
export function countDynamicKeySites(corpus: string): DynamicKeySites {
  let dynamicT = 0;
  for (const line of corpus.split("\n")) {
    for (const _ of line.matchAll(/\bt\(\s*[^"'`\s)][^)]{0,60}\)/g)) dynamicT++;
  }
  let constructed = 0;
  for (const _ of corpus.matchAll(/\bt\(\s*`[a-zA-Z]+\.[^`]*\$\{/g)) constructed++;
  for (const _ of corpus.matchAll(/\bt\(\s*["'][a-zA-Z]+\.?[^"']*["']\s*\+/g)) constructed++;
  return { dynamicT, constructed };
}

/** 按 `前缀.*` 归组计数（报告展示用），按数量降序。 */
export function groupByPrefix(keys: readonly string[]): Array<{ prefix: string; count: number }> {
  const map = new Map<string, number>();
  for (const k of keys) {
    const p = k.split(".")[0] ?? k;
    map.set(p, (map.get(p) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
}
