// ===== 搜索关键词匹配单口径（ADR-343-d1 C1：与 Go go/pinyin|MatchKeyword 同判据）=====
// 金样例 tests/fixtures/parity/search-golden.json 双读对账（本文件对应
// frontend/src/utils/search/match.test.ts 的 golden 用例；Go 侧
// go/pinyin/pinyin_test.go|TestMatchKeyword_Golden 读同一 fixture）。
//
// 拼音面数据 = pinyin-table.ts（生成物：go run . --cli … pinyin-table，
// 输入 github.com/mozillazg/go-pinyin v0.20.0 默认读音集，CJK 基本区 20901 条目，
// 模块体积 ~393KB——桌面应用一次性成本，web 开发模式首次解析同量级，已裁定接受）。
// 判据差（无害超集）：Go 面覆盖全 PinyinDict（含扩展区生僻字），TS 面仅基本区——
// 扩展区字符 Go 可命中、TS 不命中，只会少不误。
import { PINYIN_BY_CODE } from "./pinyin-table.ts";

// name → 全拼/首字母串 记忆（同名条目缓存，10k 条目树搜索不重复展开）
const fullPinyinCache = new Map<string, string>();
const initialsCache = new Map<string, string>();

function expand(name: string, first: boolean): string {
  const cache = first ? initialsCache : fullPinyinCache;
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  let out = "";
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0; // 非空迭代值，兜底仅为类型收敛（0 不在拼音表内 → 原样保留）
    const py = PINYIN_BY_CODE[cp];
    out += py !== undefined ? (first ? py.slice(0, 1) : py) : ch;
  }
  const lower = out.toLowerCase();
  cache.set(name, lower);
  return lower;
}

// 关键词是否全为 ASCII 字母/数字——拼音面只对键盘拉丁输入生效（与 Go isLatins 同判据）
export function isLatins(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const isLetter = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
    const isDigit = c >= 0x30 && c <= 0x39;
    if (!isLetter && !isDigit) return false;
  }
  return true;
}

/**
 * 关键词匹配单口径（与 Go go/pinyin|MatchKeyword 逐条同语义）：
 *   hit = 空关键词（命中全部）
 *     || name / relPath 小写子串命中（CJK 直接面）
 *     || 关键词纯拉丁时：name 的全拼 / 首字母串子串命中（拼音面）
 * @param name 模型文件基名；@param relPath 仓库根相对路径（'/' 分隔；根下文件 = ''）
 */
export function keywordMatches(name: string, relPath: string, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (kw === "") return true;
  const nameL = name.toLowerCase();
  if (nameL.includes(kw)) return true;
  if (relPath.toLowerCase().includes(kw)) return true;
  if (isLatins(kw)) {
    if (expand(nameL, false).includes(kw)) return true;
    if (expand(nameL, true).includes(kw)) return true;
  }
  return false;
}
