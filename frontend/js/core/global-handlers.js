// ===== 全局操作事件处理（常驻，不依赖任何组件挂载） =====
// app-content/index.js 调用此模块注册所有 handler

import { bus } from "../bus.js";

/** 注册所有全局 handler，返回 unsub 函数数组 */
export function registerGlobalHandlers() {
  const unsubs = [];

  // 导入仓库模型到所有整合包
  unsubs.push(
    bus.on("sync:download-missing", async () => {
      console.log("[global] sync:download-missing");
      try {
        const {
          LoadAppConfig,
          ListVersionInstances,
          GetInstanceStatus,
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
        const statusList = await GetInstanceStatus(mcRoot, repoRoot);
        let totalOk = 0,
          totalFail = 0;
        for (const st of statusList || []) {
          for (const srcPath of st.Missing || []) {
            try {
              const ins = instances.find((i) => i.Name === st.Name);
              if (!ins?.CustomDir) continue;
              await InstallModelTo(srcPath, ins.CustomDir);
              totalOk++;
            } catch {
              totalFail++;
            }
          }
        }
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: `📥 导入完成: ${totalOk} 成功, ${totalFail} 失败`,
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
        bus.emit("sync:download-complete");
        bus.emit("tree:reload");
      }
    }),
  );

  // 同步状态：仓库启用/禁用 → 所有整合包
  unsubs.push(
    bus.on("sync:toggle-status", async () => {
      console.log("[global] sync:toggle-status");
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
        bus.emit("toast:show", {
          msg: `✅ 同步完成：禁用 ${totalDisable} 项，启用 ${totalEnable} 项`,
          duration: 3000,
          type: "success",
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
        bus.emit("sync:toggle-complete");
        bus.emit("tree:reload");
      }
    }),
  );

  // 上传新模型到仓库
  unsubs.push(
    bus.on("stats:upload", async () => {
      console.log("[global] stats:upload");
      try {
        const {
          LoadAppConfig,
          ListVersionInstances,
          GetInstanceStatus,
          ScanModelEntries,
          SyncCustomToRepo,
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
        const repoEntries = await ScanModelEntries(repoRoot);
        const repoNames = new Set((repoEntries || []).map((e) => e.Name));
        const allInstances = await ListVersionInstances(mcRoot);
        const statusList = await GetInstanceStatus(mcRoot, repoRoot);
        const pendingList = [];
        (statusList || []).forEach((s) => {
          (s.Extra || []).forEach((name) => {
            if (!repoNames.has(name)) {
              const ins = allInstances.find((x) => x.Name === s.Name);
              pendingList.push({ name, customDir: ins ? ins.CustomDir : "" });
            }
          });
        });
        if (!pendingList.length) {
          bus.emit("toast:show", {
            msg: "没有待上传的模型",
            duration: 2000,
            type: "info",
          });
          return;
        }
        let ok = 0,
          fail = 0;
        for (const item of pendingList) {
          if (!item.customDir) {
            fail++;
            continue;
          }
          try {
            const n = await SyncCustomToRepo(item.customDir, repoRoot);
            if (n > 0) ok++;
            else fail++;
          } catch {
            fail++;
          }
        }
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: `📤 上传完成: ${ok} 成功, ${fail} 失败`,
          duration: 4000,
          type: fail > 0 ? "warn" : "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 上传失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      } finally {
        bus.emit("sync:upload-complete");
        bus.emit("tree:reload");
      }
    }),
  );

  // 导出文件清单
  unsubs.push(
    bus.on("instance:export-list", async ({ name: insName }) => {
      try {
        const { LoadAppConfig, ListVersionInstances, ListFileNames } =
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
        const instances = await ListVersionInstances(mcRoot);
        const ins = instances.find((i) => i.Name === insName);
        if (!ins?.CustomDir) {
          bus.emit("toast:show", {
            msg: "未找到整合包",
            duration: 3000,
            type: "error",
          });
          return;
        }
        const files = await ListFileNames(ins.CustomDir);
        if (!files?.length) {
          bus.emit("toast:show", {
            msg: "该整合包没有模型文件",
            duration: 2000,
            type: "info",
          });
          return;
        }
        const text = `📦 ${insName}\n📁 ${ins.CustomDir}\n📄 共 ${files.length} 个文件\n\n${files.join("\n")}`;
        await navigator.clipboard.writeText(text);
        bus.emit("toast:show", {
          msg: `📋 已复制 ${files.length} 个文件清单到剪贴板`,
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

  // 清空目录
  unsubs.push(
    bus.on("instance:clear", async ({ name: insName }) => {
      try {
        const { LoadAppConfig, ListVersionInstances } =
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
        const instances = await ListVersionInstances(mcRoot);
        const ins = instances.find((i) => i.Name === insName);
        if (!ins?.CustomDir) {
          bus.emit("toast:show", {
            msg: "未找到整合包",
            duration: 3000,
            type: "error",
          });
          return;
        }
        const confirmed = await window.showConfirm?.(
          `🗑️ 清空 ${insName}\n将删除整合包内已在仓库的模型（仓库保留原件），未入库的文件将被跳过。确定继续吗？`,
        );
        if (!confirmed) {
          bus.emit("toast:show", {
            msg: "已取消",
            duration: 1500,
            type: "info",
          });
          return;
        }
        try {
          const { ClearCustomDir } =
            await import("../../wailsjs/go/main/App.js");
          const count = await ClearCustomDir(ins.CustomDir);
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: `🗑️ ${insName}: 已清空 ${count} 个文件`,
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

  return unsubs;
}
