// ===== app-tree bus 事件处理 =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { t } from "../../core/i18n/t.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { bus } from "../../bus.ts";
import { get } from "../../services/registry.ts";
import type { loadEntries } from "./loader.ts";
import { getApp } from "../../backend/app.ts";
import { dbg } from "../../utils/debug/debug.ts";
import type { AppTree } from "./index.ts";
import { modalPrompt, modalConfirm } from "../../utils/dom/dialogs/modal.ts";
import { showBatchRenameDialog } from "../../utils/dom/dialogs/batch-rename.ts";
import { selectState } from "./data.ts";
import { can } from "../../utils/dom/capabilities.ts";

interface AtBeCtx {
  vm: AppTree;
  cleanups: Array<() => void>;
}

function atBeGenGuard(vm: AppTree, gen: number): boolean {
  return gen !== vm._gen;
}

export function bindBusEvents(vm: AppTree): Array<() => void> {
  const cleanups: Array<() => void> = [];

  cleanups.push(bus.on("batch:enable-all", () => atBeHandleBatchEnableAll(vm)));
  cleanups.push(bus.on("batch:disable-all", () => atBeHandleBatchDisableAll(vm)));
  cleanups.push(bus.on("dir:rename", ({ dir }) => { void atBeHandleDirRename(vm, dir); }));
  cleanups.push(bus.on("dir:mkdir", ({ dir }) => { void atBeHandleDirMkdir(vm, dir); }));
  cleanups.push(bus.on("dir:recycle", ({ dir }) => { void atBeHandleDirRecycle(vm, dir); }));
  cleanups.push(bus.on("dir:batch-rename", ({ dir }) => { void atBeHandleDirBatchRename(vm, dir); }));
  cleanups.push(bus.on("batch:rename", ({ paths }) => { void atBeHandleBatchRename(vm, paths); }));
  cleanups.push(bus.on("tree:reload", () => { void atBeHandleTreeReload(vm); }));

  return cleanups;
}

/**
 * 批量重命名回调体（dir:batch-rename 与 batch:rename 共用，消除 32 行跨事件重复）：
 * 逐条调用 RenameFile，计数 ok/fail，清空选择态，reload + 统计刷新 + toast。
 */
