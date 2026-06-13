// ===== 所有 ES module 组件的统一入口 =====
import { bus } from "./bus.js";
import { register } from "./services/registry.js";

// 暴露 bus 到 window，供 index.html 内联脚本和旧代码使用
window.bus = bus;

// 注册全局可替换服务
import { loadInstances } from "./components/app-sidebar/loader.js";
import { loadEntries } from "./components/app-tree/loader.js";
register("loadInstances", loadInstances);
register("loadEntries", loadEntries);

// 新版 Web Component（通过 ES Module 导入以支持 shadow DOM）
import "./components/app-tree/index.js";
import "./components/app-sidebar/index.js";
import "./components/app-content/index.js";
// app-preview 动态加载（含 Three.js 466KB，仅仓库页和资源库模型 tab 需要）
// 之前通过 <script> 加载的组件，现在统一 ESM import
import "./components/app-nav.js";
import "./components/context-menu.js";
import "./components/app-toast.js";
import "./components/app-resource-manager/index.js";
import "./components/app-sync-manager/index.js";

// 右键菜单映射
import { registerContextMenus } from "./core/context-menus.js";
registerContextMenus();

//  窗口状态已由 Go 端 shutdown 保存，前端不再重复写入

// ===== 全局主题控制 =====
const THEME_DARK = "cyber";
const THEME_LIGHT = "warm";

function applyTheme(mode) {
  document.body.classList.remove("theme-cyber", "theme-warm", "theme-pro");
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

/** 从 Go 配置或 localStorage 加载主题 */
async function initTheme() {
  try {
    const { LoadAppConfig } = await import("../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    const theme =
      localStorage.getItem("theme") || cfg.theme || cfg.Theme || THEME_DARK;
    localStorage.setItem("theme", theme);
    applyTheme(theme);
  } catch {
    const theme = localStorage.getItem("theme") || THEME_DARK;
    applyTheme(theme);
  }
}

/** 应用 UI 偏好（字号/字体/密度/动画），不依赖设置页打开 */
function applyUIPrefs() {
  const fontSize = localStorage.getItem("ui-font-size") || "normal";
  const displayFont = localStorage.getItem("ui-display-font") || "kaiti";
  const density = localStorage.getItem("ui-card-density") || "compact";
  const anim = localStorage.getItem("ui-animations") !== "off";

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
  // 通过 --fs-scale 控制字号缩放（与设置页 workshop-settings.js 一致）
  const scaleMap = { small: "-1px", normal: "0px", large: "2px" };
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
  await initTheme();
  applyUIPrefs();
  // 静默检查更新（不阻塞界面）
  const { checkUpdateSilent } = await import("./features/version-updater.js");
  checkUpdateSilent();
})();

// ===== 禁用旧版 document 拖拽处理器（新版组件已接管）=====
document.addEventListener(
  "dragover",
  (e) => {
    if (e.target?.closest?.("#ws-page, #dl-drop, .ws-page"))
      e.stopPropagation();
  },
  true,
);
document.addEventListener(
  "drop",
  (e) => {
    if (e.target?.closest?.("#ws-page, #dl-drop, .ws-page"))
      e.stopPropagation();
  },
  true,
);

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    const theme = localStorage.getItem("theme") || "system";
    if (theme === "system") applyTheme("system");
  });

// ===== F12 / Ctrl+Shift+I 打开 DevTools（生产环境调试用）=====
document.addEventListener("keydown", (e) => {
  if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I")) {
    e.preventDefault();
    try {
      window.runtime.WindowShowDevtools?.();
    } catch (_) {}
  }
});
