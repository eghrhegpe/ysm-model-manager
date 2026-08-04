// ===== app-tree bus 事件处理 =====
import { friendlyError } from "../../utils/errors.ts";
import { RESOURCE_TYPES } from "../../utils/resource-types.ts";
import { bus } from "../../bus.ts";
import {
  ToggleModelEnable,
  SelectDirectory,
  SaveAppConfig,
  RenameFile,
} from "../../../bindings/ysm-model-manager/internal/app/app.js";
import { get } from "../../services/registry.ts";
import type { loadEntries } from "./loader.ts";
import { initInstanceActions } from "./instance-actions.ts";
import { getApp } from "../../wails/app.ts";
import type { AppTree } from "./index.ts";

export function bindBusEvents(vm: AppTree): Array<() => void> {
  const unsubs: Array<() => void> = [];

  // 整合包右键操作
  unsubs.push(...initInstanceActions(vm));

  // 选择仓库目录
  unsubs.push(
    bus.on("dir:select-repo", async () => {
      try {
        const dir = await SelectDirectory();
        if (!dir) return;
        // 透传用户已保存的 linkMode，避免硬编码 "copy" 冲掉硬链接模式
        const { LoadAppConfig } = await import(
          "../../../bindings/ysm-model-manager/internal/app/app.js"
        );
        const cfg = await LoadAppConfig().catch(() => null);
        const theme = localStorage.getItem("theme") || "dark";
        await SaveAppConfig(dir, "", "", cfg?.linkMode || "copy", theme);
        // repoRoot 由 reload 内 loadEntries → GetRepoRoot(rtype) 按当前类型推导，
        // 不再硬编码 "/ysm"（MMD/VRC/资源包类型的子目录各不相同）
        await reload(vm);
        bus.emit("stats:refresh");
      } catch (err) {
        console.warn("[bus] dir:select-repo 失败:", err);
        vm._entries = [];
        vm._renderTree();
      }
    }),
  );

  // 去重
  unsubs.push(
    bus.on("entries:dedup", () => {
      bus.emit("toast:show", {
        msg: "🔗 去重功能开发中",
        duration: 2000,
        type: "info",
      });
    }),
  );

  // 回收站
  unsubs.push(
    bus.on("recycle:open", () => {
      bus.emit("toast:show", {
        msg: "♻️ 回收站功能开发中",
        duration: 2000,
        type: "info",
      });
    }),
  );

  // 批量启用/禁用全部
  unsubs.push(bus.on("batch:enable-all", () => batchToggleAll(vm, true)));
  unsubs.push(bus.on("batch:disable-all", () => batchToggleAll(vm, false)));

  // 批量启用/禁用文件夹
  unsubs.push(
    bus.on("batch:enable", ({ dir }) => {
      batchToggle(vm, dir, true);
    }),
  );
  unsubs.push(
    bus.on("batch:disable", ({ dir }) => {
      batchToggle(vm, dir, false);
    }),
  );

  // 文件夹操作
  unsubs.push(
    bus.on("dir:rename", async ({ dir }) => {
      const { modalPrompt } = await import("../../dialogs/modal.ts");
      const name = await modalPrompt({
        title: "重命名文件夹",
        icon: "✂️",
        value: dir.split("/").pop(),
        placeholder: "输入新文件夹名称",
        okText: "✂️ 重命名",
      });
      if (!name) return;
      try {
        const { RenameDir, GetRepoRoot } =
          await import("../../../bindings/ysm-model-manager/internal/app/app.js");
        const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
        const absDir = repoRoot ? repoRoot + "/" + dir : dir;
        await RenameDir(absDir, name.trim());
        await reload(vm);
        bus.emit("stats:refresh");
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: 3000,
          type: "error",
        });
      }
    }),
  );

  unsubs.push(
    bus.on("dir:mkdir", async ({ dir }) => {
      const { modalPrompt } = await import("../../dialogs/modal.ts");
      const name = await modalPrompt({
        title: "新建文件夹",
        icon: "📁",
        placeholder: "输入文件夹名称",
        okText: "📁 创建",
      });
      if (!name) return;
      try {
        const { CreateDir, GetRepoRoot } =
          await import("../../../bindings/ysm-model-manager/internal/app/app.js");
        const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
        const absDir = repoRoot
          ? repoRoot + "/" + dir + "/" + name.trim()
          : dir + "/" + name.trim();
        await CreateDir(absDir);
        await reload(vm);
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: 3000,
          type: "error",
        });
      }
    }),
  );

  unsubs.push(
    bus.on("dir:recycle", async ({ dir }) => {
      const { modalConfirm } = await import("../../dialogs/modal.ts");
      const confirmed = await modalConfirm({
        title: "移入回收站",
        icon: "♻️",
        message: `确定将文件夹移入回收站？\n${dir}`,
        okText: "♻️ 移入回收站",
        danger: true,
      });
      if (!confirmed) return;
      try {
        // 加载仓库根目录 → 拼接绝对路径
        const { ListAllFilePaths, MoveToRecycle, RemoveDir, GetRepoRoot } =
          await import("../../../bindings/ysm-model-manager/internal/app/app.js");
        const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
        const absDir = repoRoot ? repoRoot + "/" + dir : dir;
        const allFiles = await ListAllFilePaths(absDir);
        let count = 0;
        const errors: string[] = [];
        for (const p of allFiles || []) {
          try {
            await MoveToRecycle(p);
            count++;
          } catch (ex) {
            errors.push(p.split(/[/\\]/).pop() + ": " + String(ex));
          }
        }
        // 尝试删除空文件夹（必须传绝对路径，相对路径会按进程 CWD 解析）
        try {
          await RemoveDir(absDir);
        } catch {}
        await reload(vm);
        bus.emit("stats:refresh");
        const suffix = errors.length
          ? "，失败 " +
            errors.length +
            " 个（" +
            errors.slice(0, 3).join("; ") +
            "）"
          : "";
        bus.emit("toast:show", {
          msg: `♻️ 已回收 ${count} 个文件` + suffix,
          duration: 3000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: 3000,
          type: "error",
        });
      }
    }),
  );

  unsubs.push(
    bus.on("dir:batch-rename", async ({ dir }) => {
      try {
        const { ScanModelEntries, GetRepoRoot } =
          await import("../../../bindings/ysm-model-manager/internal/app/app.js");
        const repoRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
        const absDir = repoRoot ? repoRoot + "/" + dir : dir;
        const entries = (await ScanModelEntries(absDir)) || [];
        if (!entries || !entries.length) {
          bus.emit("toast:show", {
            msg: "📂 文件夹为空",
            duration: 2000,
            type: "warn",
          });
          return;
        }
        const { showBatchRenameDialog } =
          await import("../../dialogs/batch-rename.ts");
        await showBatchRenameDialog(
          absDir,
          entries.map((e) => ({ Name: e.Name, Path: e.Path })),
          async (renames) => {
          let ok = 0,
            fail = 0;
          for (const r of renames) {
            try {
              await RenameFile(r.oldPath || "", r.newName);
              ok++;
            } catch {
              fail++;
            }
          }
          await reload(vm);
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: `✅ 批量重命名完成：${ok} 成功${fail ? "，失败 " + fail : ""}`,
            duration: 3000,
            type: fail > 0 ? "warn" : "success",
          });
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: 3000,
          type: "error",
        });
      }
    }),
  );

  // Ctrl/Shift 多选 → 批量重命名
  unsubs.push(
    bus.on("batch:rename", async ({ paths }) => {
      if (!paths?.length) return;
      try {
        const entries = paths.map((p) => ({
          Name: p.split(/[/\\]/).pop() || "",
          Path: p,
        }));
        const { showBatchRenameDialog } =
          await import("../../dialogs/batch-rename.ts");
        await showBatchRenameDialog("批量重命名", entries, async (renames) => {
          let ok = 0,
            fail = 0;
          for (const r of renames) {
            try {
              await RenameFile(r.oldPath || "", r.newName);
              ok++;
            } catch {
              fail++;
            }
          }
          await reload(vm);
          bus.emit("stats:refresh");
          bus.emit("toast:show", {
            msg: `✅ 批量重命名完成：${ok} 成功${fail ? "，失败 " + fail : ""}`,
            duration: 3000,
            type: fail > 0 ? "warn" : "success",
          });
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: 3000,
          type: "error",
        });
      }
    }),
  );

  // 树刷新桥接
  unsubs.push(
    bus.on("tree:reload", async () => {
      await reload(vm);
    }),
  );

  return unsubs;
}

