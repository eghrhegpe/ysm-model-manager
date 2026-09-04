// ===== 主题核心（纯逻辑，无启动装配副作用）=====
// 2026-08-17 神桶拆分：原 app-modules.ts 同时承载「纯逻辑导出」与「启动装配
// （Web Component import / 启动 IIFE / 总线发射 / addEventListener）」，测试
// import 纯函数即触发全部顶层副作用 → 切 node 环境需逐个 stubGlobal 补不完。
// 拆出本文件：normalizeTheme/applyTheme/initTheme 无顶层副作用，测试可独立 import。
// 主题变更通过 document.body.classList 直接生效，无需 bus 广播（P2：theme:change 零订阅，删发射）。
import { getApp } from "./backend/app.ts";
import { safeGet, safeSet } from "./utils/dom/storage.ts";

const THEME_DARK = "cyber";
// 主题白名单（applyTheme 与 initTheme 共用，防两处口径漂移）
const THEME_VALID = ["cyber", "warm", "pro", "sakura", "ocean", "mint", "system"];
// class 清理列表由 THEME_VALID 推导，新增主题无需再手抄第二份（原 applyTheme 手抄双份是漂移源）
const THEME_CLASSES = THEME_VALID.filter((t) => t !== "system").map((t) => "theme-" + t);

/** 主题归一化：白名单外一律回落 system（P2 修复后持久层也只写合法值） */
export function normalizeTheme(mode: string): string {
  return THEME_VALID.includes(mode) ? mode : "system";
}

export function applyTheme(mode: string): void {
  if (!THEME_VALID.includes(mode)) mode = "system";
  document.body.classList.remove(...THEME_CLASSES);
  if (mode === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.body.classList.add(prefersDark ? "theme-cyber" : "theme-warm");
  } else {
    document.body.classList.add("theme-" + mode);
  }
}

export async function initTheme() {
  try {
    const { LoadAppConfig } = await getApp();
    const cfg = await LoadAppConfig();
    const raw = safeGet("theme") || cfg.theme || THEME_DARK;
    // P2 修复：持久层只回写合法值——原实现把 localStorage 非法值（如设置页误写的 "time"）
    // 原样写回，脏数据持续污染导致后续 matchMedia 跟随失效
    const theme = normalizeTheme(raw);
    safeSet("theme", theme);
    applyTheme(theme);
  } catch {
    const raw = safeGet("theme") || THEME_DARK;
    const theme = normalizeTheme(raw);
    safeSet("theme", theme);
    applyTheme(theme);
  }
}
