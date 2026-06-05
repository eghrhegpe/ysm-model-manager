// ===== app-tree bus 事件处理 =====
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
        await SaveAppConfig(dir, "", "copy", theme);
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
        msg: "🗑️ 回收站功能开发中",
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
      const name = prompt("请输入新文件夹名称：");
      if (!name) return;
      try {
        const { RenameDir } = await import("../../../wailsjs/go/main/App.js");
        await RenameDir(dir, name.trim());
        await reload(vm);
        bus.emit("stats:refresh");
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 重命名失败: ${String(e)}`,
          duration: 3000,
          type: "error",
        });
      }
    }),
  );

  unsubs.push(
    bus.on("dir:mkdir", async ({ dir }) => {
      const name = prompt("请输入新文件夹名称：");
      if (!name) return;
      try {
        const { CreateDir } = await import("../../../wailsjs/go/main/App.js");
        await CreateDir(dir + "/" + name.trim());
        await reload(vm);
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 创建失败: ${String(e)}`,
          duration: 3000,
          type: "error",
        });
      }
    }),
  );

  unsubs.push(
    bus.on("dir:recycle", async ({ dir }) => {
      const confirmed = await window.showConfirm?.(
        `♻️ 确定将文件夹移入回收站？\n${dir}`,
      );
      if (!confirmed) return;
      try {
        // 遍历文件夹内所有模型文件移入回收站
        const { ScanModelEntries, MoveToRecycle } =
          await import("../../../wailsjs/go/main/App.js");
        const entries = await ScanModelEntries(dir);
        let count = 0;
        for (const e of entries || []) {
          try {
            await MoveToRecycle(e.Path);
            count++;
          } catch {}
        }
        // 尝试删除空文件夹
        try {
          const { RemoveDir } = await import("../../../wailsjs/go/main/App.js");
          await RemoveDir(dir);
        } catch {}
        await reload(vm);
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: `♻️ 已回收 ${count} 个文件`,
          duration: 3000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 回收失败: ${String(e)}`,
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
    const r = await loadEntries();
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
