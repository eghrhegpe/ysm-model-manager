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

/** downloadMissing 入参（ADR-340 去总线化：原 bus 载荷直调化，token 随回执协议退役） */
export interface SyncDownloadPayload {
  instanceName?: string;
  instanceNames?: string[];
  rtype: string;
}

/** 单个整合包的安装归因（锐评 P1-3：文件级计数之上再下沉一级——用户看到「失败 3」时
 *  必须能指名道姓说是哪个包，而不是去数 15 个包的徽章）。 */
export interface PackOutcome {
  name: string;
  ok: number;
  fail: number;
  /** 本包失败明细（每包上限 MAX_PACK_ERRORS 条，friendlyError 归一，防多包批量无界增长） */
  errors: string[];
}

/** downloadMissing 统一结果契约（ADR-340）：直调方据 skipped/skipReason 分类、
 *  据 ok/fail 汇总文件级计数、据 packs 汇总包级归因。skipped=true 时 ok/fail 恒 0
 *  （未做或未完成安装），packs 亦缺省。 */
export interface DownloadOutcome {
  ok: number;
  fail: number;
  skipped?: boolean;
  skipReason?: "busy" | "config" | "error";
  /**
   * 失败明细（锐评 UX 高项收口，2026-10-14）：原实现 `catch { totalFail++ }` 吞掉错误对象，
   * 发起方只拿到一个数字——用户看到「失败 3」却不知道是哪 3 个文件、为何失败（磁盘满？权限？路径越界？）
   * ，排障只能翻环形日志面板。现上抛前若干条 `friendlyError` 归一后的缘由（格式同 import 批量汇总）
   */
  errors?: string[];
  /** 包级归因（锐评 P1-3，2026-10-14）：成功路径恒有（本次实际发起安装的包，含单包模式）；
   *  无安装动作的包不占条目（「没有缺失」与「装了 0 个」语义不同，后者不存在）。 */
  packs?: PackOutcome[];
  /**
   * 本次推送**覆盖了实例侧已修改副本**的目标路径（ADR-340-d2，成功路径恒有）。
   * 来源是 Go 侧 `InstanceStatus.Overwrites`（`Missing ∪ MissingDirs` 的子集，同格路径，
   * 无需前端重算归属——只做集合命中，不碰磁盘、不判类型）。批量推送的策略仍是
   * 「仓库为准，照旧覆盖」，本字段只让发起方据实计数与点名，不再让用户蒙在鼓里。
   * 只计**安装成功**的那些：失败的目标没有覆盖任何东西。
   */
  overwrites?: string[];
}

/** runDownloadMissing 内部结果：null = 配置缺失/异常（未做或未完成安装）；
 *  ok/fail = 文件级安装计数（锐评 P1-1：经 DownloadOutcome 上抛给发起方汇总），
 *  packs = 包级归因（锐评 P1-3），overwrites = 覆盖了实例侧已修改副本的目标（ADR-340-d2）。 */
interface InstallCounts {
  ok: number;
  fail: number;
  /** 失败明细（与 DownloadOutcome.errors 同源，止于本层便于 runDownloadMissing 内聚） */
  errors: string[];
  /** 包级归因（与 DownloadOutcome.packs 同源） */
  packs: PackOutcome[];
  /** 覆盖了实例侧已修改副本的推送目标路径（与 DownloadOutcome.overwrites 同源） */
  overwrites: string[];
}

/** 失败明细上限（防批量失败时 toast 过长） */
const MAX_ERRORS = 3;
/** 单包失败明细上限（锐评 P1-3：包级归因每包至多 2 条，防多包批量无界增长） */
const MAX_PACK_ERRORS = 2;

/** sync 后端绑定类型（由 syncGetApp 反推，不硬编码签名） */
type SyncApp = Awaited<ReturnType<typeof syncGetApp>>;
type SyncInstance = NonNullable<Awaited<ReturnType<SyncApp["ListVersionInstances"]>>>[number];
type InstanceStatus = NonNullable<
  Awaited<ReturnType<SyncApp["GetResourceInstanceStatus"]>>
>[number];

/** 单文件/目录安装结果：ok + 失败缘由（成功时 err 为 null） */
interface InstallResult {
  ok: boolean;
  err: unknown;
}

