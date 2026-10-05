// ===== 网页版本地存储/状态职责（ADR-040 拆分：browser-adapter.ts 职责切分产物）=====
// 配置（localStorage）、导入日志环、运行时日志环、标签、启用开关（ban）。
// 文件系统类操作见 web-fs.ts；社区数据持久化见 web-community.ts。
// browser-adapter.ts 从本文件 import 组装 webImpls。

import { swallowError } from "@/utils/base/primitives/async.ts";
import { safeGetJSON, safeSet } from "@/utils/base/primitives/storage.ts";
import { idbDel, idbGet, idbGetAll, idbSet } from "./idb.ts";

// --- 配置（localStorage，缺省返回 {} 让主应用可启动）---
const CFG_KEY = "ysm:config";

function loadWebConfig(): Record<string, unknown> {
  return safeGetJSON<Record<string, unknown>>(CFG_KEY, {});
}

function saveWebConfig(cfg: Record<string, unknown>): void {
  safeSet(CFG_KEY, JSON.stringify(cfg));
}

// --- 网页版内存日志环（替代 Go 侧 ImportLog / runtimeLogs）---
// 桌面由 Go 进程内环形缓冲 + 落盘；网页版无 Go 进程，用同形内存环兜底。
// 容量与 Go 侧差异为有意为之：import 环对齐 Go maxLogEntries=500（go/logs/logs.go:18）；
// runtime 环 300 高于 Go DefaultRuntimeCap=200（go/logs/runtime.go:11）——网页版日志纯内存
// 无落盘成本，多留诊断上下文；Go 侧 200 含落盘 IO 权衡。调整任一侧容量互不影响。
// 注：error-diary.ts 曾刻意早退不调 AddOpLog（日记不落盘）——ADR-071 已移除早退，
// web 环现在有真实日志；并做 IDB 持久化（#8）刷新不丢。
const WEB_IMPORT_LOG_CAP = 500;
const WEB_RUNTIME_LOG_CAP = 300;
// ADR-071 #8：日志 IDB 持久化 key（config store，刷新/重开浏览器不丢；cap 内环形截断）
const LOG_IMPORT_KEY = "web:import-logs";
const LOG_RUNTIME_KEY = "web:runtime-logs";

/** 导入日志环容量：读配置 logMaxEntries（>0 用之，ADR-062 §2.3），缺省回退 500 */
function importLogCap(): number {
  const v = loadWebConfig().logMaxEntries;
  return typeof v === "number" && v > 0 ? v : WEB_IMPORT_LOG_CAP;
}
const webImportLogs: Array<Record<string, unknown>> = [];
const webRuntimeLogs: Array<Record<string, unknown>> = [];
// 审核 A #3：hydrate 标记——push/get 首次触发一次 IDB 恢复；clear 后重置（下次读到空）
const webLogHydrated: Record<"import" | "runtime", boolean> = { import: false, runtime: false };

function logKeyOf(ring: Array<Record<string, unknown>>): string {
  return ring === webImportLogs ? LOG_IMPORT_KEY : LOG_RUNTIME_KEY;
}
function logHydrateFlagOf(ring: Array<Record<string, unknown>>): "import" | "runtime" {
  return ring === webImportLogs ? "import" : "runtime";
}

// P0 修复（hydrate 竞态）：按 ring 持有一个 hydrate Promise，并发 pushWebLog 共享同一次 hydrate
const webLogHydrating: Record<"import" | "runtime", Promise<void> | null> = {
  import: null,
  runtime: null,
};
/** hydrate 代际计数器（code_review 494843c9 #1/#4）：clear/reset 时递增并置空锁——
 *  在途 hydrate 完成时若代际已变（期间发生过 clear）则放弃 ring.push 与 hydrated 标记，
 *  防「清后快照复活已删日志」（无代际守卫时在途 idbGet 读的是清前数据，push 后又被
 *  pushWebLog 的 idbSet 持久化，撤销 clear） */
const _webLogEpoch: Record<"import" | "runtime", number> = { import: 0, runtime: 0 };

