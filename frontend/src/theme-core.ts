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
// 导出供测试引用：设置页主题卡片的 data-theme 集合必须与此一致（防「加主题忘加卡片」）。
// 2026-10 as const 收编（锐评第七轮）：此前 `string[]` 使下游「值→图标/文案」表只能是
// `Record<string, …>` 松键——加主题漏一处只在运行时回落到裸主题名（`?? UI_ICONS.dot` /
// `labelKey ? … : theme`），与 ADR-307 D3 立法前的 MIRROR 半截接线同款病。现由联合类型
// 兜住：消费面写 `Record<ThemeCard, …>`，漏键即编译期红（ADR-303 `Record<TdRotMode, …>` 同构）。
export const THEME_VALID = ["cyber", "warm", "pro", "sakura", "ocean", "mint", "system"] as const;
/** 主题联合（含 system）：system 是「跟随系统」的入口值，不是一张可选卡片。 */
export type Theme = (typeof THEME_VALID)[number];
/** 主题卡片 / 图标 / 文案表的键域 = 主题联合去掉 system（system 的映射归自动模式下拉）。 */
export type ThemeCard = Exclude<Theme, "system">;
// class 清理列表由 THEME_VALID 推导，新增主题无需再手抄第二份（原 applyTheme 手抄双份是漂移源）
const THEME_CLASSES = THEME_VALID.filter((t) => t !== "system").map((t) => `theme-${t}`);

// 白名单判定：Set 查表 + 类型守卫（`THEME_VALID.includes(string)` 在 readonly 元组下不再收宽
// string，故收口为单一守卫，normalizeTheme / applyTheme 共用——两处各写一次 as 强转是漂移温床）
const THEME_SET: ReadonlySet<string> = new Set<string>(THEME_VALID);
function isTheme(v: string): v is Theme {
  return THEME_SET.has(v);
}

// P4 修复：主题自动模式白名单（off/system/time），供 initTheme 兜底 + 设置页校验
export const THEME_AUTO_VALID = ["off", "system", "time"] as const;

/** 主题自动模式归一化：白名单外一律回落 off */
export function normalizeThemeAuto(mode: string): (typeof THEME_AUTO_VALID)[number] {
  return THEME_AUTO_VALID.includes(mode as (typeof THEME_AUTO_VALID)[number])
    ? (mode as (typeof THEME_AUTO_VALID)[number])
    : "off";
}

/** 主题归一化：白名单外一律回落 system（P2 修复后持久层也只写合法值） */
export function normalizeTheme(mode: string): Theme {
  return isTheme(mode) ? mode : "system";
}

export function applyTheme(raw: string): void {
  // 归一为联合类型局部量后分支（原实现直接改写入参 string，模式比较无类型收窄）
  const mode: Theme = isTheme(raw) ? raw : "system";
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
export function timeThemeForHour(hour: number): Theme {
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR ? "warm" : "cyber";
}

/** 时间段主题切换：应用当前时段主题并返回其名（warm 白天 / cyber 夜晚） */
export function applyTimeTheme(): Theme {
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
    // P4 修复（2026-09，theme-auto 落盘同步）：localStorage 被清理后从 Go 配置兜底恢复
    // theme-auto——无此兜底时 time 自动模式重启后 applyThemeAuto 读不到值，定格上次主题
    const rawAuto = safeGet("theme-auto") || cfg.themeAuto || "off";
    const auto = normalizeThemeAuto(rawAuto);
    safeSet("theme-auto", auto);
  } catch {
    const raw = safeGet("theme") || THEME_DARK;
    const theme = normalizeTheme(raw);
    safeSet("theme", theme);
    applyTheme(theme);
    // 隐私模式 / Go 不可用时，theme-auto 仍尝试回写（safeSet 静默降级）
    const rawAuto = safeGet("theme-auto") || "off";
    safeSet("theme-auto", normalizeThemeAuto(rawAuto));
  }
}
