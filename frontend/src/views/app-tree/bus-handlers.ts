// ===== app-tree bus 事件处理 =====

import { can } from "@/backend/capabilities.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { showBatchRenameDialog } from "@/features/dialogs/batch-rename.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { takeRepoSearchFocusPending } from "@/utils/dom/focus-pending.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { modalPrompt } from "@/utils/dom/modal-prompt.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { RESOURCE_TYPE_LABELS, RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { AppTree } from "./index.ts";
import { loadEntries } from "./loader.ts";
import { batchRenameTpl } from "./tpl-batch-rename.ts";

function atBeStale(vm: AppTree, gen: number): boolean {
  return vm._guard.stale(gen);
}

export function bindBusEvents(vm: AppTree): Array<() => void> {
  const cleanups: Array<() => void> = [];

  cleanups.push(bus.on("batch:enable-all", () => atBeHandleBatchEnableAll(vm)));
  cleanups.push(bus.on("batch:disable-all", () => atBeHandleBatchDisableAll(vm)));
  cleanups.push(
    bus.on("dir:rename", ({ dir }) => {
      void atBeHandleDirRename(vm, dir);
    }),
  );
  cleanups.push(
    bus.on("dir:mkdir", ({ dir }) => {
      void atBeHandleDirMkdir(vm, dir);
    }),
  );
  cleanups.push(
    bus.on("dir:recycle", ({ dir }) => {
      void atBeHandleDirRecycle(vm, dir);
    }),
  );
  cleanups.push(
    bus.on("dir:batch-rename", ({ dir }) => {
      void atBeHandleDirBatchRename(vm, dir);
    }),
  );
  cleanups.push(
    bus.on("batch:rename", ({ paths }) => {
      void atBeHandleBatchRename(vm, paths);
    }),
  );
  cleanups.push(
    bus.on("tree:reload", () => {
      void atBeHandleTreeReload(vm);
    }),
  );
  // ADR-223：nav 点 repository 项 → 发 repo:focus-search；树已挂（常驻面板）时直达 focus
  cleanups.push(
    bus.on("repo:focus-search", () => {
      takeRepoSearchFocusPending(); // 清 nav 置的 flag（已挂场景，防泄漏到下次挂载）
      vm.focusSearch();
    }),
  );

  return cleanups;
}

/**
 * 批量重命名回调体（dir:batch-rename 与 batch:rename 共用，消除 32 行跨事件重复）：
 * 逐条调用 RenameFile，计数 ok/fail，清空选择态，reload + 统计刷新 + toast。
 */
async function runBatchRename(
  vm: AppTree,
  renames: Array<{ oldPath?: string | undefined; newName: string }>,
): Promise<void> {
  let ok = 0,
    fail = 0;
  const { RenameFile } = await backendGetApp();
  for (const r of renames) {
    try {
      await RenameFile(r.oldPath || "", r.newName);
      ok++;
    } catch {
      fail++;
    }
  }
  vm.selectState.keys.clear();
  vm.selectState.lastKey = null;
  await reload(vm);
  bus.emit("stats:refresh");
  bus.emit("toast:show", {
    msg: `✅ ${t("tree.batchRenameDone", { ok, fail: fail || 0 })}`,
    duration: TOAST_MS.normal,
    type: fail > 0 ? "warn" : "success",
  });
}

function atBeHandleBatchEnableAll(vm: AppTree): void {
  void batchToggleAll(vm, true);
}

function atBeHandleBatchDisableAll(vm: AppTree): void {
  void batchToggleAll(vm, false);
}

async function atBeHandleDirRename(vm: AppTree, dir: string): Promise<void> {
  const baseName = dir.split("/").pop();
  const name = await modalPrompt({
    title: t("tree.dirRenameTitle"),
    titleIcon: "cut",
    ...(baseName !== undefined ? { value: baseName } : {}),
    placeholder: t("tree.inputNewFolder"),
    okText: t("tree.dirRenameOk"),
  });
  if (!name) return;
  try {
    const { RenameDir, GetRepoRoot } = await backendGetApp();
    const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot ? `${filesRoot}/${dir}` : dir;
    await RenameDir(absDir, name.trim());
    vm.selectState.keys.clear();
    vm.selectState.lastKey = null;
    await reload(vm);
    bus.emit("stats:refresh");
  } catch (e) {
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(e)}`,
      duration: TOAST_MS.normal,
      type: "error",
    });
  }
}

async function atBeHandleDirMkdir(vm: AppTree, dir: string): Promise<void> {
  const name = await modalPrompt({
    title: t("tree.mkdirTitle"),
    titleIcon: "folder",
    placeholder: t("tree.inputFolderName"),
    okText: t("tree.mkdirOk"),
  });
  if (!name) return;
  try {
    const { CreateDir, GetRepoRoot } = await backendGetApp();
    const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot ? `${filesRoot}/${dir}/${name.trim()}` : `${dir}/${name.trim()}`;
    await CreateDir(absDir);
    await reload(vm);
  } catch (e) {
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(e)}`,
      duration: TOAST_MS.normal,
      type: "error",
    });
  }
}

