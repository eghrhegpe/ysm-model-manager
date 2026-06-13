// ===== 同步相关：导入缺失 / 同步启用状态 =====
import { bus } from "../bus.js";

export function registerSync(unsubs) {
  // 导入仓库模型到整合包
  unsubs.push(
    bus.on("sync:download-missing", async ({ instanceName, rtype } = {}) => {
      console.log(
        "[sync] download-missing",
        instanceName || "all",
        "rtype:",
        rtype,
      );
      try {
        const {
          LoadAppConfig,
          ListVersionInstances,
          GetResourceInstanceStatus,
          InstallModelTo,
        } = await import("../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
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
        let totalOk = 0,
          totalFail = 0;
        // 只安装当前资源类型的缺失文件
        const rtypeActual = rtype || "ysm";
        const targets = instanceName
          ? instances.filter((i) => i.Name === instanceName)
          : instances;
        for (const ins of targets) {
          if (!ins.CustomDir) continue;
          const statusList = await GetResourceInstanceStatus(
            rtypeActual,
            mcRoot,
            repoRoot,
          );
          const st = (statusList || []).find((s) => s.Name === ins.Name);
          if (!st?.Missing?.length) continue;
          for (const srcPath of st.Missing) {
            try {
              await InstallModelTo(srcPath, ins.CustomDir);
              totalOk++;
            } catch {
              totalFail++;
            }
          }
        }
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: instanceName
            ? `📥 ${instanceName}: 导入 ${totalOk} 成功, ${totalFail} 失败`
            : `📥 全部导入完成: ${totalOk} 成功, ${totalFail} 失败`,
          duration: 4000,
          type: totalFail > 0 ? "warn" : "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 导入失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      } finally {
        bus.emit("sync:download:done");
        bus.emit("tree:reload");
      }
    }),
  );

  // 同步启用/禁用状态到所有整合包
  unsubs.push(
    bus.on("sync:toggle-status", async () => {
      console.log("[sync] toggle-status");
      try {
        const {
          LoadAppConfig,
          ListVersionInstances,
          SyncModelToggleStatus,
          AddImportLog,
        } = await import("../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || "";
        const mcRoot = cfg.mcRoot || "";
        if (!repoRoot || !mcRoot) {
          bus.emit("toast:show", {
            msg: "请先配置目录",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        const instances = await ListVersionInstances(mcRoot);
        if (!instances?.length) {
          bus.emit("toast:show", {
            msg: "没有找到整合包",
            duration: 2000,
            type: "info",
          });
          return;
        }
        let totalDisable = 0,
          totalEnable = 0,
          errors = [];
        for (const ins of instances) {
          if (!ins.Exists) continue;
          try {
            const res = await SyncModelToggleStatus(ins.CustomDir, repoRoot);
            totalDisable += res?.r0 || res?.[0] || 0;
            totalEnable += res?.r1 || res?.[1] || 0;
          } catch (e) {
            errors.push(`${ins.Name}: ${String(e)}`);
          }
        }
        await AddImportLog(
          "sync-status",
          `同步状态 (${instances.filter((i) => i.Exists).length} 个整合包)`,
          repoRoot,
          0,
          errors.length ? "failed" : "success",
          `禁用 ${totalDisable} 启用 ${totalEnable}${errors.length ? ` | 错误: ${errors.join("; ")}` : ""}`,
        );
        const parts = [];
        if (totalDisable > 0) parts.push(`禁用 ${totalDisable} 项`);
        if (totalEnable > 0) parts.push(`启用 ${totalEnable} 项`);
        if (!parts.length) parts.push("状态已一致，无需更改");
        bus.emit("toast:show", {
          msg: `✅ 同步完成：${parts.join("，")}`,
          duration: 4000,
          type:
            totalDisable + totalEnable > 0 || errors.length === 0
              ? "success"
              : "warn",
        });
        bus.emit("stats:refresh");
        bus.emit("logs:refresh");
      } catch (err) {
        const { AddImportLog } = await import("../../wailsjs/go/main/App.js");
        await AddImportLog(
          "sync-status",
          "同步失败",
          "",
          0,
          "failed",
          String(err),
        );
        bus.emit("toast:show", {
          msg: `同步失败: ${String(err)}`,
          duration: 8000,
          type: "error",
        });
      } finally {
        bus.emit("sync:toggle:done");
        bus.emit("tree:reload");
      }
    }),
  );
}
