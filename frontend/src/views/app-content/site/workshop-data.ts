// ===== 创意工坊数据/配置/工具 =====
// 依赖 workshop-icons.js 的 SVG 图标

import { t } from "@/core/i18n/t.ts";
import { safeGet, safeGetJSON, safeSet } from "@/utils/base/primitives/storage.ts";
import { ICONS } from "@/utils/icon/workshop-icons.ts";

// ===== 页作用域 localStorage 键（单源）=====
// 读方/写方散在 init-workshop（读）、edit（写）、events 跨页 storage 监听、tabs（last-tab）。
// 键改名即断链（旧值成孤儿、监听失配），故收口于此，改动只认这一处。
/** 收藏创作者名单（JSON string[]）——本模块读写 + events.ts 跨标签页 storage 同步监听 */
export const FAV_CREATORS_KEY = "ysm-fav-creators";
/** 分类标签过滤（""=全部）——init-workshop 读、edit 写 */
export const WS_ACTIVE_TAG_KEY = "ysm-ws-active-tag";
/** 搜索关键词（""=无词）——init-workshop 读、edit 写 */
export const WS_SEARCH_KW_KEY = "ysm-ws-search-kw";
/** 上次停留的站点 tab——workshop-tabs 读写 */
export const WS_LAST_TAB_KEY = "ysm-ws-last-tab";

/**
 * 筛选态（activeTag + searchKw）按站点 id 分域存储——键为 `前缀 + 站点id`。
 * 读方（init-workshop）与写方（edit.ts 筛选/清除）一律经下面两个 helper 拼键，
 * **禁止再直接 safeGet/safeSet 裸键**——全局单键会让旧站的标签套到新站：
 * 过滤后全员隐藏、网格空白，而按钮仍高亮 active（用户可见故障）。详见知识卡 §不变量。
 */
function scopedFilterKey(baseKey: string, siteId: string): string {
  return siteId ? `${baseKey}:${siteId}` : baseKey;
}

/** 读本站筛选态（activeTag）；siteId 为空时回退无后缀键（兼容首次进入未分域的旧数据） */
export function loadActiveTag(siteId?: string): string {
  return safeGet(scopedFilterKey(WS_ACTIVE_TAG_KEY, siteId ?? "")) || "";
}

/** 读本站搜索关键词 */
export function loadSearchKw(siteId?: string): string {
  return safeGet(scopedFilterKey(WS_SEARCH_KW_KEY, siteId ?? "")) || "";
}

/** 写本站筛选态（activeTag） */
export function saveActiveTag(siteId: string, tag: string): void {
  safeSet(scopedFilterKey(WS_ACTIVE_TAG_KEY, siteId), tag);
}

/** 写本站搜索关键词 */
export function saveSearchKw(siteId: string, kw: string): void {
  safeSet(scopedFilterKey(WS_SEARCH_KW_KEY, siteId), kw);
}

const STORAGE_KEY = FAV_CREATORS_KEY;

/** 创作者身份识别结果 */
export interface CreatorIdentity {
  label: string;
  icon: string;
  tag: string;
}

/** 创作者输入（role/tag 可空，_fromLocal 为运行时附加字段） */
export interface CreatorIdentityInput {
  role?: string;
  tag?: string;
  [key: string]: unknown;
}

// ===== 创作者身份识别 =====
export function getCreatorIdentity(cr: CreatorIdentityInput): CreatorIdentity {
  const role = cr.role || "";
  const tag = cr.tag || "";
  switch (role) {
    case "official":
      return { label: t("workshop.roleOfficial"), icon: ICONS.OFFICIAL, tag: "official" };
    case "creator":
      return { label: t("workshop.roleCreator"), icon: ICONS.CREATOR, tag: "creator" };
    case "vup":
      return { label: t("workshop.roleVup"), icon: ICONS.VUP, tag: "vup" };
    case "repo":
      return { label: t("workshop.roleRepo"), icon: ICONS.REPO, tag: "repo" };
    case "oc":
      return { label: t("workshop.roleOc"), icon: ICONS.OC, tag: "oc" };
  }
  // fallback: detect from old tag field（与 role 分支对齐，五种身份均可识别）
  if (tag === "official")
    return { label: t("workshop.roleOfficial"), icon: ICONS.OFFICIAL, tag: "official" };
  if (tag === "vup") return { label: t("workshop.roleVup"), icon: ICONS.VUP, tag: "vup" };
  if (tag === "oc") return { label: t("workshop.roleOc"), icon: ICONS.OC, tag: "oc" };
  if (tag === "repo") return { label: t("workshop.roleRepo"), icon: ICONS.REPO, tag: "repo" };
  return { label: t("workshop.roleCreator"), icon: ICONS.CREATOR, tag: "creator" };
}

