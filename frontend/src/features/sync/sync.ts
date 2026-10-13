// ===== 同步相关：导入缺失 / 同步启用状态（类型化版 — ADR-014 P3）=====
// 迁移史：core/handlers/sync.ts → features/sync.ts（ADR-188——sync 是整合包业务，
// 与 context-menu/pack-ops/platform 同层，不属内核；core 只留 i18n/page-store/
// error-diary 纯内核——feedback 原语已迁 utils/dom/toast.ts，ADR-189 D3）

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { requireMcRoot } from "@/features/require-mcroot.ts";
import { type BusyLock, createBusyLock, withLock } from "@/utils/base/primitives/lock.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { syncGetApp } from "./sync-deps.ts";

/** sync:download:missing 事件载荷（镜像 bus.ts BusEvents 契约） */
interface SyncDownloadPayload {
  instanceName?: string;
  instanceNames?: string[];
  rtype: string;
  token?: string;
}

/** 逐个整合包安装缺失文件，返回是否整体成功（false = 配置缺失/异常） */
async function runDownloadMissing(
  instanceName: string | undefined,
  instanceNames: string[] | undefined,
  rtype: string,
): Promise<boolean> {
  dbg(
    "sync",
    "download-missing",
    instanceNames ? `[${instanceNames.join(", ")}]` : instanceName || "all",
    "rtype:",
    rtype,
  );
  const {
    ListVersionInstances,
    GetResourceInstanceStatus,
    InstallModelTo,
    InstallResourceToInstance,
    PushSingleResourceToInstance,
    GetRepoRoot,
    InvalidateScanCache,
  } = await syncGetApp();
  const mcRoot = await requireMcRoot();
  if (!mcRoot) return false;
  const instances = (await ListVersionInstances(mcRoot)) ?? [];
  const filesRoot = await GetRepoRoot(rtype);
  if (!filesRoot) {
    toast(t("sync.configureResourceTypeDir"), TOAST_MS.normal, "warn");
    return false;
  }

  // 目标实例解析：instanceNames 优先（批量一次覆盖多包），其次 instanceName 单值，再退化全部。
  // 批量模式把 O(包×类型) 次全量扫描收敛为 O(类型) 次——单次事件内只扫一次状态。
  const nameSet = instanceNames?.length
    ? new Set(instanceNames)
    : instanceName
      ? new Set([instanceName])
      : null;
  const targets = nameSet ? instances.filter((i) => nameSet.has(i.Name)) : instances;
  const allStatuses = await GetResourceInstanceStatus(rtype, mcRoot, filesRoot);
  let totalOk = 0;
  let totalFail = 0;
  for (const ins of targets) {
    const st = (allStatuses || []).find((s) => s.Name === ins.Name);
    if (!st?.Missing?.length && !st?.MissingDirs?.length) continue;
    for (const srcPath of st.Missing ?? []) {
      try {
        if (rtype === RESOURCE_TYPES.YSM) {
          await InstallModelTo(srcPath, ins.CustomDir);
        } else {
          await InstallResourceToInstance(rtype, srcPath, ins.Name);
        }
        totalOk++;
      } catch {
        totalFail++;
      }
    }
    // ADR-310：夹内没有可逐文件安装的受支持文件时，Go 把整个夹放进 MissingDirs——
    // 必须走 folder-aware 的 PushSingleResourceToInstance（面板行内推送同一条路，
    // 对目录走 InstallDir 装该夹本身）；喂给上面的逐条 Install 会装成它的父目录。
    for (const dirPath of st.MissingDirs ?? []) {
      try {
        await PushSingleResourceToInstance(rtype, ins.Name, dirPath);
        totalOk++;
      } catch {
        totalFail++;
      }
    }
  }
  // 强制刷新扫描缓存
  try {
    await InvalidateScanCache();
  } catch (e) {
    // P3（审核发现）：不静默吞错——缓存失效失败会让新导入最长 30s 不出现
    dbg("sync", "InvalidateScanCache 失败:", e);
  }
  dbg("sync", "同步完成, 发出 stats:refresh, 成功:", totalOk, "失败:", totalFail);
  bus.emit("stats:refresh");
  toast(
    instanceName
      ? t("sync.downloadDone", { name: instanceName, ok: totalOk, fail: totalFail })
      : t("sync.downloadAllDone", { ok: totalOk, fail: totalFail }),
    TOAST_MS.verbose,
    totalFail > 0 ? "warn" : "success",
  );
  return true;
}

