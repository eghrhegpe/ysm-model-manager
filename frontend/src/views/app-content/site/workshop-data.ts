// ===== 创意工坊数据/配置/工具 =====
// 依赖 workshop-icons.js 的 SVG 图标

import { t } from "@/core/i18n/t.ts";
import { safeGetJSON, safeSet } from "@/utils/base/primitives/storage.ts";
import { ICONS } from "@/utils/icon/workshop-icons.ts";

const STORAGE_KEY = "ysm-fav-creators";

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

/** 「标签式描述」单段长度上限：超出即视为普通描述文本，不切碎成 #chip */
const TAG_STYLE_MAX_SEG_LEN = 12;
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

export function toggleFav(name: string): boolean {
  const favs = loadFavs();
  const idx = favs.indexOf(name);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(name);
  saveFavs(favs);
  return idx < 0; // true=now faved
}