/** 内存环首次使用时从 IDB 恢复上会话日志（幂等：hydrate Promise 锁防并发重复读） */
async function hydrateWebLog(ring: Array<Record<string, unknown>>): Promise<void> {
  const flag = logHydrateFlagOf(ring);
  // 已有进行中的 hydrate → 复用同一 Promise，避免两次 hydrate 读到同一旧数据后互相覆盖
  const pending = webLogHydrating[flag];
  if (pending) return pending;
  if (webLogHydrated[flag]) return;
  const epoch = _webLogEpoch[flag];
  const p = (async () => {
    try {
      const saved = await idbGet<unknown>("config", logKeyOf(ring));
      if (Array.isArray(saved)) ring.push(...(saved as Array<Record<string, unknown>>));
    } catch {
      markWebLogPersistFailed();
      if (!webLogHydrated[flag]) console.warn("[web-store] IDB 不可用，日志无法恢复");
    } finally {
      // 代际守卫：await 期间发生 clear/reset（epoch 已变）→ 读的是清前快照，
      // 不得 push 复活、不得置 hydrated（下次 push 重新 hydrate 读清后状态）
      if (epoch === _webLogEpoch[flag]) {
        webLogHydrated[flag] = true;
        webLogHydrating[flag] = null;
      }
    }
  })();
  webLogHydrating[flag] = p;
  return p;
}

/** 追加日志：先 hydrate（合并上会话旧日志，防 fresh 会话先写后读覆盖丢失），
 *  截断后写回 IDB（fire-and-forget）。ADR-322：写失败**不再** logWarn——
 *  logWarn 会经日记 sink 回到 AddOpLog → pushWebLog → idbSet 失败，构成自指
 *  无限循环（每轮都跨一次 microtask，故不会栈溢出，只会静默烧 CPU）。改为锁存
 *  健康位由诊断页呈现，这是「失败上报通道自身失效」唯一可靠的落点。 */
async function pushWebLog(
  ring: Array<Record<string, unknown>>,
  cap: number,
  entry: Record<string, unknown>,
): Promise<void> {
  await hydrateWebLog(ring);
  ring.push(entry);
  if (ring.length > cap) ring.splice(0, ring.length - cap); // 仅保留最近 cap 条（环形截断）
  idbSet("config", logKeyOf(ring), ring).catch(markWebLogPersistFailed);
}

// ADR-322 D1：网页版的「通道不健康」形态与桌面不同——桌面是「日志写不进文件」，
// 网页版是「日志写不进 IndexedDB，退化为纯内存，刷新即失」。后者此前完全静默
//（pushWebLog 的 swallowError 只进 logWarn，而 logWarn 又经日记 sink 回到
// AddOpLog → pushWebLog 本身，形成自指噪声环），用户只能靠「日志莫名清空」反推。
// 故此处显式锁存并对外暴露，配合诊断页常驻条（ADR-322 D2）。
const LOG_HEALTH_KEY = "web:log-health";
/** reason 机器码：网页版专用，与 Go 侧 ChannelReason* 互不重叠（前端按码分文案） */
const WEB_REASON_IDB = "idb-unavailable";
let webLogPersistOK = true;
let webLogPersistProbe: Promise<boolean> | null = null;

/** 锁存不可用：只置 false 不复位（一次失败即视为通道降级，避免抖动导致红条闪烁） */
function markWebLogPersistFailed(): void {
  webLogPersistOK = false;
}

/**
 * 主动探针：写-删一个哨兵键验证 IDB **可写**（隐私模式常见「可读不可写」，
 * 只读探针会漏判），结果按 Promise 缓存防并发重复探测。
 * 注意：走 .catch 直接吞（不 logWarn）——logWarn 会经日记 sink 绕回本环。
 */
function probeWebLogPersistence(): Promise<boolean> {
  if (webLogPersistProbe) return webLogPersistProbe;
  const p = idbSet("config", LOG_HEALTH_KEY, { at: Date.now() })
    .then(() => idbDel("config", LOG_HEALTH_KEY))
    .then(
      () => true,
      () => false,
    )
    .then((ok) => {
      if (!ok) markWebLogPersistFailed();
      return ok;
    });
  webLogPersistProbe = p;
  return p;
}

/** 对外健康快照（GetLogChannelHealth 实现）：未探针失败且无既往失败 → 健康 */
function webLogPersistenceHealth(): { persistOK: boolean; reason?: string } {
  if (webLogPersistOK) return { persistOK: true };
  return { persistOK: false, reason: WEB_REASON_IDB };
}

