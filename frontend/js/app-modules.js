// ===== 所有 ES module 组件的统一入口 =====
import "./components/app-tree/index.js";
import "./components/app-sidebar/index.js";
import "./components/app-preview/index.js";
import "./components/app-content/index.js";

// ===== 旧版模块移植 =====
import "./core/lifecycle.js";
import "./core/buttons.js";
import "./core/directories.js";
import "./lib/parse.js";
import "./lib/tree.js";
import "./lib/state.js";
import "./ui/cm-tree.js";
import "./versions/renderer.js";
import "./versions/versions.js";
import "./versions/data.js";
import "./versions/ops.js";
import "./versions/events.js";

// ===== 全局右键菜单映射 =====
import { ToggleModelEnable, AnalyzeYSMModel } from "../wailsjs/go/main/App.js";

let _ctxDirEntries = [];

bus.on("ctx:show", ({ x, y, type, instanceName, path, banned, dir, name }) => {
  if (type === "instance") {
    bus.emit("menu:show", {
      x,
      y,
      items: [
        { label: "📦 " + instanceName, icon: "📦", onClick: () => {} },
        { divider: true },
        {
          label: "📥 安装模型",
          onClick: () => bus.emit("instance:install", { name: instanceName }),
        },
        {
          label: "🔄 同步状态",
          onClick: () => bus.emit("instance:sync", { name: instanceName }),
        },
        {
          label: "🗑️ 清空目录",
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
              // 通知树刷新
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
    bus.emit("menu:show", {
      x,
      y,
      items: [
        {
          label: "✅ 全部启用",
          icon: "✅",
          onClick: () => bus.emit("batch:enable", { dir }),
        },
        {
          label: "⛔ 全部禁用",
          icon: "⛔",
          onClick: () => bus.emit("batch:disable", { dir }),
        },
      ],
    });
    return;
  }
});
