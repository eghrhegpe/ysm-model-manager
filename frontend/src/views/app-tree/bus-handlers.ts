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
import { withFooterProgress } from "./footer-progress.ts";
import type { AppTree } from "./index.ts";
import { invalidateBuildCache } from "./render.ts";
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

  // A3（止血 2026-10-15）：Go watcher 文件系统变更 → 定向失效当前树根 + 重载
  // （事件经 features/repo/repo-fs-events.ts 二级 800ms 防抖后到达，此处直接消费）
  cleanups.push(
    bus.on("repo:fs-changed", () => {
      void atBeHandleRepoFsChanged(vm);
    }),
  );

  return cleanups;
}

// repo:fs-changed（A3）：外部文件变更自动刷新——终结「手动刷新时代」。
// 不复用 reload()：那是用户意图链（全局 ClearScanCache + 清社区缓存）；FS 变更是
// 后台事件，Go 侧有整合包时已在全局清缓存（watcher clearCacheFn），无整合包场景
// 在此用 InvalidateScanPath 定向失效当前树根（不核平他类型缓存，止血 A2 语义），
// 保证 _load 必读到新数据。失效失败不阻断重载（最坏退化为 30s 陈旧命中，
// 与 A3 前行为一致，不引入新故障面）。
async function atBeHandleRepoFsChanged(vm: AppTree): Promise<void> {
  const gen = vm._guard.next();
  try {
    const filesRoot = vm.snapshot.filesRoot;
    const App = await backendGetApp();
    if (filesRoot && App.InvalidateScanPath) await App.InvalidateScanPath(filesRoot);
  } catch (e) {
    logWarn("app-tree", "repo:fs-changed 定向失效失败（不阻断重载）:", e);
  }
  try {
    await vm._load();
  } catch {
    /* _load 内部已 catch 全部错误并降级空 entries + loadFailed 标志（同 reload 链口径） */
  }
  if (atBeStale(vm, gen)) return;
  vm._renderTree();
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
  //（分批并发 + 逐项 ok/fail 不短路单一实现，原范式注释见该工具头）；
  // 2026-10-15：批量重命名可达数百项，补页脚进度（withFooterProgress 保证必清槽）
  const r = await withFooterProgress(
    vm._root,
    // 动作词复用既有键（本仓对通用动作词的惯例，如 ctx.busyWait/ctx.renameFail 被树复用）：
    // 新造 `tree.renameAction` 会被 i18n 命名闸按 ADR-124 判违规（尾段 Action 是已知角色词，
    // 两段式违规 → 要求三段 tree.section.renameAction，语义反而更差）。
    (done, total) => t("tree.batchProgress", { action: t("diagnostics.opRename"), done, total }),
    renames.length,
    (onProgress) =>
      batchAllSettled(
        renames.map((rn) => () => RenameFile(rn.oldPath || "", rn.newName)),
        undefined,
        onProgress,
      ),
  );
  // 连坐守卫：全失败 → 磁盘上一个路径都没变 → 选中集仍全有效，清空只会让用户丢掉重试起点
  // （与 _deleteSelected/_executeTreeMove 同口径，2026-10-15 审核统一）。部分失败仍清：
  // 成功改名的旧路径已不存在，残留选中指向幽灵路径才是真危险。
  if (r.fulfilled.length > 0) {
    vm.selectState.keys.clear();
    vm.selectState.lastKey = null;
  }
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
    // 2026-10-15：整目录入回收站是**最长的破坏性链**（成千上万文件逐个 MoveToRecycle），
    // 最需要「还在跑」的可见证据——补页脚进度（withFooterProgress 保证四条出口都清槽）
    const r = await withFooterProgress(
      vm._root,
      // 动作词复用既有键（本仓对通用动作词的惯例，如 ctx.busyWait/ctx.renameFail 被树复用）。
      // 回收链用 `menu.recycle` 而非 `tree.dirRecycleOk`：后者 ja 是「ゴミ箱へ」，拼进
      //「{action}中」成「ゴミ箱へ中」（不成句）；`menu.recycle` 三语皆通（移入回收站／
      // Move to Recycle Bin／ゴミ箱に移動）。
      (done, total) => t("tree.batchProgress", { action: t("menu.recycle"), done, total }),
      files.length,
      (onProgress) =>
        batchAllSettled(
          files.map((p) => () => MoveToRecycle(p)),
          undefined,
          onProgress,
        ),
    );
    for (const x of r.rejected) {
      const p = files[x.index] || "";
      errors.push(`${p.split(/[/\\]/).pop()}: ${friendlyError(x.reason)}`);
    }
    // P0 修复（审核 2026-10-15）：RemoveDir 必须 gate 在「全部回收成功」上。回收失败
    // （回收站根不可判定／无写权限／磁盘满）时残留文件仍在目录内，无条件 os.RemoveAll
    // 会把本该可恢复的文件变成**永久删除**（不进回收站），而 toast 仍报「已回收 N 个」
    // 误导用户以为文件还在磁盘上可以重试。有残留 → 留壳等用户重试；全成功 → 清理空壳。
    if (r.rejected.length === 0) {
      try {
        await RemoveDir(absDir);
      } catch (ex) {
        // 文件已入回收站，只剩空壳残留：树里多一个空文件夹是 cosmetic，但静默 dbg
        // 会让用户以为回收彻底失败（实际可恢复）——升 warn toast。
        toast(`${t("tree.dirRecycleShellFail")}（${friendlyError(ex)}）`, TOAST_MS.normal, "warn");
        dbg("tree-remove-dir-failed", { dir: absDir, error: String(ex) });
      }
    }
    // 连坐守卫：全回收失败 → 文件全还在磁盘上 → 选中集仍全有效，清空只丢重试起点。
    // 部分失败仍清：已入回收站的文件路径不再存在。与 _deleteSelected 同口径。
    if (r.fulfilled.length > 0) {
      vm.selectState.keys.clear();
      vm.selectState.lastKey = null;
    }
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
    // 对话框只消费 Name/Path（不读 Hash）——浏览投影快路径（止血 2026-10-15 复核 P2-1）
    const { ScanModelEntriesForBrowse, GetRepoRoot } = await backendGetApp();
    const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
    const filesRoot = await GetRepoRoot(rtype);
    const absDir = filesRoot ? `${filesRoot}/${dir}` : dir;
    const label = RESOURCE_TYPE_LABELS[rtype] || rtype;
    const entries = (await ScanModelEntriesForBrowse(absDir, rtype, "", label)) || [];
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

// 整库批量启停（工具栏「✅ 全部启用 / 全部禁用」，命令表直调）。
// 2026-10-15 P1-C 第二处：本链是全仓**最长的批量链**（数千次串行 IPC、可达分钟级），原实现
// 与文件夹链同病——持锁全程零反馈、无乐观，期间任何单文件开关只撞「请稍候」。现与
// `events.ts|toggleFolderBatch` 同款范式：乐观翻转 + 页脚进度 + 逐项失败回滚 + 有成功项才
// reload 校正真值。原 `opts.prefix` 形参随收口删除——全仓无调用方传入（唯一入口
// `batchToggleAll` 只给 label），留着会让人以为存在「只翻某前缀子树」的路径。
async function runBatchToggle(
  vm: AppTree,
  enable: boolean,
  opts: { label: string },
): Promise<void> {
  if (!can("ToggleEnable")) {
    toast(t("tree.webNoToggle"), TOAST_MS.normal, "warn");
    return;
  }
  // ADR-341 归一：启停链单临界区单锁（原 batchBusy||toggleBusy 互查再置位三段式退役）
  if (!vm.toggleLock.tryStart()) {
    toast(t("tree.batchBusyWait"), TOAST_MS.quick, "info");
    return;
  }
  try {
    const { ToggleEnable } = await backendGetApp();
    // 待翻条目 = 与目标态不一致者（enable=true 取当前被禁的，false 取当前启用的）。
    // 保留条目引用（原实现只留 fullPath）：乐观翻转与失败回滚都要写回**同一批对象**。
    const targets = vm.snapshot.entries.filter((e) => e.path && e.banned === enable);
    const action = enable ? t("tree.enable") : t("tree.disable");
    // ① 乐观翻转：整库批量动辄数千项，等全部 IPC 落定才动 UI（旧行为）等于几十秒假死
    for (const e of targets) e.banned = !e.banned;
    if (targets.length) {
      invalidateBuildCache(vm.treeRenderCtx);
      vm._renderTree();
    }
    // ② 进度 + 回滚守卫代数（须在 await 前捕获：`stale(gen)` = `gen !== current`，await 后取恒 false）
    const rollbackGen = vm._guard.current;
    // 批处理收口（2026-10-13）：BATCH=8 手抄循环迁 batch-all-settled（2026-09 曾
    // code_review 3413288be 补齐本入口的并发化，现结构归一）；失败日志保留 fullPath
    //（rejected[].index 配对 targets 下标）。进度走 withFooterProgress（必清槽；空集不写
    // 0/0——那是一次无意义的 0/0 闪烁窗口，且下面本就沿用旧的「0 成功, 0 失败」文案）。
    const r = await withFooterProgress(
      vm._root,
      (done, total) => t("tree.batchProgress", { action, done, total }),
      targets.length,
      (onProgress) =>
        batchAllSettled(
          targets.map((e) => () => ToggleEnable(e.fullPath)),
          undefined, // 缺省批大小（8）——与其余四条批量链同源
          onProgress,
        ),
    );
    for (const x of r.rejected) {
      logWarn("bus", `${opts.label} 失败: ${targets[x.index]?.fullPath || ""}`, x.reason);
    }
    // ③ 失败项回滚（代际过期则不写：旧 entries 上的写是过期写，新树自会以新数据自洽）
    if (r.rejected.length > 0 && !vm._guard.stale(rollbackGen)) {
      for (const x of r.rejected) {
        const e = targets[x.index];
        if (e) e.banned = !e.banned;
      }
      invalidateBuildCache(vm.treeRenderCtx);
    }
    if (r.fulfilled.length > 0) {
      await reload(vm);
      // ADR-339：带当前树类型发射，Go 侧按 dirLevelSync 过滤同步（非 dirLevelSync 自动 no-op）
      bus.emit("sync:toggle:status", { rtype: vm.snapshot.rootAttr || RESOURCE_TYPES.YSM });
    } else if (targets.length) {
      // 全失败：磁盘什么都没变，回滚后的本地态即真值——不为「没变化」付一次全库重扫
      vm._renderTree();
    }
    bus.emit("stats:refresh"); // 启用数变化，统计面同步（与文件夹链同口径）
    toast(
      `${opts.label}: ${r.fulfilled.length} ${t("tree.success")}, ${r.rejected.length} ${t("tree.failed")}`,
      TOAST_MS.normal,
      r.rejected.length > 0 ? "warn" : "success",
    );
  } catch (err) {
    toastError(err);
  } finally {
    vm.toggleLock.finish();
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