async function atBeHandleDirRecycle(vm: AppTree, dir: string): Promise<void> {
  const confirmed = await modalConfirm({
    title: t("ctx.fileRecycleTitle"),
    titleIcon: "recycle",
    message: t("tree.dirRecycleConfirm", { dir }),
    okText: t("tree.dirRecycleOk"),
    danger: true,
  });
  if (!confirmed) return;
  try {
    const { ListAllFilePaths, MoveToRecycle, RemoveDir, GetRepoRoot } = await backendGetApp();
    const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot ? `${filesRoot}/${dir}` : dir;
    const allFiles = await ListAllFilePaths(absDir);
    let count = 0;
    const errors: string[] = [];
    for (const p of allFiles || []) {
      try {
        await MoveToRecycle(p);
        count++;
      } catch (ex) {
        errors.push(`${p.split(/[/\\]/).pop()}: ${String(ex)}`);
      }
    }
    try {
      await RemoveDir(absDir);
    } catch (ex) {
      dbg("tree-remove-dir-failed", { dir: absDir, error: String(ex) });
    }
    vm.selectState.keys.clear();
    vm.selectState.lastKey = null;
    await reload(vm);
    bus.emit("stats:refresh");
    const suffix = errors.length
      ? t("tree.recycledFailSuffix", { fail: errors.length, detail: errors.slice(0, 3).join("; ") })
      : "";
    bus.emit("toast:show", {
      msg: `♻️ ${t("tree.recycled", { count })}${suffix}`,
      duration: TOAST_MS.normal,
      type: "success",
    });
  } catch (e) {
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(e)}`,
      duration: TOAST_MS.normal,
      type: "error",
    });
  }
}

async function atBeHandleDirBatchRename(vm: AppTree, dir: string): Promise<void> {
  try {
    const { ScanModelEntriesFiltered, GetRepoRoot } = await backendGetApp();
    const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot ? `${filesRoot}/${dir}` : dir;
    const label = RESOURCE_TYPE_LABELS[rtype] || rtype;
    const entries = (await ScanModelEntriesFiltered(absDir, rtype, "", label)) || [];
    if (!entries?.length) {
      bus.emit("toast:show", {
        msg: `📂 ${t("tree.dirEmpty")}`,
        duration: TOAST_MS.success,
        type: "warn",
      });
      return;
    }
    await showBatchRenameDialog(
      absDir,
      entries.map((e) => ({ Name: e.Name, Path: e.Path })),
      (renames) => runBatchRename(vm, renames),
      batchRenameTpl,
    );
  } catch (e) {
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(e)}`,
      duration: TOAST_MS.normal,
      type: "error",
    });
  }
}

