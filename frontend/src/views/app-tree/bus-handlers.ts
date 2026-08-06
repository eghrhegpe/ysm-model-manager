// ===== app-tree bus 事件处理 =====
import { friendlyError } from "../../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { bus } from "../../bus.ts";
import { get } from "../../services/registry.ts";
import type { loadEntries } from "./loader.ts";
import { initInstanceActions } from "./instance-actions.ts";
import { getApp } from "../../wails/app.ts";
import type { AppTree } from "./index.ts";
import { modalPrompt, modalConfirm } from "../../utils/dom/dialogs/modal.ts";
import { showBatchRenameDialog } from "../../utils/dom/dialogs/batch-rename.ts";

export function bindBusEvents(vm: AppTree): Array<() => void> {
  const unsubs: Array<() => void> = [];

  // 整合包右键操作
  unsubs.push(...initInstanceActions(vm));

  // 选择仓库目录
  unsubs.push(
    bus.on("dir:select-repo", async () => {
      try {
        const { SelectDirectory, SaveAppConfig } = await getApp();
        const dir = await SelectDirectory();
        if (!dir) return;
        // 透传用户已保存的 linkMode，避免硬编码 "copy" 冹掉硬链接模式
        const { LoadAppConfig } = await getApp();
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
        bus.emit("toast:show", { msg: "❌ " + friendlyError(err, "选择仓库目录失败"), duration: 5000, type: "error" });
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
          await getApp();
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
      const name = await modalPrompt({
        title: "新建文件夹",
        icon: "📁",
        placeholder: "输入文件夹名称",
        okText: "📁 创建",
      });
      if (!name) return;
      try {
        const { CreateDir, GetRepoRoot } =
          await getApp();
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
          await getApp();
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
          await getApp();
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
        await showBatchRenameDialog(
          absDir,
          entries.map((e) => ({ Name: e.Name, Path: e.Path })),
          async (renames) => {
          let ok = 0,
            fail = 0;
          const { RenameFile } = await getApp();
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
        await showBatchRenameDialog("批量重命名", entries, async (renames) => {
          let ok = 0,
            fail = 0;
          const { RenameFile } = await getApp();
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
    bus.emit("toast:show", { msg: "❌ " + friendlyError(err, "重新加载失败"), duration: 5000, type: "error" });
  }
  vm._renderTree();
}

/**
 * 批量切换启用/禁用公共实现。
 * batchToggle（目录前缀过滤）与 batchToggleAll（全局）复用同一套逻辑，
 * 差异仅在路径前缀与 toast 文案，收敛为单个函数避免重复（P4 合并）。
 */
async function runBatchToggle(
  vm: AppTree,
  enable: boolean,
  opts: { prefix?: string; label: string },
): Promise<void> {
  if (vm._batchBusy || vm._toggleBusy) return; // 并发守卫：连点时后来的批量操作直接忽略
  vm._batchBusy = true;
  try {
    const { ToggleModelEnable } = await getApp();
    const prefix = opts.prefix?.replace(/\\/g, "/");
    const snapshot = vm._entries
      .filter(
        (e) =>
          e.path &&
          e.banned === enable &&
          (!prefix || e.path.startsWith(prefix)),
      )
      .map((e) => e.fullPath);
    let ok = 0,
      fail = 0;
    for (const fullPath of snapshot) {
      try {
        await ToggleModelEnable(fullPath);
        ok++;
      } catch (err) {
        fail++;
        console.warn(`[bus] ${opts.label} 失败:`, fullPath, err);
      }
    }
    if (ok > 0) {
      await reload(vm);
      bus.emit("sync:toggle:status");
    }
    bus.emit("toast:show", {
      msg: `${opts.label}: ${ok} 成功, ${fail} 失败`,
      duration: 3000,
      type: fail > 0 ? "warn" : "success",
    });
  } finally {
    vm._batchBusy = false;
  }
}

async function batchToggle(
  vm: AppTree,
  dir: string,
  enable: boolean,
): Promise<void> {
  if (!vm._entries.some((e) => e.banned === enable)) return;
  return runBatchToggle(vm, enable, {
    prefix: dir,
    label: `批量${enable ? "启用" : "禁用"}`,
  });
}

async function batchToggleAll(vm: AppTree, enable: boolean): Promise<void> {
  return runBatchToggle(vm, enable, {
    label: `全部${enable ? "启用" : "禁用"}`,
  });
}