/** 目标实例解析：instanceNames 优先（批量一次覆盖多包），其次 instanceName 单值，再退化全部 */
function resolveTargets(
  instances: SyncInstance[],
  instanceName: string | undefined,
  instanceNames: string[] | undefined,
): SyncInstance[] {
  const nameSet = instanceNames?.length
    ? new Set(instanceNames)
    : instanceName
      ? new Set([instanceName])
      : null;
  return nameSet ? instances.filter((i) => nameSet.has(i.Name)) : instances;
}

/** 单缺失文件安装：YSM 走 InstallModelTo，其余走 InstallResourceToInstance */
async function installMissingFile(
  srcPath: string,
  ins: SyncInstance,
  rtype: string,
  app: SyncApp,
): Promise<InstallResult> {
  try {
    if (rtype === RESOURCE_TYPES.YSM) {
      await app.InstallModelTo(srcPath, ins.CustomDir);
    } else {
      await app.InstallResourceToInstance(rtype, srcPath, ins.Name);
    }
    return { ok: true, err: null };
  } catch (e) {
    return { ok: false, err: e };
  }
}

/** 单缺失目录安装：夹内无受支持文件时 Go 整体归入 MissingDirs，须走 folder-aware 推送（ADR-310） */
async function installMissingDir(
  dirPath: string,
  ins: SyncInstance,
  rtype: string,
  app: SyncApp,
): Promise<InstallResult> {
  try {
    await app.PushSingleResourceToInstance(rtype, ins.Name, dirPath);
    return { ok: true, err: null };
  } catch (e) {
    return { ok: false, err: e };
  }
}

/** 单包安装：逐条 Missing 文件 + MissingDirs 目录，返回包级归因（锐评 P1-3）。
 *  allErrors 为**未截断**失败明细——全局 errors 须按 MAX_ERRORS 统一封顶，
 *  不能被每包 MAX_PACK_ERRORS 提前砍掉（否则单包 5 失败时全局只剩 2 条）。
 *  overwrites 只收**安装成功**且命中 `st.Overwrites` 的目标（ADR-340-d2：失败的安装
 *  没有覆盖任何东西，算进去就是虚报）。 */
async function installInstanceMissing(
  ins: SyncInstance,
  st: InstanceStatus,
  rtype: string,
  app: SyncApp,
): Promise<{ pack: PackOutcome; allErrors: string[]; overwrites: string[] }> {
  const allErrors: string[] = [];
  const overwrites: string[] = [];
  // Go 侧 Overwrites 是推送目标的子集（同格路径），前端只做集合命中——
  // 不重算归属语义、不碰磁盘（职责红线：筛选/聚合归 Go）
  const overwriteSet = new Set(st.Overwrites ?? []);
  const record = (item: string, err: unknown): void => {
    allErrors.push(`${ins.Name}/${item}: ${friendlyError(err)}`);
  };
  let packOk = 0;
  let packFail = 0;
  for (const srcPath of st.Missing ?? []) {
    const r = await installMissingFile(srcPath, ins, rtype, app);
    if (r.ok) {
      packOk++;
      if (overwriteSet.has(srcPath)) overwrites.push(srcPath);
    } else {
      packFail++;
      record(srcPath, r.err);
    }
  }
  for (const dirPath of st.MissingDirs ?? []) {
    const r = await installMissingDir(dirPath, ins, rtype, app);
    if (r.ok) {
      packOk++;
      if (overwriteSet.has(dirPath)) overwrites.push(dirPath);
    } else {
      packFail++;
      record(dirPath, r.err);
    }
  }
  return {
    pack: {
      name: ins.Name,
      ok: packOk,
      fail: packFail,
      errors: allErrors.slice(0, MAX_PACK_ERRORS),
    },
    allErrors,
    overwrites,
  };
}

/** 强制刷新扫描缓存：失败不上抛，但归入 errors 让用户可见（装成功却等不到新模型是最困惑的一类反馈） */
async function refreshScanCache(app: SyncApp, errors: string[]): Promise<void> {
  try {
    await app.InvalidateScanCache();
  } catch (e) {
    // P3（审核发现）：不静默吞错——缓存失效失败会让新导入最长 30s 不出现。
    // 锐评 UX 高项收口（2026-10-14）：不止 dbg，须让用户可见。归入 errors 并在汇总 toast 点名。
    dbg("sync", "InvalidateScanCache 失败:", e);
    if (errors.length < MAX_ERRORS) {
      errors.push(t("sync.cacheInvalidateFailed", { msg: friendlyError(e) }));
    }
  }
}