export function getTagFromRole(role?: string): string {
  return role || "creator";
}

/** 「标签式描述」单段长度上限。8 字：中文半句话往往就在 8~12 字，阈值放宽会把句子误判成标签串。 */
const TAG_STYLE_MAX_SEG_LEN = 8;
/** 「标签式描述」段数上限：超出即回退全文（不截断——截断会让尾部片段在浮层静默消失） */
const TAG_STYLE_MAX_SEG_COUNT = 6;

// ===== 描述标签解析 =====
/**
 * 解析描述中的标签片段。**仅当描述确为标签串时返回非空**（调用方据此决定渲染 chips 还是全文）。
 * 判定口径：按「、/，」切分后 2..TAG_STYLE_MAX_SEG_COUNT 段，且每段 ≤ TAG_STYLE_MAX_SEG_LEN。
 * 三条边界一律指向「不丢内容」：ASCII 逗号不参与切分（英文描述属正常句读）；单段/长句返回 []
 * 由详情层回退全文；段数超上限**不截断**而是整体回 [] 走全文。
 */
export function parseDescTags(desc?: string): string[] {
  if (!desc) return [];
  const segs = desc
    .split(/[、，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length < 2 || segs.length > TAG_STYLE_MAX_SEG_COUNT) return [];
  if (segs.some((s) => s.length > TAG_STYLE_MAX_SEG_LEN)) return [];
  return segs;
}

/** tag 的展示文案：已知身份走 `getCreatorIdentity` 的 i18n label（单源）；**未知 tag 原样返回**——
 *  不得回退成别的身份的 label，否则按钮文案与实际过滤语义（data-tag 原值）不符。 */
export function getTagDisplayLabel(tag: string): string {
  const identity = getCreatorIdentity({ role: tag });
  return identity.tag === tag ? identity.label : tag;
}

// ===== 站点归属 type 解析（分号多值，解析单点收口）=====
/** type 是「创作者所属站点」的分号分隔多值（Go 契约 `"site1;site2"`）。全仓消费点曾各自
 *  split/join、语义各有微差；收口为纯函数单点。返回去空段的有序 id 数组；空输入 → []。 */
export function parseSiteIds(type?: string): string[] {
  return (type || "").split(";").filter(Boolean);
}

/** parseSiteIds 的逆：站点 id 数组 → 分号串（空数组 → ""）。 */
export function joinSiteIds(ids: string[]): string {
  return ids.filter(Boolean).join(";");
}

// ===== 收藏工具 =====
export function loadFavs(): string[] {
  return safeGetJSON<string[]>(STORAGE_KEY, []);
}

function saveFavs(names: string[]): void {
  safeSet(STORAGE_KEY, JSON.stringify(names));
}

export function isFaved(name: string): boolean {
  return loadFavs().includes(name);
}

/** 排序比较器所需的最小形状（避免与 LocalCreatorLike 形成 import 环） */
export interface FavSortInput {
  name: string;
}

/**
 * 创作者列表排序比较器：**收藏置顶 → 组内按本地模型产量降序**（单一事实源）。
 * 渲染期排序（render.ts|sortCreatorsFavedFirst）与收藏后就地重排（events.ts|cmCrReorderCard）
 * 共用本比较器——两套口径必然漂移，规则改一处即两处同步。
 * @param faved 由调用方一次取好传入：比较器在排序回调里被调 O(n log n) 次，
 *              内部读 localStorage 会放大成 O(n log n) 次同步解析。
 */
export function compareFavFirst<E extends FavSortInput>(
  a: E,
  b: E,
  faved: readonly string[],
  authorCountMap: Record<string, number>,
): number {
  const af = faved.includes(a.name) ? 1 : 0;
  const bf = faved.includes(b.name) ? 1 : 0;
  if (af !== bf) return bf - af;
  return (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0);
}

/** 创作者列表排序比较器：**按本地模型产量降序**（单一事实源）。
 *  与 compareFavFirst 的区别：不含收藏置顶，供编辑态卡片排序（编辑时按产量排即可）。 */
export function compareByAuthorCount<E extends FavSortInput>(
  a: E,
  b: E,
  authorCountMap: Record<string, number>,
): number {
  return (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0);
}

export function toggleFav(name: string): boolean {
  const favs = loadFavs();
  const idx = favs.indexOf(name);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(name);
  saveFavs(favs);
  return idx < 0; // true=now faved
}
