// ===== 全局操作事件处理（常驻，不依赖任何组件挂载） =====
// app-content/index.js 调用此模块注册所有 handler

import { bus } from "../bus.js";
import { modalConfirm } from "../dialogs/modal.js";

/** 注册所有全局 handler，返回 unsub 函数数组 */
export function registerGlobalHandlers() {
  const unsubs = [];

  // ===== 全局拖拽导入 =====
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const MAX_FILE_COUNT = 50; // 单次最多 50 个文件
  let dropOverlay = null;
  let dropLeaveTimer = null;

  const showDropOverlay = (hasModel) => {
    if (!dropOverlay) {
      dropOverlay = document.createElement("div");
      dropOverlay.id = "global-drop-overlay";
      dropOverlay.textContent = "📥 拖放以上模型文件";
      Object.assign(dropOverlay.style, {
        position: "fixed", inset: "0", zIndex: "999999",
        display: "none", alignItems: "center", justifyContent: "center",
        background: "color-mix(in srgb, var(--accent,#66d9ef) 8%, transparent)",
        border: "3px dashed var(--accent,#66d9ef)",
        fontSize: "18px", fontWeight: "600", color: "var(--accent,#66d9ef)",
        pointerEvents: "none", transition: "all .15s",
      });
      document.body.appendChild(dropOverlay);
    }
    // 无模型文件时变红提示
    if (hasModel === false) {
      dropOverlay.style.background = "color-mix(in srgb, #f38ba8 10%, transparent)";
      dropOverlay.style.borderColor = "#f38ba8";
      dropOverlay.style.color = "#f38ba8";
      dropOverlay.textContent = "⛔ 未检测到模型文件";
    } else {
      dropOverlay.style.background = "color-mix(in srgb, var(--accent,#66d9ef) 8%, transparent)";
      dropOverlay.style.borderColor = "var(--accent,#66d9ef)";
      dropOverlay.style.color = "var(--accent,#66d9ef)";
      dropOverlay.textContent = "📥 拖放以上模型文件";
    }
    dropOverlay.style.display = "flex";
    dropOverlay.style.opacity = "1";
  };
  const hideDropOverlay = () => {
    if (dropLeaveTimer) clearTimeout(dropLeaveTimer);
    if (dropOverlay) {
      dropOverlay.style.opacity = "0";
      setTimeout(() => { if (dropOverlay) dropOverlay.style.display = "none"; }, 150);
    }
  };

  const isEditable = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

  // 带超时的 FileReader 封装（3 秒熔断）
  const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timer = setTimeout(() => { reader.abort(); reject(new Error("timeout")); }, 3000);
    reader.onload = () => { clearTimeout(timer); resolve(reader.result.split(",")[1]); };
    reader.onerror = () => { clearTimeout(timer); reject(reader.error); };
    reader.readAsDataURL(file);
  });

  const onDragOver = (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    if (isEditable(e.target)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    // 检查是否有模型文件，决定遮罩颜色
    const items = Array.from(e.dataTransfer?.items || []);
    const hasModel = items.some((item) => /\.(ysm|zip|7z)$/i.test(item.name || ""));
    showDropOverlay(hasModel);
  };
  const onDragLeave = (e) => {
    // 延迟 100ms 再隐藏，防止鼠标短暂离开窗口边缘
    if (dropLeaveTimer) clearTimeout(dropLeaveTimer);
    dropLeaveTimer = setTimeout(() => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        hideDropOverlay();
      }
    }, 100);
  };
  const onDrop = (e) => {
    hideDropOverlay();
    e.preventDefault();
    if (isEditable(e.target)) return;
    if (window.__YSMPendingLock) return;

    // 收集所有文件（含文件夹递归）
    const collectFiles = (items, out) => {
      for (const item of items) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          // 递归读取文件夹
          const reader = entry.createReader();
          const readDir = () => {
            reader.readEntries((entries) => {
              if (entries.length === 0) return;
              for (const e of entries) {
                if (e.isDirectory) {
                  const subReader = e.createReader();
                  const readSub = () => {
                    subReader.readEntries((sub) => {
                      if (sub.length === 0) return;
                      for (const s of sub) {
                        if (s.isFile && /\.(ysm|zip|7z)$/i.test(s.name)) {
                          collectFiles([s], out);
                        }
                      }
                      readSub();
                    });
                  };
                  readSub();
                } else if (e.isFile && /\.(ysm|zip|7z)$/i.test(e.name)) {
                  e.file((f) => out.push(f));
                }
              }
              readDir();
            });
          };
          readDir();
        } else if (entry?.isFile && /\.(ysm|zip|7z)$/i.test(entry.name)) {
          entry.file((f) => out.push(f));
        } else if (item.getAsFile && /\.(ysm|zip|7z)$/i.test(item.name || "")) {
          const f = item.getAsFile();
          if (f) out.push(f);
        }
      }
    };

    const allFiles = [];
    const items = Array.from(e.dataTransfer?.items || []);
    // 优先从 files 直接取（拖多个文件时更快）
    const directFiles = Array.from(e.dataTransfer?.files || []);
    const valid = directFiles.filter((f) => /\.(ysm|zip|7z)$/i.test(f.name));
    if (valid.length > 0) {
      allFiles.push(...valid);
    } else if (items.length > 0) {
      // files 为空但 items 有内容 → 可能是文件夹拖入
      collectFiles(items, allFiles);
    }

    if (allFiles.length === 0) {
      bus.emit("toast:show", {
        msg: "📂 未检测到模型文件（.ysm / .zip / .7z）",
        duration: 3000, type: "info",
      });
      return;
    }

    // 数量熔断
    if (allFiles.length > MAX_FILE_COUNT) {
      bus.emit("toast:show", {
        msg: `⚠️ 单次导入文件过多（${allFiles.length} 个），请分批处理`,
        duration: 5000, type: "warn",
      });
      return;
    }

    // 大小检查
    const oversized = allFiles.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      bus.emit("toast:show", {
        msg: `⚠️ ${oversized[0].name} 超过 10MB，请直接放入仓库文件夹`,
        duration: 5000, type: "warn",
      });
      return;
    }

    window.__pendingImport = allFiles.map((f) => ({ name: f.name, file: f }));
    // 已经在导入页则直接处理，否则跳转
    if (window.__currentPage === "downloads") {
      bus.emit("import:pending-files");
    } else {
      bus.emit("nav:change", { page: "downloads" });
    }
  };
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  unsubs.push(() => document.removeEventListener("dragover", onDragOver));
  unsubs.push(() => document.removeEventListener("dragleave", onDragLeave));
  unsubs.push(() => document.removeEventListener("drop", onDrop));
  unsubs.push(() => { if (dropOverlay) { dropOverlay.remove(); dropOverlay = null; } });

  // 跟踪当前页面
  bus.on("nav:changed", ({ page }) => { window.__currentPage = page; });

  // 导入仓库模型到整合包（指定 instanceName 则只导入到该包，否则导入到所有）
  unsubs.push(
    bus.on("sync:download-missing", async ({ instanceName } = {}) => {
      console.log("[global] sync:download-missing", instanceName || "all");
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
        // 指定了整合包则只处理该包，否则处理所有
        const targets = instanceName
          ? (statusList || []).filter((st) => st.Name === instanceName)
          : statusList || [];
        let totalOk = 0,
          totalFail = 0;
        for (const st of targets) {
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
        const parts = [];
        if (totalDisable > 0) parts.push(`禁用 ${totalDisable} 项`);
        if (totalEnable > 0) parts.push(`启用 ${totalEnable} 项`);
        if (!parts.length) {
          parts.push("状态已一致，无需更改");
          // 单个实例时额外检查是否实际有动作
          const activeInstances = instances.filter((i) => i.Exists);
          if (activeInstances.length === 1) {
            parts.push("（整合包文件已匹配）");
          }
        }
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
        const confirmed = await modalConfirm({
          title: "清空整合包",
          icon: "🗑️",
          message: `清空 ${insName}\n将删除整合包内已在仓库的模型（仓库保留原件），未入库的文件将被跳过。确定继续吗？`,
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
