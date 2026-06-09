// ===== 所有 ES module 组件的统一入口 =====
import { bus } from "./bus.js";
import { register } from "./services/registry.js";

// 调试：控制台调 window.$spec("模型路径") 获取 3D spec
window.$spec = async (path) => {
  try {
    const { GetModel3DSpec } = await import("../wailsjs/go/main/App.js");
    const s = JSON.parse(await GetModel3DSpec(path || ""));
    if (s.models?.length) {
      console.log(
        "[$spec] Go spec:",
        s.models[0].bones?.length,
        "bones,",
        s.models[0].meshGroups?.length,
        "meshes",
        s._debug?.length ? "debug:" + s._debug.length + " entries" : "",
      );
      return s;
    }
    // Go 为空 → 用 JS 兜底
    console.warn("[$spec] Go 返回空，尝试 JS 兜底...");
  } catch (e) {
    console.warn("[$spec] Go 调用失败:", e);
  }
  // JS 兜底：从已加载的 model 数据构建 spec
    const { buildSpecFromModel } = await import("./utils/model3d.js");
  // 找当前 3D 预览的 model（window.__last3DModel）
  const model = window.__last3DModel;
  if (model?.bones?.length) {
    const s = buildSpecFromModel(model);
    console.log("[$spec] JS spec:", s.models[0].bones?.length, "bones");
    return s;
  }
  console.warn("[$spec] 无可用 model 数据，请先打开 3D 预览");
  return null;
};
// 注册全局可替换服务
import { loadInstances } from "./components/app-sidebar/loader.js";
import { loadEntries } from "./components/app-tree/loader.js";
register("loadInstances", loadInstances);
register("loadEntries", loadEntries);

// 新版 Web Component（通过 ES Module 导入以支持 shadow DOM）
import "./components/app-tree/index.js";
import "./components/app-sidebar/index.js";
import "./components/app-preview/index.js";
import "./components/app-content/index.js";
// 之前通过 <script> 加载的组件，现在统一 ESM import
import "./components/app-nav.js";
import "./components/context-menu.js";
import "./components/app-toast.js";

// 右键菜单映射
import { registerContextMenus } from "./core/context-menus.js";
registerContextMenus();

//  窗口状态已由 Go 端 shutdown 保存，前端不再重复写入

// ===== 全局主题控制 =====
// 主题: cyber(赛博霓虹) | warm(温暖木纹) | pro(极简深邃) | system(跟随系统)
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

(async () => {
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
