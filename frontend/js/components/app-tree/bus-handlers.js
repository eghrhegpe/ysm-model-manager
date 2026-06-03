// ===== app-tree bus 事件处理 =====
import {
  ToggleModelEnable,
  SelectDirectory,
  SaveAppConfig,
  LoadAppConfig,
  ListVersionInstances,
  AddImportLog,
} from "../../../wailsjs/go/main/App.js";
import { loadEntries, fallbackEntries } from "./loader.js";

export function bindBusEvents(vm) {
  const unsubs = [];

  // 启用/禁用 — 直接调用 ToggleModelEnable，然后刷新树和统计
  unsubs.push(
    bus.on("entry:toggle", async ({ path }) => {
      try {
        await ToggleModelEnable(path);
      } catch (_) {}
      await reload(vm);
      // 通知统计刷新
      bus.emit("stats:refresh");
    }),
  );

  // 选择仓库目录
  unsubs.push(
    bus.on("dir:select-repo", async () => {
      try {
        const dir = await SelectDirectory();
        if (!dir) return;
        await SaveAppConfig(dir, "", "copy");
        vm._repoRoot = dir;
        await reload(vm);
        bus.emit("stats:refresh");
      } catch (_) {
        vm._entries = fallbackEntries();
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

  // 同步状态：将仓库的启用/禁用状态应用到所有整合包
  unsubs.push(
    bus.on("sync:toggle-status", async () => {
      try {
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || cfg.RepoRoot || "";
        const mcRoot = cfg.mcRoot || cfg.McRoot || "";
        if (!repoRoot || !mcRoot) {
          bus.emit("toast:show", {
            msg: "请先配置游戏目录和仓库目录",
            duration: 3000,
            type: "warn",
          });
          return;
        }

        // 遍历所有整合包
        const instances = await ListVersionInstances(mcRoot);
        if (!instances || !instances.length) {
          bus.emit("toast:show", {
            msg: "没有找到整合包",
            duration: 2000,
            type: "info",
          });
          return;
        }

        let totalDisable = 0;
        let totalEnable = 0;
        const errors = [];
        for (const ins of instances) {
          if (!ins.Exists) continue;
          try {
            const { SyncModelToggleStatus } =
              await import("../../../wailsjs/go/main/App.js");
            const res = await SyncModelToggleStatus(ins.CustomDir, repoRoot);
            const d = (res && (res.r0 || res[0])) || 0;
            const e = (res && (res.r1 || res[1])) || 0;
            if (d > 0 || e > 0) {
              totalDisable += d;
              totalEnable += e;
            }
          } catch (e) {
            errors.push(`${ins.Name}: ${String(e)}`);
          }
        }

        await AddImportLog(
          "sync-status",
          "同步状态 (" +
            instances.filter((i) => i.Exists).length +
            " 个整合包)",
          repoRoot,
          0,
          errors.length ? "failed" : "success",
          "禁用 " +
            totalDisable +
            " 启用 " +
            totalEnable +
            (errors.length ? " | 错误: " + errors.join("; ") : ""),
        );

        bus.emit("toast:show", {
          msg: `✅ 同步完成：禁用 ${totalDisable} 项，启用 ${totalEnable} 项`,
          duration: 3000,
          type: "success",
        });

        // 刷新仓库列表
        await reload(vm);
        bus.emit("stats:refresh");
        bus.emit("logs:refresh");
      } catch (err) {
        await AddImportLog(
          "sync-status",
          "同步失败",
          repoRoot || "",
          0,
          "failed",
          String(err),
        );
        bus.emit("toast:show", {
          msg: `同步失败: ${String(err)}`,
          duration: 8000,
          type: "error",
        });
        bus.emit("logs:refresh");
      }
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
      vm._entries = fallbackEntries();
    }
  } catch (_) {
    vm._entries = fallbackEntries();
  }
  vm._renderTree();
}

async function batchToggle(vm, dir, enable) {
  const prefix = dir.replace(/\\/g, "/");
  const targets = vm._entries.filter(
    (e) => e.path && e.path.startsWith(prefix),
  );
  if (!targets.length) return;
  let ok = 0,
    fail = 0;
  for (const e of targets) {
    if (e.banned === !enable) continue;
    try {
      await ToggleModelEnable(e.fullPath);
      e.banned = !enable;
      ok++;
    } catch (_) {
      fail++;
    }
  }
  if (ok > 0) {
    vm._renderTree();
    bus.emit("stats:refresh");
  }
  bus.emit("toast:show", {
    msg: `批量${enable ? "启用" : "禁用"}: ${ok} 成功, ${fail} 失败`,
    duration: 3000,
    type: fail > 0 ? "warn" : "success",
  });
}
