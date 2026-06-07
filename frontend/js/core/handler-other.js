// ===== 整合包操作：导出清单 / 清空目录 =====
import { bus } from "../bus.js";
import { modalConfirm } from "../dialogs/modal.js";

export function registerInstanceOps(unsubs) {
  // 导出文件清单到剪贴板
  unsubs.push(
    bus.on("instance:export-list", async ({ name: insName }) => {
      try {
        const { LoadAppConfig, ListVersionInstances, ListFileNames } =
          await import("../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const mcRoot = cfg.mcRoot || "";
        if (!mcRoot) {
          bus.emit("toast:show", { msg: "请先设置游戏路径", duration: 3000, type: "warn" });
          return;
        }
        const instances = await ListVersionInstances(mcRoot);
        const ins = instances.find((i) => i.Name === insName);
        if (!ins?.CustomDir) {
          bus.emit("toast:show", { msg: "未找到整合包", duration: 3000, type: "error" });
          return;
        }
        const files = await ListFileNames(ins.CustomDir);
        if (!files?.length) {
          bus.emit("toast:show", { msg: "该整合包没有模型文件", duration: 2000, type: "info" });
          return;
        }
        const text = `📦 ${insName}\n📁 ${ins.CustomDir}\n📄 共 ${files.length} 个文件\n\n${files.join("\n")}`;
        await navigator.clipboard.writeText(text);
        bus.emit("toast:show", {
          msg: `📋 已复制 ${files.length} 个文件清单到剪贴板`, duration: 3000, type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", { msg: `❌ 导出失败: ${String(e)}`, duration: 5000, type: "error" });
      }
    }),
  );

  // 清空整合包内已在仓库的模型
  unsubs.push(
    bus.on("instance:clear", async ({ name: insName }) => {
      try {
        const { LoadAppConfig, ListVersionInstances } =
          await import("../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const mcRoot = cfg.mcRoot || "";
        if (!mcRoot) {
          bus.emit("toast:show", { msg: "请先设置游戏路径", duration: 3000, type: "warn" });
          return;
        }
        const instances = await ListVersionInstances(mcRoot);
        const ins = instances.find((i) => i.Name === insName);
        if (!ins?.CustomDir) {
          bus.emit("toast:show", { msg: "未找到整合包", duration: 3000, type: "error" });
          return;
        }
        const confirmed = await modalConfirm({
          title: "清空整合包", icon: "🗑️",
          message: `清空 ${insName}\n将删除整合包内已在仓库的模型（仓库保留原件），未入库的文件将被跳过。确定继续吗？`,
          okText: "🗑️ 清空", danger: true,
        });
        if (!confirmed) {
          bus.emit("toast:show", { msg: "已取消", duration: 1500, type: "info" });
          return;
        }
        try {
          const { ClearCustomDir } = await import("../../wailsjs/go/main/App.js");
          const count = await ClearCustomDir(ins.CustomDir);
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: `🗑️ ${insName}: 已清空 ${count} 个文件`, duration: 3000, type: "success",
          });
        } catch (err) {
          bus.emit("toast:show", { msg: `❌ 清空失败: ${String(err)}`, duration: 5000, type: "error" });
        }
      } catch (e) {
        bus.emit("toast:show", { msg: `❌ 操作失败: ${String(e)}`, duration: 5000, type: "error" });
      }
    }),
  );
}