async function atBeHandleBatchRename(vm: AppTree, paths: string[]): Promise<void> {
  if (!paths?.length) return;
  try {
    const entries = paths.map((p) => ({
      Name: p.split(/[/\\]/).pop() || "",
      Path: p,
    }));
    await showBatchRenameDialog(
      t("dialog.batchRenameTitle"),
      entries,
      (renames) => runBatchRename(vm, renames),
      batchRenameTpl,
    );
  } catch (e) {
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(e)}`,
      duration: TOAST_MS.normal,
      type: "error",
    });
  }
}

async function atBeHandleTreeReload(vm: AppTree): Promise<void> {
  await reload(vm);
}

async function reload(vm: AppTree): Promise<void> {
  try {
    const App = await backendGetApp();
    if (App.ClearScanCache) await App.ClearScanCache();
    import("@/features/community/community-data.ts")
      .then((m) => m.clearAllCommunityCache())
      .catch((e) => logWarn("app-tree", "clearAllCommunityCache:", e));
  } catch (e) {
    logWarn("app-tree", "ClearScanCache:", e);
  }
  const gen = vm._guard.current;
  try {
    const rtype = vm.snapshot.rootAttr || "";
    const r = vm.snapshot.subdirAttr
      ? await loadEntries(rtype, vm.snapshot.subdirAttr)
      : await loadEntries(rtype);
    if (atBeStale(vm, gen)) return;
    if (r) {
      vm.filesRoot = r.filesRoot;
      vm.entries = r.entries;
    } else {
      vm.entries = [];
    }
  } catch (err) {
    if (atBeStale(vm, gen)) return;
    logWarn("bus", "reload 失败:", err);
    vm.entries = [];
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(err, t("tree.reloadFailed"))}`,
      duration: TOAST_MS.long,
      type: "error",
    });
  }
  if (atBeStale(vm, gen)) return;
  vm._renderTree();
}

async function runBatchToggle(
  vm: AppTree,
  enable: boolean,
  opts: { prefix?: string; label: string },
): Promise<void> {
  if (!can("ToggleEnable")) {
    bus.emit("toast:show", {
      msg: t("tree.webNoToggle"),
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return;
  }
  if (vm.batchBusy || vm.toggleBusy) {
    bus.emit("toast:show", {
      msg: t("tree.batchBusyWait"),
      duration: TOAST_MS.quick,
      type: "info",
    });
    return;
  }
  vm.batchBusy = true;
  try {
    const { ToggleEnable } = await backendGetApp();
    const prefix = opts.prefix?.replace(/\\/g, "/");
    const snapshot = vm.snapshot.entries
      .filter(
        (e) =>
          e.path &&
          e.banned === enable &&
          (!prefix || e.path === prefix || e.path.startsWith(`${prefix}/`)),
      )
      .map((e) => e.fullPath);
    let ok = 0,
      fail = 0;
    // code_review 3413288be 段 C #2/#3（P3）：对齐 toggleFolderBatch/_deleteSelected 的
    // BATCH=8 + Promise.allSettled 并发批处理——原串行 for...of await 阻塞主线程
    // （同 diff 已改兄弟循环「文件夹/批量删除」，独漏本入口「全部启用/禁用」；
    // 大仓库全树条目时串行 IPC 问题依旧存在）。Promise.allSettled 保原语义：逐项
    // 独立 ok/fail 统计不短路；失败日志保留 fullPath（results 与 batch 按下标配对）。
    const BATCH = 8;
    for (let i = 0; i < snapshot.length; i += BATCH) {
      const batch = snapshot.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map((fullPath) => ToggleEnable(fullPath)));
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled") ok++;
        else {
          fail++;
          logWarn("bus", `${opts.label} 失败: ${batch[j]}`, r.reason);
        }
      }
    }
    if (ok > 0) {
      await reload(vm);
      if ((vm.snapshot.rootAttr || RESOURCE_TYPES.YSM) === RESOURCE_TYPES.YSM) {
        bus.emit("sync:toggle:status");
      }
    }
    bus.emit("toast:show", {
      msg: `${opts.label}: ${ok} ${t("tree.success")}, ${fail} ${t("tree.failed")}`,
      duration: TOAST_MS.normal,
      type: fail > 0 ? "warn" : "success",
    });
  } catch (err) {
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(err)}`,
      duration: TOAST_MS.normal,
      type: "error",
    });
  } finally {
    vm.batchBusy = false;
  }
}

async function batchToggleAll(vm: AppTree, enable: boolean): Promise<void> {
  return runBatchToggle(vm, enable, {
    label: t("tree.allToggle", { action: enable ? t("tree.enable") : t("tree.disable") }),
  });
}
