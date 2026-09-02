// ===== 所有 ES module 组件的统一入口 =====
import { TOAST_MS } from "./utils/dom/toast-ms.ts";
import { bus } from "./bus.ts";
import { register } from "./services/registry.ts";
import { Window } from "./backend/runtime.ts";
import { getApp } from "./backend/app.ts";
import { registerErrorDiary } from "./core/error-diary.ts";
import { registerCoiServiceWorker } from "./backend/coi-sw.ts";
import { prefetchStatsWorker } from "./backend/browser-adapter.ts";
import { initI18n } from "./core/i18n/locale.ts";
import { friendlyError } from "./utils/dom/errors.ts";
import { checkUpdateSilent } from "./features/version-updater.ts";
import { applyUIPrefs } from "./views/app-content/settings/ui-prefs.ts";
import { loadView } from "./utils/module-loader.ts";
import { revealMainWindow } from "./startup-reveal.ts";

// bus 已在 bus.ts 中挂载 window.bus，此处不再重复赋值

// 注册全局可替换服务
import { loadInstances } from "./views/app-sidebar/loader.ts";
import { loadEntries } from "./views/app-tree/loader.ts";
register("loadInstances", loadInstances);
register("loadEntries", loadEntries);

// 新版 Web Component（通过 ES Module 导入以支持 shadow DOM）
// 静态导入（浏览器加载失败时直接报错，不 try/catch 以免静默吞错）
// 注意：app-nav 的注册已移至 async IIFE 中，放在 initI18n() 之后，
// 避免首帧渲染时 i18n bundle 尚未加载导致 [i18n] 缺失 key 警告。
import "./views/context-menu/index.ts";
import "./views/app-toast/index.ts";

// Web Components 动态导入（使用字面量确保 Vite 能在构建时解析路径）
loadView("app-tree", () => import("./views/app-tree/index.ts"));
loadView("app-sidebar", () => import("./views/app-sidebar/index.ts"));
const appContentReady = loadView("app-content", () => import("./views/app-content/index.ts"));
loadView("app-sync-manager", () => import("./views/app-sync-manager/index.ts"));

//  窗口状态已由 Go 端 shutdown 保存，前端不再重复写入

// ===== 全局主题控制 =====

// 2026-08-17 神桶拆分：normalizeTheme/applyTheme/initTheme 已移至 theme-core.ts
// （纯逻辑无顶层副作用，测试可独立 import）；本文件保留启动装配 + window 桥接。
import { normalizeTheme, applyTheme, initTheme } from "./theme-core.ts";
import { safeGet } from "./utils/dom/storage.ts";
export { normalizeTheme, applyTheme, initTheme };

// P3 修复（code_review）遗留说明：page-store 白名单曾桥接到 window 供 index.html
// 内联脚本复用；2026-08-29 审计确认内联脚本整段为死代码（emit("nav:change") 全项目
// 无监听、loading:* 全项目无发射器），已随 index.html 一并删除，桥接随之撤销。
// 初始页恢复唯一路径 = page-store.resolveInitialPage()。

// 启动初始化
(async () => {
 try {
  try {
    registerErrorDiary();
  } catch (e) {
    console.warn("[error-diary] 错误日志注册失败:", e);
  }
  // ADR-079 M1：网页版注册 COI Service Worker（补 COOP/COEP → crossOriginIsolated，
  // 为 pthread WASM 铺路；渐进增强，失败静默降级单线程）
  registerCoiServiceWorker();
  try {
    await initI18n();
  } catch (e) {
    console.warn("[i18n] 初始化失败，界面将缺翻译:", e);
    bus.emit("toast:show", {
      msg: "⚠️ " + friendlyError(e, "语言资源加载失败"),
      duration: TOAST_MS.long,
      type: "error",
    });
  }
  try {
    await import("./views/app-nav/index.ts");
  } catch (e) {
    console.warn("[module] app-nav 加载失败:", e);
    bus.emit("toast:show", {
      msg: "❌ " + friendlyError(e, "导航组件加载失败"),
      duration: TOAST_MS.long,
      type: "error",
    });
  }
  try {
    await initTheme();
  } catch (e) {
    console.warn("[theme] 主题初始化失败:", e);
    bus.emit("toast:show", {
      msg: "⚠️ " + friendlyError(e, "主题初始化失败"),
      duration: TOAST_MS.long,
      type: "error",
    });
  }
  try {
    applyUIPrefs();
  } catch (e) {
    console.warn("[ui-prefs] 界面偏好应用失败:", e);
  }
  checkUpdateSilent().catch((e) => console.warn("[updater] 静默检查失败:", e));
  // ADR-101 方向 A：Three.js 模块预加载（非阻塞，省掉首次 3D 预览 ~105ms 脚本编译）
  import("three").catch((e) => console.warn("[preload] three 预加载失败:", e));
  // 启动 2s 后后台预下载 stats.worker chunk（网页版）：让首次数值搜索不用等下载
  setTimeout(() => prefetchStatsWorker(), 2000);
 } finally {
   await appContentReady;
   await revealMainWindow(() => Window.Show());
 }
})();

// node 测试环境无 window，跳过系统主题跟随注册（浏览器语义不变）
if (typeof window !== "undefined") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      // P3 修复（code_review）：裸调改 safeGet——隐私模式每次系统主题切换抛错 → 主题跟随静默失效
      const theme = safeGet("theme") || "system";
      if (theme === "system") {
        applyTheme("system");
        bus.emit("toast:show", {
          msg: `已跟随系统切换至${e.matches ? "深色" : "浅色"}主题`,
          duration: TOAST_MS.success,
          type: "info",
        });
      }
    });
}

// ===== F12 / Ctrl+Shift+I 打开 DevTools（仅开发/调试环境）=====
// 通过查询参数 ?dev=1 或 localStorage 标志启用
// P3 修复：localStorage 裸调在隐私模式抛错会中止模块求值——即使 ?dev=1 也无法启用
const _devtoolsFlag = safeGet("_devtools") === "1";
// node 测试环境无 window，短路跳过 devtools 判定（浏览器语义不变）
const _devMode =
  (typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("dev")) ||
  _devtoolsFlag;
// 具名 handler：可被 unregisterDevtools 移除（测试反复求值本模块时，
// vi.resetModules 清模块缓存但不清 document 上残留的 listener，叠加注册
// 会导致跨用例污染——devtools「未启用」用例被前一个 _devMode=true 用例
// 残留的 listener 触发 Window.OpenDevTools()）。
const _devtoolsKeydown = (e: KeyboardEvent) => {
  if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I")) {
    e.preventDefault();
    try {
      Window.OpenDevTools();
    } catch (_) {}
  }
};
if (_devMode && typeof document !== "undefined") {
  document.addEventListener("keydown", _devtoolsKeydown);
}
/** 测试清理钩子：移除 devtools keydown listener（生产环境无需调用）。 */
export function unregisterDevtools(): void {
  if (typeof document !== "undefined") {
    document.removeEventListener("keydown", _devtoolsKeydown);
  }
}
