// ===== 主题核心（纯逻辑，无启动装配副作用）=====
// 2026-08-17 神桶拆分：原 app-modules.ts 同时承载「纯逻辑导出」与「启动装配
// （Web Component import / 启动 IIFE / 总线发射 / addEventListener）」，测试
// import 纯函数即触发全部顶层副作用 → 切 node 环境需逐个 stubGlobal 补不完。
// 拆出本文件：normalizeTheme/applyTheme/initTheme 无顶层副作用，测试可独立 import。
// 主题变更通过 document.body.classList 直接生效，无需 bus 广播（P2：theme:change 零订阅，删发射）。
import { getApp } from "@/backend/app.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";

// 默认暗色基线（initTheme 与设置页/路径卡保存配置时的回退值）。
// 导出供消费点引用——原 settings/init.ts、path-cards.ts 三处 `|| "dark"` 字面量
// 不在白名单（"dark" 非法），靠 normalizeTheme 兜底；统一引用 THEME_DARK 消除漂移源。
export const THEME_DARK = "cyber";

// system 深/浅映射命名常量（2026-09 收敛：原 applyTheme 三元硬编码 cyber/warm，
// 想让「跟随系统」的暗色用 ocean 而非 cyber 改不了；提取为常量单点可改、可被测试锁定）。
export const SYSTEM_DARK_THEME = "cyber";
export const SYSTEM_LIGHT_THEME = "warm";

// 时间段主题边界（魔法数值收敛）：6:00–18:00 白天 warm，其余夜晚 cyber
const DAY_START_HOUR = 6;
const DAY_END_HOUR = 18;

// 主题白名单（applyTheme 与 initTheme 共用，防两处口径漂移）
// 导出供测试引用：设置页主题卡片的 data-theme 集合必须与此一致（防「加主题忘加卡片」）
export const THEME_VALID = ["cyber", "warm", "pro", "sakura", "ocean", "mint", "system"];
// class 清理列表由 THEME_VALID 推导，新增主题无需再手抄第二份（原 applyTheme 手抄双份是漂移源）
const THEME_CLASSES = THEME_VALID.filter((t) => t !== "system").map((t) => `theme-${t}`);

/** 主题归一化：白名单外一律回落 system（P2 修复后持久层也只写合法值） */
export function normalizeTheme(mode: string): string {
  return THEME_VALID.includes(mode) ? mode : "system";
}

export function applyTheme(mode: string): void {
  if (!THEME_VALID.includes(mode)) mode = "system";
  document.body.classList.remove(...THEME_CLASSES);
  if (mode === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const systemTheme = prefersDark ? SYSTEM_DARK_THEME : SYSTEM_LIGHT_THEME;
    document.body.classList.add(`theme-${systemTheme}`);
  } else {
    document.body.classList.add(`theme-${mode}`);
  }
}

/** 纯函数时段判定：6:00–17:59 → warm，其余 → cyber（设置页与启动链共用单源） */
export function timeThemeForHour(hour: number): string {
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR ? "warm" : "cyber";
}

/** 时间段主题切换：应用当前时段主题并返回其名（warm 白天 / cyber 夜晚） */
export function applyTimeTheme(): string {
  const themeName = timeThemeForHour(new Date().getHours());
  applyTheme(themeName);
  return themeName;
}

/**
 * 启动链按自动模式重算主题（P3 修复：原启动链不读 theme-auto，白天设 time 夜间
 * 重启仍亮色——定格值不随时刻重算）。
 * - time：按当前时刻重算时段主题 + 回写 theme 键（保持定格值与时段一致）
 * - system：由 initTheme 经 theme="system" 已处理，此处不重复接管（避免双写）
 * - off / 缺省：沿用 initTheme 应用的定格主题，不动
 */
export function applyThemeAuto(): void {
  const auto = safeGet("theme-auto");
  if (auto === "time") {
    const themeName = applyTimeTheme();
    safeSet("theme", themeName);
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