/** 导入缺失 handler：withLock 守卫 + 缺参显式失败；busy 命中回 done(skipped) 防调用方 30s 超时 */
async function handleSyncDownloadMissing(
  lock: BusyLock,
  { instanceName, instanceNames, rtype, token }: SyncDownloadPayload,
): Promise<void> {
  const result = await withLock(lock, async () => {
    // rtype 契约已必填（bus.ts BusEvents），缺参显式失败而非静默降级 YSM——
    // 错误类型装错仓库文件比直接报错危害大
    let failed = false;
    let skipReason: "config" | "error" | undefined;
    if (!rtype) {
      failed = true;
      skipReason = "config";
      toast(t("sync.missingRtype"), TOAST_MS.long, "error");
    } else {
      try {
        const ok = await runDownloadMissing(instanceName, instanceNames, rtype);
        if (!ok) failed = true;
        // 仅实际做过安装才广播全树重扫——配置缺失短路时无任何写操作，
        // tree:reload 会引发无意义全树重扫
        else bus.emit("tree:reload");
      } catch (e) {
        failed = true;
        skipReason = "error";
        toast(friendlyError(e), TOAST_MS.long, "error");
      }
    }
    return { failed, skipReason };
  });
  // 锁释放后统一结算 done（含 busy 命中）：调用方（app-sidebar 推送）因
  // token/instanceName 永远等不到 done 而 30s 超时，或经 instanceName fallback
  // 误判成功；skipped 标记让调用方立即解锁并识别「被跳过」
  if (result === null) {
    bus.emit("sync:download:done", { token, instanceName, skipped: true, skipReason: "busy" });
    return;
  }
  bus.emit("sync:download:done", {
    token,
    instanceName,
    skipped: result.failed,
    skipReason: result.skipReason,
  });
}

/** 同步启用/禁用状态到所有整合包（ADR-339：全 dirLevelSync 类型），失败明细经 friendlyError 显式化 */
async function runSyncToggleStatus(rtype: string): Promise<void> {
  dbg("sync", "toggle-status", "rtype:", rtype || "(all)");
  const mcRoot = await requireMcRoot();
  if (!mcRoot) {
    toast(t("sync.configureDir"), TOAST_MS.normal, "warn");
    return;
  }
  const { SyncModelToggleStatusForType, AddImportLog } = await syncGetApp();
  // ADR-339：类型枚举 + 实例目录解析下沉 Go（SyncModelToggleStatusForType 循环
  // AllSubDirs × IsDirLevelSync × 实例，复用 SyncToggleStatus）——前端只读不判。
  // 缺省 rtype（空）= 全部 dirLevelSync 类型；指定则只同步该类型。
  const [totalDisable, totalEnable] = await SyncModelToggleStatusForType(rtype || "");
  await AddImportLog(
    "sync-status",
    `同步状态 (${rtype || "全部 dirLevelSync 类型"})`,
    "",
    0,
    "success",
    `禁用 ${totalDisable} 启用 ${totalEnable}`,
  );
  const parts: string[] = [];
  if (totalDisable > 0) parts.push(t("sync.disableN", { n: totalDisable }));
  if (totalEnable > 0) parts.push(t("sync.enableN", { n: totalEnable }));
  if (!parts.length) parts.push(t("sync.alreadySync"));
  toast(t("sync.doneToast", { parts: parts.join("，") }), TOAST_MS.verbose, "success");
  bus.emit("stats:refresh");
}

/** 同步启禁状态 handler：withLock 守卫 + 失败日志写盘；busy 命中 toast 感知，tree:reload 兜底 */
async function handleSyncToggleStatus(
  lock: BusyLock,
  payload: { rtype?: string } | undefined,
): Promise<void> {
  const ran = await withLock(lock, async () => {
    try {
      await runSyncToggleStatus(payload?.rtype ?? "");
    } catch (err) {
      try {
        const { AddImportLog } = await syncGetApp();
        await AddImportLog("sync-status", "同步失败", "", 0, "failed", String(err));
      } catch (logErr) {
        // 日志写入失败不阻断反馈（bus.emit 自带兜底），但不静默吞错
        dbg("sync", "AddImportLog(sync-status 失败) 写入失败:", logErr);
      }
      toast(t("sync.failedToast", { msg: friendlyError(err) }), TOAST_MS.long, "error");
    }
  });
  if (ran === null) {
    // busy 命中不再静默吞事件：toast 让调用方（app-tree 批量/单文件）感知被跳过，
    // 避免 UI 乐观更新后无反馈
    toast(t("sync.busySkip"), TOAST_MS.info, "info");
    return;
  }
  // tree:reload 兜底：成败均广播全树重扫（仅 busy 命中不广播）
  bus.emit("tree:reload");
}

/** 注册同步 handler，push 返回的取消订阅函数到 unsubs */
export function registerSync(unsubs: Array<() => void>): void {
  // 并发守卫：sync:download:missing / sync:toggle:status 各有多生产者（app-sidebar、
  // app-content、app-tree）连点会并发跑同一批文件写操作（竞态）——共享忙锁
  // createBusyLock + withLock（utils/base/lock.ts）：finally 自动释放，杜绝忘释放锁死
  const downloadLock = createBusyLock();
  const toggleLock = createBusyLock();
  // 导入仓库模型到整合包
  unsubs.push(bus.on("sync:download:missing", (p) => handleSyncDownloadMissing(downloadLock, p)));
  // 同步启用/禁用状态到所有整合包（ADR-339：透传 rtype，Go 侧按类型对齐 repo↔pack）
  unsubs.push(bus.on("sync:toggle:status", (p) => handleSyncToggleStatus(toggleLock, p)));
}
