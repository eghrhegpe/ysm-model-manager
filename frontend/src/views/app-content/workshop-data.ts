// ===== 创意工坊数据/配置/工具 =====
// 依赖 workshop-icons.js 的 SVG 图标
import { ICONS } from "../../utils/icon/workshop-icons.ts";

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
      return { label: "官方IP模型库", icon: ICONS.OFFICIAL, tag: "official" };
    case "creator":
      return { label: "YSM 创作者", icon: ICONS.CREATOR, tag: "creator" };
    case "vup":
      return { label: "VTuber 创作者", icon: ICONS.VUP, tag: "vup" };
    case "repo":
      return { label: "社区模型仓库", icon: ICONS.REPO, tag: "repo" };
    case "oc":
      return { label: "OC 原创角色", icon: ICONS.OC, tag: "oc" };
  }
  // fallback: detect from old tag field（与 role 分支对齐，五种身份均可识别）
  if (tag === "official")
    return { label: "官方IP模型库", icon: ICONS.OFFICIAL, tag: "official" };
  if (tag === "vup")
    return { label: "VTuber 创作者", icon: ICONS.VUP, tag: "vup" };
  if (tag === "oc") return { label: "OC 原创角色", icon: ICONS.OC, tag: "oc" };
  if (tag === "repo")
    return { label: "社区模型仓库", icon: ICONS.REPO, tag: "repo" };
  return { label: "YSM 创作者", icon: ICONS.CREATOR, tag: "creator" };
}

export function getTagFromRole(role?: string): string {
  return role || "creator";
}

// ===== 描述标签解析 =====
export function parseDescTags(desc?: string): string[] {
  if (!desc) return [];
  return desc
    .split(/[、，,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

// ===== 收藏工具 =====
export function loadFavs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveFavs(names: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
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
