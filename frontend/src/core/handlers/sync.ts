// ===== 同步相关：导入缺失 / 同步启用状态（类型化版 — ADR-014 P3）=====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { getApp } from "../../backend/app.ts";
import { requireMcRoot } from "./require-mcroot.ts";
import { t } from "../../core/i18n/t.ts";

/** sync:download:missing 事件载荷（镜像 bus.ts BusEvents 契约） */
interface SyncDownloadPayload {
  instanceName?: string;
  rtype: string;
  token?: string;
}

/** 并发守卫共享外壳：闭包升格后由 registerSync 创建并显式传入各包级 handler */
interface SyncBusyFlag {
  busy: boolean;
}

/** 逐个整合包安装缺失文件，返回是否整体成功（false = 配置缺失/异常） */
async function runDownloadMissing(
  instanceName: string | undefined,
  rtype: string,
): Promise<boolean> {
  dbg("sync", "download-missing", instanceName || "all", "rtype:", rtype);
  const {
    ListVersionInstances,
    GetResourceInstanceStatus,
    InstallModelTo,
    InstallResourceToInstance,
    GetRepoRoot,
  } = await getApp();
  const mcRoot = await requireMcRoot();
  if (!mcRoot) return false;
  const instances = (await ListVersionInstances(mcRoot)) ?? [];
  const filesRoot = await GetRepoRoot(rtype);
  if (!filesRoot) {
    bus.emit("toast:show", {
      msg: "请先配置该资源类型目录",
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return false;
  }

  const targets = instanceName
    ? instances.filter((i) => i.Name === instanceName)
    : instances;
  const allStatuses = await GetResourceInstanceStatus(rtype, mcRoot, filesRoot);
  let totalOk = 0;
  let totalFail = 0;
  for (const ins of targets) {
    const st = (allStatuses || []).find((s) => s.Name === ins.Name);
    if (!st?.Missing?.length) continue;
    for (const srcPath of st.Missing) {
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
  }
  // 强制刷新扫描缓存
  try {
    const { InvalidateScanCache } = await getApp();
    await InvalidateScanCache();
  } catch (e) {
    // P3（审核发现）：不静默吞错——缓存失效失败会让新导入最长 30s 不出现
    dbg("sync", "InvalidateScanCache 失败:", e);
  }
  dbg(
    "sync",
    "同步完成, 发出 stats:refresh, 成功:",
    totalOk,
    "失败:",
    totalFail,
  );
  bus.emit("stats:refresh");
  bus.emit("toast:show", {
    msg: instanceName
      ? t("sync.downloadDone", { name: instanceName, ok: totalOk, fail: totalFail })
      : t("sync.downloadAllDone", { ok: totalOk, fail: totalFail }),
    duration: TOAST_MS.verbose,
    type: totalFail > 0 ? "warn" : "success",
  });
  return true;
}

/** 导入缺失 handler 包级化：并发守卫 + 缺参显式失败 + try/catch/finally（done 语义） */
async function handleSyncDownloadMissing(
  flag: SyncBusyFlag,
  { instanceName, rtype, token }: SyncDownloadPayload,
): Promise<void> {
  if (flag.busy) {
    // P1 修复：busy 命中时也要回 done（带 skipped 标记）——调用方（app-sidebar 推送）
    // 因 token/instanceName 永远等不到 done 而 30s 超时，或经 instanceName fallback
    // 误判成功；现让调用方立即解锁并识别「被跳过」
    bus.emit("sync:download:done", { token, instanceName, skipped: true });
    return;
  }
  flag.busy = true;
  // P2 收尾（历史审计）：rtype 契约已必填（bus.ts BusEvents），缺参显式失败
  // 而非静默降级 YSM——错误类型装错仓库文件比直接报错危害大；finally 回
  // done(skipped=true)，调用方（app-sidebar）立即解锁并感知被跳过
  let failed = false;
  if (!rtype) {
    failed = true;
    bus.emit("toast:show", {
      msg: "sync:download:missing 缺少 rtype 参数",
      duration: TOAST_MS.long,
      type: "error",
    });
  }
  try {
    if (rtype) {
      const ok = await runDownloadMissing(instanceName, rtype);
      if (!ok) failed = true;
      // P2（审核修复）：仅实际做过安装才广播全树重扫——配置缺失短路时无任何写操作，
      // tree:reload 会引发无意义全树重扫
      else bus.emit("tree:reload");
    }
  } catch (e) {
    failed = true;
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(e)}`,
      duration: TOAST_MS.long,
      type: "error",
    });
  } finally {
    flag.busy = false;
    bus.emit("sync:download:done", { token, instanceName, skipped: failed });
  }
}

/** 同步启用/禁用状态到所有整合包（核心逻辑），失败明细经 friendlyError 显式化 */
async function runSyncToggleStatus(): Promise<void> {
  dbg("sync", "toggle-status");
  const {
    ListVersionInstances,
    SyncModelToggleStatus,
    AddImportLog,
    GetRepoRoot,
  } = await getApp();
  // 语义边界（硬编码排查确认）：sync:toggle:status 是模型 .ban/.disabled 启禁同步，
  // 由 app-tree 的启禁操作触发——前端已统一走 ToggleEnable（无 rtype 纯路径判定，
  // 根集合 FilesRoot/McRoot/CustomRoots/ysmRoot，内部复用 fileops 的 .disabled
  // 统一机制）；SyncModelToggleStatus 的 instanceCustomDir 取 ins.CustomDir
  // （ysm custom 路径）——本 handler 锁 YSM 仓库根是语义正确（resourcepack 同走
  // .disabled 机制，但启禁由 ToggleEnable 处理整合包内路径，不在此 YSM 同步链路）。
  // mmd/vrchat 启禁同步需 per-type 实例目录支持，另行扩展。
  const filesRoot = await GetRepoRoot(RESOURCE_TYPES.YSM);
  const mcRoot = await requireMcRoot();
  if (!filesRoot || !mcRoot) {
    bus.emit("toast:show", {
      msg: "请先配置目录",
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return;
  }
  const instances = (await ListVersionInstances(mcRoot)) ?? [];
  if (!instances?.length) {
    bus.emit("toast:show", {
      msg: t("sync.noPacks"),
      duration: TOAST_MS.success,
      type: "info",
    });
    return;
  }
  let totalDisable = 0;
  let totalEnable = 0;
  const errors: string[] = [];
  for (const ins of instances) {
    if (!ins.Exists) continue;
    try {
      const res = await SyncModelToggleStatus(ins.CustomDir, filesRoot);
      totalDisable += res?.[0] ?? 0;
      totalEnable += res?.[1] ?? 0;
    } catch (e) {
      // 显式化：friendlyError 消费 AppError.Code → i18n 文案并剥离内部路径，
      // 失败明细带整合包名（ADR-082 续）
      errors.push(`${ins.Name}: ${friendlyError(e)}`);
    }
  }
  await AddImportLog(
    "sync-status",
    `同步状态 (${instances.filter((i) => i.Exists).length} 个整合包)`,
    filesRoot,
    0,
    errors.length ? "failed" : "success",
    `禁用 ${totalDisable} 启用 ${totalEnable}${errors.length ? ` | 错误: ${errors.join("; ")}` : ""}`,
  );
  const parts: string[] = [];
  if (totalDisable > 0) parts.push(t("sync.disableN", { n: totalDisable }));
  if (totalEnable > 0) parts.push(t("sync.enableN", { n: totalEnable }));
  if (!parts.length) parts.push(t("sync.alreadySync"));
  bus.emit("toast:show", {
    msg: t("sync.doneToast", { parts: parts.join("，") }),
    duration: TOAST_MS.verbose,
    // P3（审核发现）：有错误但存在成功项时旧逻辑仍报 success，与 AddImportLog 的
    // "failed" 自相矛盾（同一操作对用户 ✅、对日志 ✗）——统一按 errors 判定
    type: errors.length === 0 ? "success" : "warn",
  });
  bus.emit("stats:refresh");
}

/** 同步启禁状态 handler 包级化：并发守卫 + 失败日志写盘 + try/catch/finally（tree:reload 兜底） */
async function handleSyncToggleStatus(flag: SyncBusyFlag): Promise<void> {
  if (flag.busy) {
    // P2（审核发现）：与 download 分支对齐——busy 命中不再静默吞事件，
    // 发 toast 让调用方（app-tree 批量/单文件）感知被跳过，避免 UI 乐观更新后无反馈
    bus.emit("toast:show", {
      msg: t("sync.busySkip"),
      duration: TOAST_MS.success,
      type: "info",
    });
    return;
  }
  flag.busy = true;
  try {
    await runSyncToggleStatus();
  } catch (err) {
    try {
      const { AddImportLog } = await getApp();
      await AddImportLog(
        "sync-status",
        "同步失败",
        "",
        0,
        "failed",
        String(err),
      );
    } catch (logErr) {
      // 日志写入失败不阻断反馈（bus.emit 自带兜底），但不静默吞错
      dbg("sync", "AddImportLog(sync-status 失败) 写入失败:", logErr);
    }
    bus.emit("toast:show", {
      msg: t("sync.failedToast", { msg: friendlyError(err) }),
      duration: 8000,
      type: "error",
    });
  } finally {
    flag.busy = false;
    bus.emit("tree:reload");
  }
}

/** 注册同步 handler，push 返回的取消订阅函数到 unsubs */
export function registerSync(unsubs: Array<() => void>): void {
  // 并发守卫：sync:download:missing / sync:toggle:status 各有多生产者（app-sidebar、
  // app-content、app-tree）连点会并发跑同一批文件写操作（竞态）——守卫外壳由本层
  // 创建并显式传入各包级 handler
  const downloadFlag: SyncBusyFlag = { busy: false };
  const toggleFlag: SyncBusyFlag = { busy: false };
  // 导入仓库模型到整合包
  unsubs.push(
    bus.on("sync:download:missing", (p) =>
      handleSyncDownloadMissing(downloadFlag, p),
    ),
  );
  // 同步启用/禁用状态到所有整合包
  unsubs.push(
    bus.on("sync:toggle:status", () => handleSyncToggleStatus(toggleFlag)),
  );
}