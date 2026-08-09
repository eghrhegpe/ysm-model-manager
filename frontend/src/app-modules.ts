// ===== 所有 ES module 组件的统一入口 =====
import { bus } from "./bus.ts";
import { PAGE_WHITELIST } from "./core/page-store.ts";
import { register } from "./services/registry.ts";
import { Window } from "@wailsio/runtime";
import { getApp } from "./wails/app.ts";
import { registerErrorDiary } from "./core/error-diary.ts";
import { initI18n } from "./core/i18n/locale.ts";
import { friendlyError } from "./utils/dom/errors.ts";
import { checkUpdateSilent } from "./features/version-updater.ts";

// bus 已在 bus.ts 中挂载 window.bus，此处不再重复赋值

// 注册全局可替换服务
import { loadInstances } from "./views/app-sidebar/loader.ts";
import { loadEntries } from "./views/app-tree/loader.ts";
register("loadInstances", loadInstances);
register("loadEntries", loadEntries);

// 新版 Web Component（通过 ES Module 导入以支持 shadow DOM）
// 静态导入（浏览器加载失败时直接报错，不 try/catch 以免静默吞错）
import "./views/app-nav/index.ts";
import "./views/context-menu/index.ts";
import "./views/app-toast/index.ts";
// Web Components 动态导入（使用字面量确保 Vite 能在构建时解析路径）
import("./views/app-tree/index.ts").catch((e) => {
  console.warn("[module] 组件加载失败: app-tree", e);
  bus.emit("toast:show", { msg: "❌ " + friendlyError(e, "组件加载失败"), duration: 5000, type: "error" });
});
import("./views/app-sidebar/index.ts").catch((e) => {
  console.warn("[module] 组件加载失败: app-sidebar", e);
  bus.emit("toast:show", { msg: "❌ " + friendlyError(e, "组件加载失败"), duration: 5000, type: "error" });
});
import("./views/app-content/index.ts").catch((e) => {
  console.warn("[module] 组件加载失败: app-content", e);
  bus.emit("toast:show", { msg: "❌ " + friendlyError(e, "组件加载失败"), duration: 5000, type: "error" });
});
import("./views/app-resource-manager/index.ts").catch((e) => {
  console.warn("[module] 组件加载失败: app-resource-manager", e);
  bus.emit("toast:show", { msg: "❌ " + friendlyError(e, "组件加载失败"), duration: 5000, type: "error" });
});
import("./views/app-sync-manager/index.ts").catch((e) => {
  console.warn("[module] 组件加载失败: app-sync-manager", e);
  bus.emit("toast:show", { msg: "❌ " + friendlyError(e, "组件加载失败"), duration: 5000, type: "error" });
});

//  窗口状态已由 Go 端 shutdown 保存，前端不再重复写入

// ===== 全局主题控制 =====
declare global {
  interface Window {
    applyTheme?: (mode: string) => void;
  }
}

const THEME_DARK = "cyber";
const THEME_LIGHT = "warm";
// 主题白名单（applyTheme 与 initTheme 共用，防两处口径漂移）
const THEME_VALID = ["cyber", "warm", "pro", "sakura", "ocean", "mint", "system"];

/** 主题归一化：白名单外一律回落 system（P2 修复后持久层也只写合法值） */
export function normalizeTheme(mode: string): string {
  return THEME_VALID.includes(mode) ? mode : "system";
}

export function applyTheme(mode: string): void {
  if (!THEME_VALID.includes(mode)) mode = "system";
  document.body.classList.remove("theme-cyber", "theme-warm", "theme-pro", "theme-sakura", "theme-ocean", "theme-mint");
  if (mode === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    document.body.classList.add(prefersDark ? "theme-cyber" : "theme-warm");
  } else {
    document.body.classList.add("theme-" + mode);
  }
}
window.applyTheme = applyTheme;
// P3 修复（code_review）：把 page-store 白名单桥接到 window，供 index.html 内联
// DOMContentLoaded 脚本复用（经典脚本无法 import）——消除内联源硬编码第二份列表的
// 双源漂移（新增页时内联源把新页重置回 repository 的静默回归）。
// 红线 §3.1 只禁双下划线前缀（window. 后接两个下划线）；非 __ 前缀与 window.applyTheme 同模式。
(window as unknown as { PAGE_WHITELIST?: readonly string[] }).PAGE_WHITELIST = PAGE_WHITELIST;