// ————————————————————————————
// 辅助函数
// ————————————————————————————

async function reload(vm: AppTree): Promise<void> {
  // 清除扫描缓存，确保操作结果立即可见
  try {
    const App = await getApp();
    if (App.ClearScanCache) await App.ClearScanCache();
  } catch (_) {}
  try {
    const rtype = vm._rootAttr || vm._typeFilter || "";
    const r = await get<typeof loadEntries>("loadEntries")(rtype);
    if (r) {
      vm._repoRoot = r.repoRoot;
      vm._entries = r.entries;
    } else {
      vm._entries = [];
    }
  } catch (err) {
    console.warn("[bus] reload 失败:", err);
    vm._entries = [];
  }
  vm._renderTree();
}

async function batchToggle(
  vm: AppTree,
  dir: string,
  enable: boolean,
): Promise<void> {
  if (vm._batchBusy || vm._toggleBusy) return; // 并发守卫：连点时后来的批量操作直接忽略
  vm._batchBusy = true;
  try {
  const prefix = dir.replace(/\\/g, "/");
  const snapshot = vm._entries
    .filter((e) => e.path && e.path.startsWith(prefix) && e.banned === enable)
    .map((e) => e.fullPath);
  if (!snapshot.length) return;
  let ok = 0,
    fail = 0;
  for (const fullPath of snapshot) {
    try {
      await ToggleModelEnable(fullPath);
      ok++;
    } catch (err) {
      fail++;
      console.warn("[bus] batchToggle 失败:", fullPath, err);
    }
  }
  if (ok > 0) {
    await reload(vm);
    bus.emit("sync:toggle:status");
  }
  bus.emit("toast:show", {
    msg: `批量${enable ? "启用" : "禁用"}: ${ok} 成功, ${fail} 失败`,
    duration: 3000,
    type: fail > 0 ? "warn" : "success",
  });
  } finally {
    vm._batchBusy = false;
  }
}

async function batchToggleAll(vm: AppTree, enable: boolean): Promise<void> {
  if (vm._batchBusy || vm._toggleBusy) return; // 并发守卫：连点时后来的批量操作直接忽略
  vm._batchBusy = true;
  try {
  let ok = 0,
    fail = 0;
  const snapshot = vm._entries
    .filter((e) => e.banned === enable)
    .map((e) => e.fullPath);
  for (const fullPath of snapshot) {
    try {
      await ToggleModelEnable(fullPath);
      ok++;
    } catch (err) {
      fail++;
      console.warn("[bus] batchToggleAll 失败:", fullPath, err);
    }
  }
  if (ok > 0) {
    await reload(vm);
    bus.emit("sync:toggle:status");
  }
  bus.emit("toast:show", {
    msg: `全部${enable ? "启用" : "禁用"}: ${ok} 成功, ${fail} 失败`,
    duration: 3000,
    type: fail > 0 ? "warn" : "success",
  });
  } finally {
    vm._batchBusy = false;
  }
}
