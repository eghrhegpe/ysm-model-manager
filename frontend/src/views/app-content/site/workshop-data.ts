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
 *
 * 历史缺陷：筛选态曾存在**单一全局键**里。用户在 mzhouse 选中「官方」再切到 bilibili，
 * 旧标签直接套到新站点：bindEditEvents 末尾会立刻按该标签过滤 → 全员隐藏、网格空白，
 * 而按钮仍高亮 active——一条完整可复现的用户可见故障。故读方（init-workshop）与
 * 写方（edit.ts 筛选/清除）一律经下面两个 helper 拼键，禁止再直接 safeGet/safeSet 裸键。
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

/** 「标签式描述」单段长度上限（P1-7 锐评：原 12 字符会把「高产作者，模型质量好，更新勤快」
 *  这类半句话切碎成 #chip——中文 12 字足以构成半句；收紧到 8 字，真标签串特征才判标签）。 */
const TAG_STYLE_MAX_SEG_LEN = 8;
/** 「标签式描述」段数上限：超出即回退全文（不截断——截断会让尾部片段在浮层静默消失） */
const TAG_STYLE_MAX_SEG_COUNT = 6;

// ===== 描述标签解析 =====
/**
 * 解析描述中的标签片段。**仅当描述确为标签串时返回非空**。
 * 判定口径：按「、/，」切分后 2..TAG_STYLE_MAX_SEG_COUNT 段，且每段长度 ≤ TAG_STYLE_MAX_SEG_LEN。
 *
 * 锐评 P0-3 修两处 landmine（复核 P1-2 追加一条）：
 *  - 原切分字符类含 **ASCII 逗号**，英文描述（"cool models, fast updates"）被当标签
 *    切碎——逗号属正常句读，现只认顿号「、」与全角逗号「，」；
 *  - 原单段描述也返回 1 个片段 → 详情浮层把整句包成单个 #chip 并**丢弃原文**，
 *    现单段/长句返回 []，调用方回退全文展示；
 *  - **段数超上限不截断**：原 `slice(0, 6)` 让第 7 段起在浮层消失（浮层「有片段即只渲染 chips」），
 *    与「不丢内容」冲突 → 超上限整体回 [] 走全文（`content.descPlaceholder` 教的正是顿号标签串，
 *    8 个关键词即可命中）。仍保留旧键名语义：仅返回**确实成标签串**的片段。
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

/**
 * tag 的**展示文案**：已知身份走 `getCreatorIdentity` 的 i18n label（单源），
 * 未知 tag 原样返回——不得回退成别的身份的 label（那会让按钮文案与实际过滤语义不符：
 * `data-tag` 仍是原值）。锐评 P0-4 / 复核 P1-3。
 */
export function getTagDisplayLabel(tag: string): string {
  const identity = getCreatorIdentity({ role: tag });
  return identity.tag === tag ? identity.label : tag;
}

// ===== 站点归属 type 解析（P1-6 锐评：多值属性分号压扁的反范式——解析单点收口） =====
/**
 * type 字段是「创作者所属站点」的分号分隔多值（Go 契约：`"site1;site2"`）。
 * 全仓消费点曾各自 split/join（P1-6 统计 7 处），语义如「过滤 belongs / 展示 badge /
 * 编辑多选 selected」各有微差；收口为纯函数单点，消费方统一调用。
 * 返回去空段的有序站点 id 数组；空/undefined 输入 → []。
 */
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
 *
 * 提取原因：排序规则此前只存在于 render.ts|sortCreatorsFavedFirst，而
 * events.ts|cmBbBindStarBtns 又手写了一套「收藏插队首 / 取消收藏扔队尾」的 DOM 移动逻辑
 * ——两套口径必然漂移（取消收藏会把高产创作者沉到队尾，与本规则反向）。
 * 渲染期排序与收藏后的就地重排现共用本比较器，规则改一处即两处同步。
 *
 * @param faved 收藏名单（由调用方 loadFavs 一次取好传入——本比较器在排序回调里被调用 O(n log n) 次，
 *              若在此内部读 localStorage 会放大成 O(n log n) 次同步解析）
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

export function toggleFav(name: string): boolean {
  const favs = loadFavs();
  const idx = favs.indexOf(name);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(name);
  saveFavs(favs);
  return idx < 0; // true=now faved
}