async function getWebImportLogs(): Promise<unknown> {
  await hydrateWebLog(webImportLogs);
  return webImportLogs.slice(); // 返回副本，防外部篡改内部环
}
async function getWebRuntimeLogs(): Promise<unknown> {
  await hydrateWebLog(webRuntimeLogs);
  return webRuntimeLogs.slice();
}
async function addWebImportLog(
  modelName: string,
  sourcePath: string,
  targetDir: string,
  fileSize: number,
  status: string,
  errMsg: string,
): Promise<void> {
  await pushWebLog(webImportLogs, importLogCap(), {
    ModelName: modelName,
    SourcePath: sourcePath,
    TargetDir: targetDir,
    FileSize: fileSize,
    Status: status,
    ErrorMsg: errMsg,
    Timestamp: Date.now(),
    Operation: "import",
  });
}
/**
 * ADR-071 有意差异：桌面 AddOpLog(op,modelName,...) 进 ImportLog 全字段环
 * （ModelName/SourcePath/TargetDir/FileSize/Status/ErrorMsg/Level）；
 * web 进 runtime 环、仅记 Message+Timestamp（op 与 modelName 拼成 Message）。
 * 消费方（runtime-logs 面板）只读 Message 字段，故功能等价。
 * 禁静默改动——先改 ADR/契约再改实现。
 */
async function addWebOpLog(
  op: string,
  modelName: string,
  _sourcePath: string,
  _targetDir: string,
  _fileSize: number,
  _status: string,
  errMsg: string,
): Promise<void> {
  // 操作日志归入运行时环（webRuntimeLogs），与导入日志环（webImportLogs）分离，
  // 否则 GetRuntimeLogs 恒空、ClearRuntimeLogs 形同虚设（原实现误写入导入环）
  await pushWebLog(webRuntimeLogs, WEB_RUNTIME_LOG_CAP, {
    Message: `${op} ${modelName}${errMsg ? ` ${errMsg}` : ""}`.trim(),
    Timestamp: Date.now(),
  });
}

/** 清空导入日志环（webImpls.ClearImportLogs 调用；状态封装在 web-store 内部） */
function clearWebImportLogs(): void {
  webImportLogs.length = 0;
  webLogHydrated.import = false; // 重置：下次 hydrate 读到已删 IDB → 空环
  _webLogEpoch.import++; // 代际递增：在途 hydrate 的旧快照作废（code_review 494843c9 #1/#4）
  webLogHydrating.import = null; // 置空锁：防后续 push 绑定到清前在途 hydrate
  swallowError(idbDel("config", LOG_IMPORT_KEY));
}
/** 清空运行时日志环（webImpls.ClearRuntimeLogs 调用；状态封装在 web-store 内部） */
function clearWebRuntimeLogs(): void {
  webRuntimeLogs.length = 0;
  webLogHydrated.runtime = false;
  _webLogEpoch.runtime++; // 代际递增：在途 hydrate 的旧快照作废
  webLogHydrating.runtime = null; // 置空锁：防后续 push 绑定到清前在途 hydrate
  swallowError(idbDel("config", LOG_RUNTIME_KEY));
}

/** 测试钩子：重置日志环状态与 hydrated 标记（防模块级状态测试间污染） */
export function __resetWebLogStateForTest(): void {
  webImportLogs.length = 0;
  webRuntimeLogs.length = 0;
  webLogHydrated.import = false;
  webLogHydrated.runtime = false;
  _webLogEpoch.import++;
  _webLogEpoch.runtime++;
  webLogHydrating.import = null;
  webLogHydrating.runtime = null;
  // ADR-322：健康锁存位与探针缓存同属模块级状态，须一并重置，否则测试间污染
  webLogPersistOK = true;
  webLogPersistProbe = null;
}

/**
 * 测试钩子：只重置探针缓存、**保留**健康锁存位。
 * 存在的理由是「不可复位」是本契约的核心语义（ADR-322 D1）：用整体 reset 钩子
 * 验证它会连带把锁存位清掉，测出来的其实是「探针重新跑过一次」，等于没测。
 */
