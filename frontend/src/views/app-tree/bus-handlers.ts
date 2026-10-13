// ===== app-tree bus 事件处理 =====

import { can } from "@/backend/capabilities.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { showBatchRenameDialog } from "@/features/dialogs/batch-rename.ts";
import { batchAllSettled } from "@/utils/async/batch-all-settled.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { takeRepoSearchFocusPending } from "@/utils/dom/focus-pending.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { modalPrompt } from "@/utils/dom/modal-prompt.ts";
import { toast, toastError } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { RESOURCE_TYPE_LABELS, RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { AppTree } from "./index.ts";
import { batchRenameTpl } from "./tpl-batch-rename.ts";

function atBeStale(vm: AppTree, gen: number): boolean {
  return vm._guard.stale(gen);
}

export function bindBusEvents(vm: AppTree): Array<() => void> {
  const cleanups: Array<() => void> = [];

  // batch:enable-all / batch:disable-all 已退役（ADR-298 D2）：两端同组件自产自销、
  // 纯 4 跳绕路，改为工具栏命令表直调 batchToggleAll
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
  // 卡片密度变更 → 重排虚拟滚动（行高随密度变化需重算 JS 行高 + 重渲切片）
  cleanups.push(
    bus.on("ui:card-density", () => {
      vm._renderTree();
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
  const { RenameFile } = await backendGetApp();
  // 批处理收口（2026-10-13）：BATCH=8 手抄循环迁 utils/async/batch-all-settled
  //（分批并发 + 逐项 ok/fail 不短路单一实现，原范式注释见该工具头）
  const r = await batchAllSettled(
    renames.map((rn) => () => RenameFile(rn.oldPath || "", rn.newName)),
  );
  vm.selectState.keys.clear();
  vm.selectState.lastKey = null;
  await reload(vm);
  bus.emit("stats:refresh");
  toast(
    `${t("tree.batchRenameDone", { ok: r.fulfilled.length, fail: r.rejected.length || 0 })}`,
    TOAST_MS.normal,
    r.rejected.length > 0 ? "warn" : "success",
  );
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
    toastError(e);
  }
}

async function atBeHandleDirMkdir(vm: AppTree, dir: string): Promise<void> {
  const name = await modalPrompt({
    title: t("tree.mkdirTitle"),
    titleIcon: "folder",
    placeholder: t("tree.inputFolderName"),
    okText: t("tree.mkdirOk"),
    okIcon: "folder",
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
    toastError(e);
  }
}

async function atBeHandleDirRecycle(vm: AppTree, dir: string): Promise<void> {
  const confirmed = await modalConfirm({
    title: t("ctx.fileRecycleTitle"),
    titleIcon: "recycle",
    message: t("tree.dirRecycleConfirm", { dir }),
    okText: t("tree.dirRecycleOk"),
    okIcon: "recycle",
    danger: true,
  });
  if (!confirmed) return;
  try {
    const { ListAllFilePaths, MoveToRecycle, RemoveDir, GetRepoRoot } = await backendGetApp();
    const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot ? `${filesRoot}/${dir}` : dir;
    const allFiles = await ListAllFilePaths(absDir);
    const errors: string[] = [];
    // 批处理收口（2026-10-13）：BATCH=8 手抄循环迁 batch-all-settled；失败归因经
    // rejected[].index 配对原 files 下标，errors 仍带文件名
    // （对接锐评⑦：拒绝缘由走 friendlyError 单源——AppError Code→i18n、中文透传）
    const files = allFiles || [];
    const r = await batchAllSettled(files.map((p) => () => MoveToRecycle(p)));
    for (const x of r.rejected) {
      const p = files[x.index] || "";
      errors.push(`${p.split(/[/\\]/).pop()}: ${friendlyError(x.reason)}`);
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
    toast(
      `♻️ ${t("tree.recycled", { count: r.fulfilled.length })}${suffix}`,
      TOAST_MS.normal,
      "success",
    );
  } catch (e) {
    toastError(e);
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
      toast(`📂 ${t("tree.dirEmpty")}`, TOAST_MS.success, "warn");
      return;
    }
    await showBatchRenameDialog(
      absDir,
      entries.map((e) => ({ Name: e.Name, Path: e.Path })),
      (renames) => runBatchRename(vm, renames),
      batchRenameTpl,
    );
  } catch (e) {
    toastError(e);
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
    toastError(e);
  }
}

async function atBeHandleTreeReload(vm: AppTree): Promise<void> {
  await reload(vm);
}

async function reload(vm: AppTree): Promise<void> {
  try {
    const App = await backendGetApp();
    if (App.ClearScanCache) await App.ClearScanCache();
    // 社区缓存失效走 bus（2026-10-13 解耦）：原动态 import community-data.ts 直调
    // clearAllCommunityCache 是 61b6bbac8 时代的同步联动——订阅侧 app-content 已注册
    // community:clear-cache 通道（download-queue 同款范式，ADR-039），本处直调既让 19 个
    // reload 发射源（改设置/去重/同步等）陪绑清 30min 站点缓存，又构成 views → features
    // 的越层 import。emit 无人订阅时无害（bus 单例，app-content 挂载即注册）。
    bus.emit("community:clear-cache");
  } catch (e) {
    logWarn("app-tree", "ClearScanCache:", e);
  }
  // next() 而非 current（2026-09 收债）：tree:reload 有七个发射源，并发 reload 各自
  // 推进代际——后发者使先发者在途扫描 stale 弃渲染，单飞收敛；current 捕获会让并发
  // 双方同代都过 stale 检查 → 双份清缓存 + 双份全量重扫 + 双渲染
  const gen = vm._guard.next();
  // 加载段收敛走 vm._load()（2026-10-13）：原「手写 loadEntries + entries/filesRoot 赋值」
  // 是 _load 的平行实现（reload 四胞胎第三处）——P2 引入 TreeState.loadFailed 后此分叉
  // 立即致病：reload 成功不会清 loadFailed 位，失败态「加载失败」空态无法自愈。
  // _load 无自有 toast（错误态上屏由空态承载），原 reload 的 catch toast 删除即等价。
  try {
    await vm._load();
  } catch {
    /* _load 内部已 catch 全部错误并降级空 entries + loadFailed 标志，此处兜底不触达 */
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
    toast(t("tree.webNoToggle"), TOAST_MS.normal, "warn");
    return;
  }
  if (vm.batchBusy || vm.toggleBusy) {
    toast(t("tree.batchBusyWait"), TOAST_MS.quick, "info");
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
    // 批处理收口（2026-10-13）：BATCH=8 手抄循环迁 batch-all-settled（2026-09 曾
    // code_review 3413288be 补齐本入口的并发化，现结构归一）；失败日志保留 fullPath
    //（rejected[].index 配对 snapshot 下标）。
    const r = await batchAllSettled(snapshot.map((fullPath) => () => ToggleEnable(fullPath)));
    for (const x of r.rejected) {
      logWarn("bus", `${opts.label} 失败: ${snapshot[x.index] || ""}`, x.reason);
    }
    if (r.fulfilled.length > 0) {
      await reload(vm);
      // ADR-339：带当前树类型发射，Go 侧按 dirLevelSync 过滤同步（非 dirLevelSync 自动 no-op）
      bus.emit("sync:toggle:status", { rtype: vm.snapshot.rootAttr || RESOURCE_TYPES.YSM });
    }
    toast(
      `${opts.label}: ${r.fulfilled.length} ${t("tree.success")}, ${r.rejected.length} ${t("tree.failed")}`,
      TOAST_MS.normal,
      r.rejected.length > 0 ? "warn" : "success",
    );
  } catch (err) {
    toastError(err);
  } finally {
    vm.batchBusy = false;
  }
}

/**
 * 批量启停（供工具栏命令表直调，ADR-298 D2）。
 *
 * 原路径是 `toolbar-events` emit `batch:enable-all` → 本文件 bus.on 接收，两端同组件
 * 自产自销、纯 4 跳绕路；总线立法理由是「跨 Shadow 边界传数据」，此处不成立，故直调。
 * 跨组件事件（dir:rename / tree:reload 等有视图外生产者）保持 bus 不变。
 */
export async function batchToggleAll(vm: AppTree, enable: boolean): Promise<void> {
  return runBatchToggle(vm, enable, {
    label: t("tree.allToggle", { action: enable ? t("tree.enable") : t("tree.disable") }),
  });
}
