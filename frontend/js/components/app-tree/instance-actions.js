// ===== 整合包右键操作实现 =====
import { bus } from "../../bus.js";
import {
  SelectDirectory,
  ScanModelEntries,
  InstallModelFile,
  ListVersionInstances,
  SyncCustomToRepo,
} from "../../../wailsjs/go/main/App.js";

function addImportLog(type, name, path, size, status, msg) {
  import("../../../wailsjs/go/main/App.js")
    .then((mod) => {
      mod.AddImportLog?.(type, name, path, size, status, msg);
    })
    .catch(() => {});
}

// 安装模型到整合包：打开文件选择器 -> 导入
export function initInstanceActions(vm) {
  const unsubs = [];

  unsubs.push(
    bus.on("instance:install", async ({ name: insName }) => {
      try {
        const filePaths = await SelectDirectory();
        if (!filePaths) return;
        // 获取整合包目录
        const cfg = await (
          await import("../../../wailsjs/go/main/App.js")
        ).LoadAppConfig();
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
        if (!ins || !ins.CustomDir) {
          bus.emit("toast:show", {
            msg: "未找到整合包目录",
            duration: 3000,
            type: "error",
          });
          return;
        }
        // 选择一个 .ysm 文件导入
        const { InstallModelWithOverlay } =
          await import("../../../wailsjs/go/main/App.js");
        const result = await InstallModelWithOverlay(
          filePaths,
          ins.CustomDir,
          false,
        );
        addImportLog(
          "install",
          insName,
          filePaths,
          0,
          result ? "success" : "skipped",
          result ? "安装成功" : "文件已存在",
        );
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: result ? `✅ 已安装到 ${insName}` : "⏭️ 文件已存在",
          duration: 3000,
          type: result ? "success" : "info",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 安装失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      }
    }),
  );

  unsubs.push(
    bus.on("instance:sync", async ({ name: insName }) => {
      try {
        const cfg = await (
          await import("../../../wailsjs/go/main/App.js")
        ).LoadAppConfig();
        const mcRoot = cfg.mcRoot || "";
        const repoRoot = cfg.repoRoot || "";
        if (!mcRoot || !repoRoot) {
          bus.emit("toast:show", {
            msg: "请先设置路径",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        const instances = await ListVersionInstances(mcRoot);
        const ins = instances.find((i) => i.Name === insName);
        if (!ins || !ins.CustomDir) {
          bus.emit("toast:show", {
            msg: "未找到整合包",
            duration: 3000,
            type: "error",
          });
          return;
        }
        const { SyncCustomToRepo } =
          await import("../../../wailsjs/go/main/App.js");
        const repoEntries = await ScanModelEntries(repoRoot);
        const repoNames = new Set(
          (repoEntries || []).map((e) => e.Name.replace(/\.ban$/i, "")),
        );
        const insEntries = await ScanModelEntries(ins.CustomDir);
        let uploaded = 0,
          downloaded = 0;
        // 上传整合包特有 -> 仓库
        (insEntries || []).forEach((e) => {
          const base = e.Name.replace(/\.ban$/i, "");
          if (!repoNames.has(base)) uploaded++;
        });
        // 下载仓库有但整合包没有的
        const insNames = new Set(
          (insEntries || []).map((e) => e.Name.replace(/\.ban$/i, "")),
        );
        repoNames.forEach((n) => {
          if (!insNames.has(n)) downloaded++;
        });
        if (uploaded > 0) await SyncCustomToRepo(ins.CustomDir, repoRoot);
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: `🔄 ${insName} 同步完成 | 📤 ${uploaded} 📥 ${downloaded}`,
          duration: 3000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 同步失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      }
    }),
  );

  return unsubs;
}