export function __resetWebLogProbeForTest(): void {
  webLogPersistProbe = null;
}

// --- 标签（config store: tags:<path> = string[]）---
const tagKeyOf = (path: string): string => `tags:${path}`;
async function getWebTags(path: string): Promise<string[]> {
  const v = await idbGet<string[]>("config", tagKeyOf(path));
  return Array.isArray(v) ? v : [];
}
/** 对齐 go/tags/tags.go trimTag：TrimSpace → 剔除 ASCII 控制符（\t 除外）→ 50 rune 截断 */
function trimTagWeb(t: string): string {
  const s = (t ?? "").trim();
  if (s === "") return "";
  let out = "";
  let runes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 && cp !== 0x09) continue; // 控制符（\t 除外）剔除
    out += ch;
    runes++;
    if (runes >= 50) break;
  }
  return out.trimEnd();
}

async function setWebTags(path: string, tags: string[] | null): Promise<void> {
  // null → 清除标签（对齐桌面 SetModelTags(path, null) 删除语义），而非残留空数组 key
  if (tags === null) {
    await idbDel("config", tagKeyOf(path));
    return;
  }
  // 对齐 go/tags/tags.go SetTags：trimTagWeb（去空白/控制符/50 rune）+ 去重 + sort.Strings；
  // 空数组等同删除（len(tags)==0 → delete），避免残留空 key
  const seen = new Set<string>();
  const norm: string[] = [];
  for (const t of tags) {
    const trimmed = trimTagWeb(t);
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    norm.push(trimmed);
  }
  norm.sort();
  if (norm.length === 0) {
    await idbDel("config", tagKeyOf(path));
    return;
  }
  await idbSet("config", tagKeyOf(path), norm);
}
/** 批量取全部标签（一次 IDB 事务），返回 path → tags[] 索引。
 * 替代 listByTagWeb / allTagsWeb 内 N 次单 key get（P1-7 性能修复）。 */
async function getAllTagsIndex(): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  try {
    const rows = await idbGetAll("config", "tags:");
    for (const [key, value] of rows) {
      const path = key.slice("tags:".length);
      if (Array.isArray(value)) index.set(path, value as string[]);
    }
  } catch {
    // IDB 不可用 → 返回空索引
  }
  return index;
}

async function listByTagWeb(tag: string): Promise<string[]> {
  // P1-7 修复：一次 IDB 前缀批量取全部标签建内存索引，替代 N 次单 key get
  const allTags = await getAllTagsIndex();
  const trimmed = trimTagWeb(tag);
  const out: string[] = [];
  for (const [path, tags] of allTags) {
    if (tags.includes(trimmed)) out.push(path);
  }
  return out.sort(); // 对齐桌面 tags.Store.ListByTag 的 sort.Strings（稳定输出）
}
async function allTagsWeb(): Promise<string[]> {
  // P1-7 修复：同上，批量取全部标签
  const allTags = await getAllTagsIndex();
  const counts = new Map<string, number>();
  for (const tags of allTags.values()) {
    for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // 对齐桌面 tags.Store.AllTags 契约：按使用次数降序，同次数按名称升序（标签面板热门在前）
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([t]) => t);
}

// --- 启用开关（config store: ban:<path> = boolean）---
const banKeyOf = (path: string): string => `ban:${path}`;
async function isWebBanned(path: string): Promise<boolean> {
  return (await idbGet<boolean>("config", banKeyOf(path))) === true;
}
async function toggleWebEnable(path: string): Promise<boolean> {
  const nextBanned = !(await isWebBanned(path));
  await idbSet("config", banKeyOf(path), nextBanned);
  return !nextBanned; // 返回新的「已启用」状态（对齐桌面 ToggleModelEnable 语义）
}

