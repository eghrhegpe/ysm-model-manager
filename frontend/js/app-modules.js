// ===== 所有 ES module 组件的统一入口 =====
import { bus } from "./bus.js";
import { register } from "./services/registry.js";
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

// ===== 全局右键菜单映射 =====
// 将 ctx:show 事件转换为新版组件使用的 menu:show 事件

bus.on(
  "ctx:show",
  ({ x, y, type, instanceName, path, banned, dir, name, count, paths }) => {
    if (type === "instance") {
      bus.emit("menu:show", {
        x,
        y,
        items: [
          { label: "📦 " + instanceName, onClick: () => {} },
          { divider: true },
          // 常用操作
          {
            label: "打开文件夹",
            icon: "📂",
            onClick: () => {
              const { OpenFolder } = window.go.main.App;
              OpenFolder?.(path || "");
            },
          },
          { divider: true },
          // 包体操作
          {
            label: "从仓库导入模型",
            icon: "⬇️",
            onClick: () => bus.emit("sync:download-missing", { instanceName }),
          },
          {
            label: "复制您的模型清单",
            icon: "📄",
            onClick: () =>
              bus.emit("instance:export-list", { name: instanceName }),
          },
          { divider: true },
          // 危险操作
          {
            label: "清空此整合包的模型",
            icon: "🗑️",
            danger: true,
            onClick: () => bus.emit("instance:clear", { name: instanceName }),
          },
        ],
      });
      return;
    }
    if (type === "batch") {
      bus.emit("menu:show", {
        x,
        y,
        items: [
          { label: `📦 已选 ${count} 个文件`, onClick: () => {} },
          { divider: true },
          {
            label: "全部启用",
            icon: "✅",
            onClick: () => {
              paths.forEach((p) =>
                bus.emit("entry:toggle", { path: p, enable: false }),
              );
            },
          },
          {
            label: "全部禁用",
            icon: "⛔",
            onClick: () => {
              paths.forEach((p) =>
                bus.emit("entry:toggle", { path: p, enable: true }),
              );
            },
          },
          { divider: true },
          {
            label: "批量重命名...",
            icon: "✂️",
            onClick: () => bus.emit("batch:rename", { paths }),
          },
          { divider: true },
          {
            label: "移入回收站",
            icon: "🗑️",
            danger: true,
            onClick: async () => {
              const { modalConfirm } = await import("./dialogs/modal.js");
              const ok = await modalConfirm({
                title: "批量删除",
                icon: "🗑️",
                message: `确定将选中的 ${count} 个文件移入回收站？`,
                okText: "删除",
                danger: true,
              });
              if (!ok) return;
              const { MoveToRecycle } =
                await import("../wailsjs/go/main/App.js");
              for (const p of paths) {
                try {
                  await MoveToRecycle(p);
                } catch {}
              }
              bus.emit("tree:reload");
              bus.emit("stats:refresh");
            },
          },
        ],
      });
      return;
    }
    if (type === "file") {
      bus.emit("menu:show", {
        x,
        y,
        items: [
          {
            label: "重命名",
            icon: "✂️",
            onClick: async () => {
              try {
                const { showRenameDialog } =
                  await import("./dialogs/rename.js");
                const fileName = path.split(/[/\\]/).pop();
                const newName = await showRenameDialog(path, fileName);
                if (!newName) return;
                const { RenameFile } =
                  await import("../wailsjs/go/main/App.js");
                await RenameFile(path, newName);
                bus.emit("tree:reload");
                bus.emit("stats:refresh");
              } catch (e) {
                bus.emit("toast:show", {
                  msg: "❌ 重命名失败: " + String(e),
                  duration: 4000,
                  type: "error",
                });
              }
            },
          },
          {
            label: "打开所在文件夹",
            icon: "📂",
            onClick: () => {
              const dir = path.substring(0, path.lastIndexOf("\\"));
              window.go.main.App.OpenFolder(dir || path);
            },
          },
        ],
      });
      return;
    }
    if (type === "dir") {
      bus.emit("menu:show", {
        x,
        y,
        items: [
          {
            label: "重命名…",
            icon: "✂️",
            onClick: () => bus.emit("dir:rename", { dir }),
          },
          {
            label: "批量重命名…",
            icon: "📝",
            onClick: () => bus.emit("dir:batch-rename", { dir }),
          },
          {
            label: "打开所在文件夹",
            icon: "📂",
            onClick: () => {
              const { OpenFolder } = window.go.main.App;
              OpenFolder?.(dir || "");
            },
          },
          { divider: true },
          {
            label: "新建子文件夹…",
            icon: "🗂",
            onClick: () => bus.emit("dir:mkdir", { dir }),
          },
          { divider: true },
          {
            label: "移入回收站",
            icon: "♻️",
            danger: true,
            onClick: () => bus.emit("dir:recycle", { dir }),
          },
        ],
      });
      return;
    }
  },
);

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
    // 设置旧版全局 repoRoot（旧代码的拖拽检测依赖它）
    if (cfg.repoRoot) {
      try {
        repoRoot = cfg.repoRoot;
      } catch (_) {}
      try {
        localStorage.setItem("repoRoot", cfg.repoRoot);
      } catch (_) {}
    }
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
