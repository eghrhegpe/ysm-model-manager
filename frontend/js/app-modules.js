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
import { ToggleModelEnable, AnalyzeYSMModel } from "../wailsjs/go/main/App.js";

bus.on("ctx:show", ({ x, y, type, instanceName, path, banned, dir, name }) => {
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
          label: "安装缺失",
          icon: "⬇️",
          onClick: () => bus.emit("sync:download-missing"),
        },
        {
          label: "导出文件清单",
          icon: "📄",
          onClick: () =>
            bus.emit("instance:export-list", { name: instanceName }),
        },
        { divider: true },
        // 危险操作
        {
          label: "清空目录",
          icon: "🗑️",
          danger: true,
          onClick: () => bus.emit("instance:clear", { name: instanceName }),
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
          label: banned ? "✅ 启用" : "⛔ 禁用",
          icon: banned ? "✅" : "⛔",
          onClick: async () => {
            try {
              await ToggleModelEnable(path);
              bus.emit("stats:refresh");
              const tree = document.querySelector("app-tree");
              if (tree) {
                await tree._load();
                tree._renderTree();
              }
            } catch (_) {}
          },
        },
        {
          label: "📄 模型详情",
          icon: "📄",
          onClick: async () => {
            try {
              const meta = await AnalyzeYSMModel(path);
              bus.emit("model:select", { path, meta });
            } catch (_) {
              bus.emit("model:select", { path });
            }
          },
        },
        {
          label: "📂 打开所在文件夹",
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
    // 文件夹右键功能已迁移到前面的大图标开关，不再需要菜单
    return;
  }
});

// ===== 窗口状态实时保存 =====
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    try {
      const { SaveWindowPosition } = await import("../wailsjs/go/main/App.js");
      const w = window.innerWidth;
      const h = window.innerHeight;
      const x = window.screenX || 0;
      const y = window.screenY || 0;
      await SaveWindowPosition(x, y, w, h);
    } catch (_) {}
  }, 500);
});