// ADR-044 策略 A：safeGet/safeSet 收敛至 utils/dom/storage.ts 统一实现——
// 隐私模式/存储禁用下 localStorage 读写抛错会中断启动链；原模块级定义与
// settings/community.ts 的 themeGet/themeSet 为重复实现，现统一 import 共享工具。
import { safeGet, safeSet } from "./utils/dom/storage.ts";

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

/** 应用 UI 偏好（字号/字体/密度/动画），不依赖设置页打开 */
export function applyUIPrefs() {
  // P3 修复：隐私模式 localStorage 抛错不得中断启动链（与 initTheme 的 safeGet 同口径）
  let fontSize = "normal";
  let displayFont = "kaiti";
  let density = "compact";
  let anim = true;
  try {
    fontSize = localStorage.getItem("ui-font-size") || "normal";
    displayFont = localStorage.getItem("ui-display-font") || "kaiti";
    density = localStorage.getItem("ui-card-density") || "compact";
    anim = localStorage.getItem("ui-animations") !== "off";
  } catch {
    /* 隐私模式：全部走默认值 */
  }

  // 清除旧版直接设 --fs-* 的内联值（避免覆盖 calc()）
  [
    "--fs-base",
    "--fs-xs",
    "--fs-sm",
    "--fs-md",
    "--fs-lg",
    "--fs-tiny",
    "--fs-xl",
  ].forEach((v) => document.documentElement.style.removeProperty(v));
  // 通过 --fs-scale 控制字号缩放（与设置页 community-settings.js 一致）
  const scaleMap: Record<string, string> = { small: "-1px", normal: "0px", large: "2px" };
  document.documentElement.style.setProperty(
    "--fs-scale",
    scaleMap[fontSize] || "0px",
  );
  document.documentElement.style.setProperty("--fs-base-size", "12px");

  document.documentElement.style.setProperty(
    "--font-display",
    displayFont === "system"
      ? "var(--font-ui)"
      : "'STKaiti','KaiTi','楷体',serif",
  );
  document.documentElement.style.setProperty(
    "--card-padding",
    density === "compact" ? "6px 10px" : "10px 14px",
  );
  document.documentElement.style.setProperty(
    "--card-gap",
    density === "compact" ? "6px" : "10px",
  );
  document.documentElement.classList.toggle("no-animations", !anim);
}

// 启动初始化
(async () => {
  registerErrorDiary();
  await initI18n();
  await initTheme();
  applyUIPrefs();
  // 静默检查更新（不阻塞界面）
  checkUpdateSilent().catch((e) => console.warn("[updater] 静默检查失败:", e));
})();

// ===== 禁用旧版 document 拖拽处理器（新版组件已接管）=====
// 仅 preventDefault 阻止浏览器默认行为，不 stopPropagation，
// 避免阻断 DnD handler（dnd.ts）的冒泡触发
document.addEventListener(
  "dragover",
  (e) => {
    if ((e.target as HTMLElement | null)?.closest?.("#ws-page, #dl-drop, .ws-page")) {
      e.preventDefault();
    }
  },
  true,
);
document.addEventListener(
  "drop",
  (e) => {
    if ((e.target as HTMLElement | null)?.closest?.("#ws-page, #dl-drop, .ws-page")) {
      e.preventDefault();
    }
  },
  true,
);

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", (e) => {
    // P3 修复（code_review）：裸调改 safeGet——隐私模式每次系统主题切换抛错 → 主题跟随静默失效
    const theme = safeGet("theme") || "system";
    if (theme === "system") {
      applyTheme("system");
      bus.emit("toast:show", {
        msg: `已跟随系统切换至${e.matches ? "深色" : "浅色"}主题`,
        duration: 2000,
        type: "info",
      });
    }
  });

// ===== F12 / Ctrl+Shift+I 打开 DevTools（仅开发/调试环境）=====
// 通过查询参数 ?dev=1 或 localStorage 标志启用
// P3 修复：localStorage 裸调在隐私模式抛错会中止模块求值——即使 ?dev=1 也无法启用
let _devtoolsFlag = false;
try {
  _devtoolsFlag = localStorage.getItem("_devtools") === "1";
} catch {
  /* 隐私模式：仅 ?dev=1 生效 */
}
const _devMode =
  new URLSearchParams(window.location.search).has("dev") || _devtoolsFlag;
if (_devMode) {
  document.addEventListener("keydown", (e) => {
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I")) {
      e.preventDefault();
      try {
        Window.OpenDevTools();
      } catch (_) {}
    }
  });
}
