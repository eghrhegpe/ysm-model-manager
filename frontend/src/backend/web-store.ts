// ===== 网页版本地存储/状态职责（ADR-040 拆分：browser-adapter.ts 职责切分产物）=====
// 配置（localStorage）、导入日志环、运行时日志环、标签、启用开关（ban）。
// 文件系统类操作见 web-fs.ts；社区数据持久化见 web-community.ts。
// browser-adapter.ts 从本文件 import 组装 webImpls。
import { idbGet, idbSet, idbDel } from "./idb.ts";
import { scanAllWebModels } from "./web-fs.ts";
import { safeGet, safeSet } from "../utils/dom/storage.ts";
import { swallowError } from "../utils/core/async.ts";

// --- 配置（localStorage，缺省返回 {} 让主应用可启动）---
const CFG_KEY = "ysm:config";

function loadWebConfig(): Record<string, unknown> {
  try {
    return JSON.parse(safeGet(CFG_KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
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

/** 内存环首次使用时从 IDB 恢复上会话日志（幂等：hydrated 标记防重复读） */
async function hydrateWebLog(ring: Array<Record<string, unknown>>): Promise<void> {
  const flag = logHydrateFlagOf(ring);
  if (webLogHydrated[flag]) return;
  try {
    const saved = await idbGet<unknown>("config", logKeyOf(ring));
    if (Array.isArray(saved)) ring.push(...(saved as Array<Record<string, unknown>>));
  } catch {
    // IDB 不可用：保持空环
  }
  webLogHydrated[flag] = true;
}

/** 追加日志：先 hydrate（合并上会话旧日志，防 fresh 会话先写后读覆盖丢失），
 *  截断后写回 IDB（fire-and-forget：swallowError 记录失败；隐私模式/写失败静默降级为纯内存） */
async function pushWebLog(ring: Array<Record<string, unknown>>, cap: number, entry: Record<string, unknown>): Promise<void> {
  await hydrateWebLog(ring);
  ring.push(entry);
  if (ring.length > cap) ring.splice(0, ring.length - cap); // 仅保留最近 cap 条（环形截断）
  swallowError(idbSet("config", logKeyOf(ring), ring));
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
  modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string,
): Promise<void> {
  await pushWebLog(webImportLogs, importLogCap(), {
    ModelName: modelName, SourcePath: sourcePath, TargetDir: targetDir,
    FileSize: fileSize, Status: status, ErrorMsg: errMsg, Timestamp: Date.now(), Operation: "import",
  });
}
async function addWebOpLog(
  op: string, modelName: string, _sourcePath: string, _targetDir: string, _fileSize: number, _status: string, errMsg: string,
): Promise<void> {
  // 操作日志归入运行时环（webRuntimeLogs），与导入日志环（webImportLogs）分离，
  // 否则 GetRuntimeLogs 恒空、ClearRuntimeLogs 形同虚设（原实现误写入导入环）
  await pushWebLog(webRuntimeLogs, WEB_RUNTIME_LOG_CAP, {
    Message: `${op} ${modelName}${errMsg ? " " + errMsg : ""}`.trim(),
    Timestamp: Date.now(),
  });
}

/** 清空导入日志环（webImpls.ClearImportLogs 调用；状态封装在 web-store 内部） */
function clearWebImportLogs(): void {
  webImportLogs.length = 0;
  webLogHydrated.import = false; // 重置：下次 hydrate 读到已删 IDB → 空环
  swallowError(idbDel("config", LOG_IMPORT_KEY));
}
/** 清空运行时日志环（webImpls.ClearRuntimeLogs 调用；状态封装在 web-store 内部） */
function clearWebRuntimeLogs(): void {
  webRuntimeLogs.length = 0;
  webLogHydrated.runtime = false;
  swallowError(idbDel("config", LOG_RUNTIME_KEY));
}

/** 测试钩子：重置日志环状态与 hydrated 标记（防模块级状态测试间污染） */
export function __resetWebLogStateForTest(): void {
  webImportLogs.length = 0;
  webRuntimeLogs.length = 0;
  webLogHydrated.import = false;
  webLogHydrated.runtime = false;
}

// --- 标签（config store: tags:<path> = string[]）---
const tagKeyOf = (path: string): string => `tags:${path}`;
async function getWebTags(path: string): Promise<string[]> {
  const v = await idbGet<string[]>("config", tagKeyOf(path));
  return Array.isArray(v) ? v : [];
}
async function setWebTags(path: string, tags: string[] | null): Promise<void> {
  // null → 清除标签（对齐桌面 SetModelTags(path, null) 删除语义），而非残留空数组 key
  if (tags === null) {
    await idbDel("config", tagKeyOf(path));
    return;
  }
  // 对齐 go/tags/tags.go SetTags：trimTag（去空白/控制符）+ 去重 + sort.Strings；
  // 空数组等同删除（len(tags)==0 → delete），避免残留空 key
  const seen = new Set<string>();
  const norm: string[] = [];
  for (const t of tags) {
    const trimmed = (t ?? "").trim();
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
async function listByTagWeb(tag: string): Promise<string[]> {
  const models = await scanAllWebModels();
  const out: string[] = [];
  // 对齐 go/tags/tags.go ListByTag：tag = trimTag(tag) 后再匹配
  const trimmed = (tag ?? "").trim();
  for (const m of models) {
    const tags = await getWebTags(m.path);
    if (tags.includes(trimmed)) out.push(m.path);
  }
  return out.sort(); // 对齐桌面 tags.Store.ListByTag 的 sort.Strings（稳定输出）
}
async function allTagsWeb(): Promise<string[]> {
  const models = await scanAllWebModels();
  const counts = new Map<string, number>();
  for (const m of models) {
    for (const t of await getWebTags(m.path)) counts.set(t, (counts.get(t) ?? 0) + 1);
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
  SaveAppConfig: (filesRoot: string, rpRoot: string, mcRoot: string, linkMode: string, theme: string) => {
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
  AddImportLog: (modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string) =>
    addWebImportLog(modelName, sourcePath, targetDir, fileSize, status, errMsg),
  AddOpLog: (op: string, modelName: string, sourcePath: string, targetDir: string, fileSize: number, status: string, errMsg: string) =>
    addWebOpLog(op, modelName, sourcePath, targetDir, fileSize, status, errMsg),
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