/** 单包模式汇总 toast（批量模式静默——反馈权归发起方一条汇总，锐评 P2-1） */
function showDownloadSummary(
  instanceName: string | undefined,
  instanceNames: string[] | undefined,
  totalOk: number,
  totalFail: number,
  errors: string[],
): void {
  if (instanceNames?.length) return;
  const base = instanceName
    ? t("sync.downloadDone", { name: instanceName, ok: totalOk, fail: totalFail })
    : t("sync.downloadAllDone", { ok: totalOk, fail: totalFail });
  // 失败明细追加在括号里（无失败则不加）；缓存失效失败同样点名
  const detail = errors.length > 0 ? `（${errors.join("；")}）` : "";
  toast(
    `${base}${detail}`,
    TOAST_MS.verbose,
    totalFail > 0 || errors.length > 0 ? "warn" : "success",
  );
}

/** 逐目标实例安装缺失文件，汇总文件级计数 + 包级归因 + 覆盖清单（失败明细并进 errors，止于 MAX_ERRORS） */
async function installAllTargets(
  targets: SyncInstance[],
  allStatuses: InstanceStatus[] | null,
  rtype: string,
  app: SyncApp,
  errors: string[],
): Promise<{ totalOk: number; totalFail: number; packs: PackOutcome[]; overwrites: string[] }> {
  const pushError = (msg: string): void => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };
  const packs: PackOutcome[] = [];
  // 跨包去重（同一仓库侧路径理论只属一个实例，去重是防御位；面板链「混合夹」会重复列示同一文件）
  const overwrites = new Set<string>();
  let totalOk = 0;
  let totalFail = 0;
  for (const ins of targets) {
    const st = (allStatuses || []).find((s) => s.Name === ins.Name);
    if (!st?.Missing?.length && !st?.MissingDirs?.length) continue;
    const {
      pack,
      allErrors,
      overwrites: packOverwrites,
    } = await installInstanceMissing(ins, st, rtype, app);
    totalOk += pack.ok;
    totalFail += pack.fail;
    for (const msg of allErrors) pushError(msg);
    for (const p of packOverwrites) overwrites.add(p);
    packs.push(pack);
  }
  return { totalOk, totalFail, packs, overwrites: [...overwrites] };
}

/** 逐个整合包安装缺失文件，返回文件级计数（null = 配置缺失/异常）。
 *  批量模式（instanceNames 非空，发起方 app-sidebar 逐类型直调收集计数）下
 *  不弹 toast——防「全部类型 × N 包」连吃一串 0 成功 0 失败轰炸，
 *  反馈权归发起方汇总为一条（锐评 P2-1）。 */
async function runDownloadMissing(
  instanceName: string | undefined,
  instanceNames: string[] | undefined,
  rtype: string,
): Promise<InstallCounts | null> {
  dbg(
    "sync",
    "download-missing",
    instanceNames ? `[${instanceNames.join(", ")}]` : instanceName || "all",
    "rtype:",
    rtype,
  );
  const app = await syncGetApp();
  const mcRoot = await requireMcRoot();
  if (!mcRoot) return null;
  const instances = (await app.ListVersionInstances(mcRoot)) ?? [];
  const filesRoot = await app.GetRepoRoot(rtype);
  if (!filesRoot) {
    toast(t("sync.configureResourceTypeDir"), TOAST_MS.normal, "warn");
    return null;
  }

  // 批量模式把 O(包×类型) 次全量扫描收敛为 O(类型) 次——单次事件内只扫一次状态。
  const targets = resolveTargets(instances, instanceName, instanceNames);
  const allStatuses = await app.GetResourceInstanceStatus(rtype, mcRoot, filesRoot);

  // 失败明细（锐评 UX 高项收口，2026-10-14）：原 `catch { totalFail++ }` 吞错误对象，
  // 发起方只拿到一个数字，排障只能翻日志。保留前若干条（防批量失败时 toast 过长），
  // 格式含包名 + 文件相对名 + friendlyError 缘由，用户侧可自诊断。
  const errors: string[] = [];
  const { totalOk, totalFail, packs, overwrites } = await installAllTargets(
    targets,
    allStatuses,
    rtype,
    app,
    errors,
  );
  await refreshScanCache(app, errors);
  dbg("sync", "同步完成, 发出 stats:refresh, 成功:", totalOk, "失败:", totalFail);
  bus.emit("stats:refresh");
  showDownloadSummary(instanceName, instanceNames, totalOk, totalFail, errors);
  return { ok: totalOk, fail: totalFail, errors, packs, overwrites };
}