// ===== 配置/日志/标签/ban 类 binding 片段（Top 6 注册表驱动：browser-adapter.ts 只做 {...} 装配）=====
// 收敛自 browser-adapter.ts webImpls 的 store 类条目（配置读写/导入与运行时日志环/
// 标签/启用开关）。
export const webStoreBindings = {
  LoadAppConfig: () => Promise.resolve(loadWebConfig()),
  SaveAppConfig: (
    filesRoot: string,
    rpRoot: string,
    mcRoot: string,
    linkMode: string,
    theme: string,
    themeAuto: string,
  ) => {
    // 字段名对齐 AppConfig（消费方读 resourcepackRoot，非 rpRoot）；spread 旧配置避免
    // 整体覆盖丢失 ysmRoot/shaderpackRoot 等；空串保留旧值（对齐桌面 orDefault 语义）
    const prev = loadWebConfig();
    saveWebConfig({
      ...prev,
      filesRoot: filesRoot || prev.filesRoot,
      resourcepackRoot: rpRoot || prev.resourcepackRoot,
      mcRoot: mcRoot || prev.mcRoot,
      linkMode: linkMode || prev.linkMode,
      theme: theme || prev.theme,
      themeAuto: themeAuto || prev.themeAuto,
    });
    return Promise.resolve();
  },
  // ADR-062 §2.3 web 实现：阈值写入 localStorage 覆盖层（与桌面 SaveThresholds 语义对齐，
  // version-updater 读 updateCheckIntervalMs、日志环容量读 logMaxEntries，缺省回退常量）
  SaveThresholds: (checkIntervalMs: number, logMaxEntries: number) => {
    const prev = loadWebConfig();
    saveWebConfig({
      ...prev,
      updateCheckIntervalMs: checkIntervalMs,
      logMaxEntries: logMaxEntries,
    });
    return Promise.resolve();
  },
  // 网页版内存日志环（替代 Go ImportLog / runtimeLogs，消除诊断页 fail-fast 红错）
  GetImportLogs: () => getWebImportLogs(),
  GetRuntimeLogs: () => getWebRuntimeLogs(),
  // 日志环容量单源下发（锐评⑤：诊断页检索窗口不再手写镜像）——op 读配置
  // logMaxEntries（与 importLogCap 同口径），runtime 恒为 web 环常量
  GetLogCaps: async () => ({ op: importLogCap(), runtime: WEB_RUNTIME_LOG_CAP }),
  // ADR-322 D1：网页版「通道健康」语义不对等——无 Go 进程即无「落盘失败」，
  // 但有等价的第二形态：IDB 不可用时日志只剩内存（刷新即失，见 pushWebLog 的
  // 静默降级）。故此处报「持久化是否可用」而非「落盘是否可用」，
  // 前端文案按 reason 区分，不假设桌面口径。首次调用顺带跑一次可写探针：
  // 隐私模式「可读不可写」只有写-删探针能发现，纯读路径永远健康。
  GetLogChannelHealth: async () => {
    await probeWebLogPersistence();
    return webLogPersistenceHealth();
  },
  AddImportLog: (
    modelName: string,
    sourcePath: string,
    targetDir: string,
    fileSize: number,
    status: string,
    errMsg: string,
  ) => addWebImportLog(modelName, sourcePath, targetDir, fileSize, status, errMsg),
  AddOpLog: (
    op: string,
    modelName: string,
    sourcePath: string,
    targetDir: string,
    fileSize: number,
    status: string,
    errMsg: string,
  ) => addWebOpLog(op, modelName, sourcePath, targetDir, fileSize, status, errMsg),
  // 日志环清空（环状态封装在本文件）
  ClearImportLogs: () => {
    clearWebImportLogs();
    return Promise.resolve();
  },
  ClearRuntimeLogs: () => {
    clearWebRuntimeLogs();
    return Promise.resolve();
  },
  // 启用开关：ban 标记翻转，返回新「已启用」态（对齐桌面 ToggleModelEnable 语义）
  IsFileBanned: (path: string) => isWebBanned(path),
  ToggleModelEnable: (path: string) => toggleWebEnable(path),
  // 统一启禁（兄弟会话裁定：无 rtype，纯路径判定）——web 无 .disabled 文件系统，
  // 统一走 IDB ban 标记，与 ToggleModelEnable 语义一致
  ToggleEnable: (path: string) => toggleWebEnable(path),
  // 标签：config store tags:<path>
  GetModelTags: (path: string) => getWebTags(path),
  SetModelTags: (path: string, tags: string[] | null) => setWebTags(path, tags),
  ListByTag: (tag: string) => listByTagWeb(tag),
  AllTags: () => allTagsWeb(),
} satisfies Record<string, (...args: never[]) => Promise<unknown>>;
