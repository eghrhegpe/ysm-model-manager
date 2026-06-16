// ===== 创意工坊数据/配置/工具 =====
// 依赖 workshop-icons.js 的 SVG 图标
import { ICONS } from "./workshop-icons.js";

const STORAGE_KEY = "ysm-fav-creators";

// ===== 站点名称映射 =====
export const PLATFORM_NAMES = {
  bilibili: "B站",
  afdian: "爱发电",
  github: "GitHub",
  mzhouse: "模之屋",
  bowlroll: "Bowlroll",
  vroid: "VRoid",
  nicovideo: "NicoNico 3D",
  deviantart: "DeviantArt",
};

// ===== 创作者身份识别 =====
export function getCreatorIdentity(cr) {
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
  // fallback: detect from old tag field
  if (tag === "vup")
    return { label: "VTuber 创作者", icon: ICONS.VUP, tag: "vup" };
  if (tag === "oc") return { label: "OC 原创角色", icon: ICONS.OC, tag: "oc" };
  return { label: "YSM 创作者", icon: ICONS.CREATOR, tag: "creator" };
}

export function getTagFromRole(role) {
  return role || "creator";
}

// ===== 描述标签解析 =====
export function parseDescTags(desc) {
  if (!desc) return [];
  return desc
    .split(/[、，,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

// ===== 收藏工具 =====
export function loadFavs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveFavs(names) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
}

export function isFaved(name) {
  return loadFavs().includes(name);
}

export function toggleFav(name) {
  const favs = loadFavs();
  const idx = favs.indexOf(name);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(name);
  saveFavs(favs);
  return idx < 0; // true=now faved
}