/** 导入缺失互斥锁（ADR-340 去总线化后升为模块级常驻）：原锁在 registerSync 内创建，
 *  直调方（app-sidebar）与 registerSync 生命周期无关，锁必须比注册面活得久——跨页
 *  并发（sidebar 批量 × app-tree 触发等）由同一把 withLock 挡下，杜绝忘释放锁死。 */
const downloadLock = createBusyLock();

/**
 * 导入缺失（单包 / 批量）——ADR-340 去总线化的**唯一入口**：调用方 `await` 结果即全部
 * 事实。原 bus 通道（`sync:download:missing` 请求 + `sync:download:done` 回执）上
 * 长出的四件套协议补丁——token 单调序号 / skipped 回执 / waitBusQuiet 静默宽限 /
 * 订阅时序竞态猜测——整体退役：Promise 天然提供请求-响应匹配、错误传播与超时定位。
 *
 * 恒 settle（不 reject）：busy / config / error 归入 `skipped + skipReason` 并附
 * 对应 toast，ok/fail 为文件级安装计数（锐评 P1-1 契约：失败计数必达发起方）。
 * 单包模式（无 instanceNames）自弹结果 toast（右键等直调方无汇总链）；批量模式
 * 静默，反馈权归发起方一条汇总（锐评 P2-1）。
 */
export async function downloadMissing({
  instanceName,
  instanceNames,
  rtype,
}: SyncDownloadPayload): Promise<DownloadOutcome> {
  const result = await withLock(downloadLock, async () => {
    // rtype 必填守卫（原 bus.ts 契约的 runtime 防线随直调保留）：
    // 错误类型装错仓库文件比直接报错危害大
    if (!rtype) {
      toast(t("sync.missingRtype"), TOAST_MS.long, "error");
      return { ok: 0, fail: 0, skipped: true as const, skipReason: "config" as const };
    }
    try {
      const counts = await runDownloadMissing(instanceName, instanceNames, rtype);
      if (!counts) return { ok: 0, fail: 0, skipped: true as const, skipReason: "config" as const };
      // 仅实际做过安装才广播全树重扫——配置缺失短路时无任何写操作，
      // tree:reload 会引发无意义全树重扫
      bus.emit("tree:reload");
      return {
        ok: counts.ok,
        fail: counts.fail,
        skipped: false as const,
        errors: counts.errors,
        packs: counts.packs, // 锐评 P1-3：包级归因随文件级计数一并上抛
        overwrites: counts.overwrites, // ADR-340-d2：覆盖实例侧手改的清单一并上抛
      };
    } catch (e) {
      toast(friendlyError(e), TOAST_MS.long, "error");
      return { ok: 0, fail: 0, skipped: true as const, skipReason: "error" as const };
    }
  });
  if (result === null) {
    // busy 命中如实回报（原 done(skipped:busy) 同语义）：直调串行下自撞锁不再可能
    // （runPush await 上一批 settle 才发下一批），仅剩跨页并发的防御位
    return { ok: 0, fail: 0, skipped: true, skipReason: "busy" };
  }
  return result;
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

/** 注册同步 handler，push 返回的取消订阅函数到 unsubs。
 *  ADR-340：`sync:download:missing` 订阅已摘除（去总线化，调用方直调 `downloadMissing`），
 *  本注册只剩 `sync:toggle:status`——该事件确有多生产者（app-tree 批量/单文件），
 *  广播语义名实相符。 */
export function registerSync(unsubs: Array<() => void>): void {
  // 并发守卫：sync:toggle:status 多生产者连点会并发跑同一批文件写操作（竞态）——
  // 共享忙锁 createBusyLock + withLock（utils/base/lock.ts）：finally 自动释放
  const toggleLock = createBusyLock();
  // 同步启用/禁用状态到所有整合包（ADR-339：透传 rtype，Go 侧按类型对齐 repo↔pack）
  unsubs.push(bus.on("sync:toggle:status", (p) => handleSyncToggleStatus(toggleLock, p)));
}
