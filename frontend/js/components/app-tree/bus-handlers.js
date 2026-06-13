// ===== app-tree bus 事件处理 =====
import { friendlyError } from "../../utils/errors.js";
import { bus } from "../../bus.js";
import {
  ToggleModelEnable,
  SelectDirectory,
  SaveAppConfig,
} from "../../../wailsjs/go/main/App.js";
import { loadEntries } from "./loader.js";
import { initInstanceActions } from "./instance-actions.js";

export function bindBusEvents(vm) {
  const unsubs = [];

  // 整合包右键操作
  unsubs.push(...initInstanceActions(vm));

  // 启用/禁用
  unsubs.push(
    bus.on("entry:toggle", async ({ path }) => {
      try {
        await ToggleModelEnable(path);
        // 自动同步禁用/启用状态到所有整合包
        try {
          const { LoadAppConfig, ListVersionInstances, SyncModelToggleStatus } =
            await import("../../../wailsjs/go/main/App.js");
          const cfg = await LoadAppConfig();
          const repoRoot = cfg.repoRoot || "";
          const mcRoot = cfg.mcRoot || "";
          if (repoRoot && mcRoot) {
            const instances = await ListVersionInstances(mcRoot);
            for (const ins of instances) {
              if (!ins.Exists) continue;
              try {
                await SyncModelToggleStatus(ins.CustomDir, repoRoot);
              } catch {}
            }
          }
        } catch {}
      } catch (_) {}
      await reload(vm);
      bus.emit("stats:refresh");
    }),
  );

  // 选择仓库目录
  unsubs.push(
    bus.on("dir:select-repo", async () => {
      try {
        const dir = await SelectDirectory();
        if (!dir) return;
        const theme = localStorage.getItem("theme") || "dark";
        await SaveAppConfig(dir, "", "", "copy", theme);
        vm._repoRoot = dir;
        await reload(vm);
        bus.emit("stats:refresh");
      } catch (_) {
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
      const { modalPrompt } = await import("../../dialogs/modal.js");
      const name = await modalPrompt({
        title: "重命名文件夹",
        icon: "✂️",
        value: dir.split("/").pop(),
        placeholder: "输入新文件夹名称",
        okText: "✂️ 重命名",
      });
      if (!name) return;
      try {
        const { LoadAppConfig, RenameDir } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || "";
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
      const { modalPrompt } = await import("../../dialogs/modal.js");
      const name = await modalPrompt({
        title: "新建文件夹",
        icon: "📁",
        placeholder: "输入文件夹名称",
        okText: "📁 创建",
      });
      if (!name) return;
      try {
        const { LoadAppConfig, CreateDir } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || "";
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
      const { modalConfirm } = await import("../../dialogs/modal.js");
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
        const { LoadAppConfig, ScanModelEntries, MoveToRecycle } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || "";
        const absDir = repoRoot ? repoRoot + "/" + dir : dir;
        const entries = await ScanModelEntries(absDir);
        let count = 0,
          errors = [];
        for (const e of entries || []) {
          try {
            await MoveToRecycle(e.Path);
            count++;
          } catch (ex) {
            errors.push(e.Name + ": " + String(ex));
          }
        }
        // 尝试删除空文件夹
        try {
          const { RemoveDir } = await import("../../../wailsjs/go/main/App.js");
          await RemoveDir(dir);
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
        const { LoadAppConfig, ScanModelEntries, RenameFile } =
          await import("../../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || "";
        const absDir = repoRoot ? repoRoot + "/" + dir : dir;
        const entries = await ScanModelEntries(absDir);
        if (!entries || !entries.length) {
          bus.emit("toast:show", {
            msg: "📂 文件夹为空",
            duration: 2000,
            type: "warn",
          });
          return;
        }
        const { showBatchRenameDialog } =
          await import("../../dialogs/batch-rename.js");
        await showBatchRenameDialog(absDir, entries, async (renames) => {
          let ok = 0,
            fail = 0;
          for (const r of renames) {
            try {
              await RenameFile(r.oldPath, r.newName);
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
        const { RenameFile } = await import("../../../wailsjs/go/main/App.js");
        const entries = paths.map((p) => ({
          Name: p.split(/[/\\]/).pop(),
          Path: p,
        }));
        const { showBatchRenameDialog } =
          await import("../../dialogs/batch-rename.js");
        await showBatchRenameDialog("批量重命名", entries, async (renames) => {
          let ok = 0,
            fail = 0;
          for (const r of renames) {
            try {
              await RenameFile(r.oldPath, r.newName);
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

async function reload(vm) {
  try {
    const rtype = vm._rootAttr || vm._typeFilter || "";
    const r = await loadEntries(rtype);
    if (r) {
      vm._repoRoot = r.repoRoot;
      vm._entries = r.entries;
    } else {
      vm._entries = [];
    }
  } catch (_) {
    vm._entries = [];
  }
  vm._renderTree();
}

async function batchToggle(vm, dir, enable) {
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
    } catch (_) {
      fail++;
    }
  }
  if (ok > 0) {
    await reload(vm);
    bus.emit("sync:toggle-status");
  }
  bus.emit("toast:show", {
    msg: `批量${enable ? "启用" : "禁用"}: ${ok} 成功, ${fail} 失败`,
    duration: 3000,
    type: fail > 0 ? "warn" : "success",
  });
}

async function batchToggleAll(vm, enable) {
  let ok = 0,
    fail = 0;
  const snapshot = vm._entries
    .filter((e) => e.banned === enable)
    .map((e) => e.fullPath);
  for (const fullPath of snapshot) {
    try {
      await ToggleModelEnable(fullPath);
      ok++;
    } catch (_) {
      fail++;
    }
  }
  if (ok > 0) {
    await reload(vm);
    bus.emit("sync:toggle-status");
  }
  bus.emit("toast:show", {
    msg: `全部${enable ? "启用" : "禁用"}: ${ok} 成功, ${fail} 失败`,
    duration: 3000,
    type: fail > 0 ? "warn" : "success",
  });
}