async function runBatchRename(vm: AppTree, renames: Array<{ oldPath?: string; newName: string }>): Promise<void> {
  let ok = 0, fail = 0;
  const { RenameFile } = await getApp();
  for (const r of renames) {
    try {
      await RenameFile(r.oldPath || "", r.newName);
      ok++;
    } catch {
      fail++;
    }
  }
  selectState.keys.clear();
  selectState.lastKey = null;
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
  const name = await modalPrompt({
    title: "重命名文件夹",
    icon: "✂️",
    value: dir.split("/").pop(),
    placeholder: "输入新文件夹名称",
    okText: "✂️ 重命名",
  });
  if (!name) return;
  try {
    const { RenameDir, GetRepoRoot } = await getApp();
    const rtype = vm._rootAttr || vm._typeFilter || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot ? filesRoot + "/" + dir : dir;
    await RenameDir(absDir, name.trim());
    selectState.keys.clear();
    selectState.lastKey = null;
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
    title: "新建文件夹",
    icon: "📁",
    placeholder: t("tree.inputFolderName"),
    okText: "📁 创建",
  });
  if (!name) return;
  try {
    const { CreateDir, GetRepoRoot } = await getApp();
    const rtype = vm._rootAttr || vm._typeFilter || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot
      ? filesRoot + "/" + dir + "/" + name.trim()
      : dir + "/" + name.trim();
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
    title: "移入回收站",
    icon: "♻️",
    message: `确定将文件夹移入回收站？\n${dir}`,
    okText: "♻️ 移入回收站",
    danger: true,
  });
  if (!confirmed) return;
  try {
    const { ListAllFilePaths, MoveToRecycle, RemoveDir, GetRepoRoot } = await getApp();
    const rtype = vm._rootAttr || vm._typeFilter || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot ? filesRoot + "/" + dir : dir;
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
    try {
      await RemoveDir(absDir);
    } catch (ex) {
      dbg("tree-remove-dir-failed", { dir: absDir, error: String(ex) });
    }
    selectState.keys.clear();
    selectState.lastKey = null;
    await reload(vm);
    bus.emit("stats:refresh");
    const suffix = errors.length
      ? "，失败 " + errors.length + " 个（" + errors.slice(0, 3).join("; ") + "）"
      : "";
    bus.emit("toast:show", {
      msg: `♻️ 已回收 ${count} 个文件` + suffix,
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
    const { ScanModelEntriesFiltered, GetRepoRoot } = await getApp();
    const rtype = vm._rootAttr || vm._typeFilter || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot ? filesRoot + "/" + dir : dir;
    const label = RESOURCE_TYPE_LABELS[rtype] || rtype;
    const entries = (await ScanModelEntriesFiltered(absDir, rtype, "", label)) || [];
    if (!entries || !entries.length) {
      bus.emit("toast:show", {
        msg: "📂 文件夹为空",
        duration: TOAST_MS.success,
        type: "warn",
      });
      return;
    }
    await showBatchRenameDialog(
      absDir,
      entries.map((e) => ({ Name: e.Name, Path: e.Path })),
      (renames) => runBatchRename(vm, renames),
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
    await showBatchRenameDialog("批量重命名", entries, (renames) =>
      runBatchRename(vm, renames),
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
    const App = await getApp();
    if (App.ClearScanCache) await App.ClearScanCache();
    import("../../views/app-content/community-data.ts").then(m => m.clearAllCommunityCache()).catch((e) => console.warn("[app-tree] clearAllCommunityCache:", e));
  } catch (e) { console.warn("[app-tree] ClearScanCache:", e); }
  const gen = vm._gen;
  try {
    const rtype = vm._rootAttr || vm._typeFilter || "";
    const r = vm._subdirAttr
      ? await get<typeof loadEntries>("loadEntries")(rtype, vm._subdirAttr)
      : await get<typeof loadEntries>("loadEntries")(rtype);
    if (atBeGenGuard(vm, gen)) return;
    if (r) {
      vm._filesRoot = r.filesRoot;
      vm._entries = r.entries;
    } else {
      vm._entries = [];
    }
  } catch (err) {
    if (atBeGenGuard(vm, gen)) return;
    console.warn("[bus] reload 失败:", err);
    vm._entries = [];
    bus.emit("toast:show", { msg: "❌ " + friendlyError(err, t("tree.reloadFailed")), duration: TOAST_MS.long, type: "error" });
  }
  if (atBeGenGuard(vm, gen)) return;
  vm._renderTree();
}

async function runBatchToggle(
  vm: AppTree,
  enable: boolean,
  opts: { prefix?: string; label: string },
): Promise<void> {
  if (!can("ToggleEnable")) {
    bus.emit("toast:show", {
      msg: "网页版不支持启用/禁用模型",
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return;
  }
  if (vm._batchBusy || vm._toggleBusy) {
    bus.emit("toast:show", {
      msg: "⏳ 批量操作进行中，请稍候",
      duration: TOAST_MS.quick,
      type: "info",
    });
    return;
  }
  vm._batchBusy = true;
  try {
    const { ToggleEnable } = await getApp();
    const prefix = opts.prefix?.replace(/\\/g, "/");
    const snapshot = vm._entries
      .filter(
        (e) =>
          e.path &&
          e.banned === enable &&
          (!prefix || e.path === prefix || e.path.startsWith(prefix + "/")),
      )
      .map((e) => e.fullPath);
    let ok = 0, fail = 0;
    for (const fullPath of snapshot) {
      try {
        await ToggleEnable(fullPath);
        ok++;
      } catch (err) {
        fail++;
        console.warn(`[bus] ${opts.label} 失败:`, fullPath, err);
      }
    }
    if (ok > 0) {
      await reload(vm);
      if ((vm._rootAttr || vm._typeFilter || RESOURCE_TYPES.YSM) === RESOURCE_TYPES.YSM) {
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
    vm._batchBusy = false;
  }
}

async function batchToggleAll(vm: AppTree, enable: boolean): Promise<void> {
  return runBatchToggle(vm, enable, {
    label: t("tree.allToggle", { action: enable ? t("tree.enable") : t("tree.disable") }),
  });
}
