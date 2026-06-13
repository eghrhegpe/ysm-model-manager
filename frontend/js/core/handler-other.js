// ===== 整合包操作：导出清单 / 清空目录 =====
import { bus } from "../bus.js";
import { modalConfirm } from "../dialogs/modal.js";

export function registerInstanceOps(unsubs) {
  // 导出文件清单到剪贴板（支持 rtype 筛选）
  unsubs.push(
    bus.on("instance:export-list", async ({ name: insName, rtype }) => {
      try {
        const {
          LoadAppConfig,
          ListVersionInstances,
          ListFileNames,
          GetRepoRoot,
        } = await import("../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const mcRoot = cfg.mcRoot || "";
        if (!mcRoot) {
          bus.emit("toast:show", {
            msg: "请先设置游戏路径",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        const instances = await ListVersionInstances(mcRoot);
        const ins = instances.find((i) => i.Name === insName);
        if (!ins?.VersionDir) {
          bus.emit("toast:show", {
            msg: "未找到整合包",
            duration: 3000,
            type: "error",
          });
          return;
        }

        // 子目录映射（与 types.SubDirMap 保持一致）
        const subDirMap = {
          ysm: "config/yes_steve_model/custom",
          "mmd-skin": "3d-skin/EntityPlayer",
          "vrchat-avatar": "vrchat-avatars",
          resourcepack: "resourcepacks",
          shaderpack: "shaderpacks",
          "create-blueprint": "schematics",
        };

        let dirs = [];
        let labels = [];
        if (rtype && subDirMap[rtype]) {
          dirs = [ins.VersionDir + "/" + subDirMap[rtype]];
          labels = [rtype];
        } else {
          for (const [rt, sub] of Object.entries(subDirMap)) {
            dirs.push(ins.VersionDir + "/" + sub);
            labels.push(rt);
          }
        }

        let allLines = [`📦 ${insName}`];
        let totalFiles = 0;
        for (let i = 0; i < dirs.length; i++) {
          try {
            const files = await ListFileNames(dirs[i]);
            if (files?.length) {
              allLines.push(`\n── ${labels[i]} (${files.length}) ──`);
              allLines.push(...files);
              totalFiles += files.length;
            }
          } catch {}
        }

        if (!totalFiles) {
          bus.emit("toast:show", {
            msg: "该整合包没有资源文件",
            duration: 2000,
            type: "info",
          });
          return;
        }

        const text = allLines.join("\n");
        await navigator.clipboard.writeText(text);
        bus.emit("toast:show", {
          msg: `📋 已复制 ${totalFiles} 个文件清单到剪贴板`,
          duration: 3000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 导出失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      }
    }),
  );

  // 清空整合包内所有资源类型的文件（走回收站）
  unsubs.push(
    bus.on("instance:clear", async ({ name: insName }) => {
      try {
        const { LoadAppConfig, CountInstanceResources } =
          await import("../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const mcRoot = cfg.mcRoot || "";
        if (!mcRoot) {
          bus.emit("toast:show", {
            msg: "请先设置游戏路径",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        // 先统计数量
        let totalCount = 0;
        try {
          totalCount = await CountInstanceResources(insName);
        } catch {}
        if (totalCount === 0) {
          bus.emit("toast:show", {
            msg: "该整合包没有可清空的资源文件",
            duration: 2000,
            type: "info",
          });
          return;
        }
        const confirmed = await modalConfirm({
          title: "清空整合包",
          icon: "🗑️",
          message: `清空 ${insName}\n扫描到 ${totalCount} 个资源文件将被清空（走回收站，可恢复）。\n涉及类型：YSM/MMD/VRC/材质包/光影包/蓝图\n未入库的文件保留不动。确定继续吗？`,
          okText: "🗑️ 清空",
          danger: true,
        });
        if (!confirmed) {
          bus.emit("toast:show", {
            msg: "已取消",
            duration: 1500,
            type: "info",
          });
          return;
        }
        try {
          const { ClearInstanceResources } =
            await import("../../wailsjs/go/main/App.js");
          const count = await ClearInstanceResources(insName);
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: `🗑️ ${insName}: 已清空 ${count} 个文件（移入回收站）`,
            duration: 3000,
            type: "success",
          });
        } catch (err) {
          bus.emit("toast:show", {
            msg: `❌ 清空失败: ${String(err)}`,
            duration: 5000,
            type: "error",
          });
        }
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 操作失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      }
    }),
  );
}
