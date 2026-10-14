// ===== 全局导入执行器（2026-08-05：静默导入改造）=====
// 导入 tab 删除后，拖拽/选择文件直接走本模块全局执行，不依赖任何 UI 挂载：
// - directImport：单文件直导（.ysm/.zip 保留原名，后端自动路由）
// - importFolder：文件夹整组导入（含 ysm.json 或普通文件夹，组内至少 1 个支持文件）
// - inFlight 去重 + toast/stats/tree 广播
// 与 go/importer + go/fileops.WriteModelFolder 后端对齐。
//
// 并发策略：executeCollected 对 folders/singles 串行发起请求（for...await），
// 但 Go 侧 ImportModelFile 各自独立 goroutine 落盘/解压/清缓存，实际天然并行。
// 前端 base64 编码不是瓶颈（毫秒级），串行发起即可；真正并发缺口由 Go 填充。
//
// 归属边界：类型路由/冲突检测/解压/扫描缓存失效全在 Go；前端只做去重/路由/广播。
// 不接前端预检查（哈希重复检测 Go 已做、缺失纹理归扫描阶段）。
//
// P0 整改：_inFlight 移入 createImportSession() 工厂闭包，消除模块级可变全局。
// 模块级 defaultImportSession 保持既有消费者零改动。
//
// 结构：业务体提为模块级纯参数函数（inFlight 以 Set 传参，消除嵌套罚分），
// createImportSession 只做「状态装配 + 接口适配」，认知复杂度保持个位数。

import { importWebFiles, MAX_IMPORT_BYTES } from "@/backend/browser-adapter.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { swallowError } from "@/utils/base/primitives/async.ts";
import { friendlyError, isFileExistsError } from "@/utils/dom/errors.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import type { CollectedEntry } from "./collector.ts";
import { importGetApp } from "./import-deps.ts";
import { buildFolderItems, fileToBase64, groupCollected } from "./shared.ts";

/** 带相对路径的 File（文件夹导入时标记 _relPath） */
export type ImportFile = File & { _relPath?: string };

/** 单条导入结局（锐评 UX #2 收口，2026-10-14）：distinguish 「跳过」vs「失败」——
 *  跳过（ysm.json 引导/超限/inFlight 拦截）不是失败，汇总时不应计入 M 失败。 */
export type ImportOutcome = "imported" | "skipped" | "failed";

/** 单条导入结果（quiet 模式返回，供 executeCollected 聚合；非 quiet 保持 toast + 忽略返回） */
export interface ImportResult {
  outcome: ImportOutcome;
  /** failed 时填缘由（friendlyError 单源） */
  error?: string;
}

/** 批量导入汇总（executeCollected 返回；调用方据此做「N 成功 M 失败」汇总 toast） */
export interface ImportBatchResult {
  folders: number;
  singles: number;
  imported: number;
  failed: number;
  skipped: number;
  /** 前 3 条 failed 缘由（对齐 dedup runExecDelete 的 errors[] 范式） */
  errors: string[];
}

/** quiet = 不弹逐条 toast（批导入由调用方出汇总，避免拖 50 个文件 = 50 条连珠炮） */
export interface ImportOpts {
  quiet?: boolean;
}

/** 导入会话实例（_inFlight 状态内聚于此，不再模块级共享） */
export interface ImportSession {
  directImport(file: File, opts?: ImportOpts): Promise<ImportResult>;
  importFolder(
    dir: string,
    files: CollectedEntry[],
    rtype?: string,
    opts?: ImportOpts,
  ): Promise<ImportResult>;
  executeCollected(
    collected: CollectedEntry[],
    rtype?: string,
    opts?: ImportOpts,
  ): Promise<ImportBatchResult>;
  importWebFilesWithToast(
    files: File[],
    onFinally?: () => void,
  ): Promise<{ imported: number; failed: number }>;
}

/** 刷新仓库展示（统计 + 树） */
const refreshRepo = (): void => {
  bus.emit("stats:refresh");
  bus.emit("tree:reload");
};

/** 环形日志面板写入器（非阻塞，失败经 swallowError 记录）。 */
const logImport = (msg: string): void => {
  swallowError(importGetApp().then((app) => app.AddOpLog?.("import", msg, "", "", 0, "ok", "")));
};

/** buildFolderItems 产出的推送载荷形状。 */
type FolderItems = Awaited<ReturnType<typeof buildFolderItems>>["items"];

/** 后端 App 绑定形状。 */
type ImportApp = Awaited<ReturnType<typeof importGetApp>>;

/**
 * 单文件直导前守卫：ysm.json / 超限 / 在途 三者任一命中即拦截。
 * @returns 字符串 = 通过守卫并已入在途的 key；ImportResult = 已被拦截的跳过结局。
 */
function directImportGuard(
  file: File,
  opts: ImportOpts,
  inFlight: Set<string>,
): string | ImportResult {
  if (file.name.toLowerCase() === "ysm.json") {
    if (!opts.quiet) toast(t("import.ysmJsonHint"), 4000, "warn");
    return { outcome: "skipped" };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    if (!opts.quiet)
      toast(
        t("import.fileTooLargeSkipped", {
          name: file.name,
          mb: Math.round(MAX_IMPORT_BYTES / 1024 / 1024),
        }),
        TOAST_MS.long,
        "warn",
      );
    return { outcome: "skipped" };
  }
  const key = `${file.name}:${file.size}:${file.lastModified}`;
  if (inFlight.has(key)) {
    if (!opts.quiet) toast(t("import.busyImporting"), TOAST_MS.success, "warn");
    return { outcome: "skipped" };
  }
  inFlight.add(key);
  return key;
}

/** 单文件直接导入（保留原文件名，后端自动路由类型 + 冲突覆盖确认）。 */
async function importSingleFile(
  file: File,
  opts: ImportOpts,
  inFlight: Set<string>,
): Promise<ImportResult> {
  const key = directImportGuard(file, opts, inFlight);
  if (typeof key !== "string") return key;
  try {
    const base64 = await fileToBase64(file);
    const { ImportModelFile } = await importGetApp();
    await ImportModelFile(file.name, base64);
    refreshRepo();
    if (!opts.quiet) toast(`${t("import.success")}: ${file.name}`, TOAST_MS.success, "success");
    return { outcome: "imported" };
  } catch (e) {
    const msg = `${t("import.failed")}: ${friendlyError(e)}`;
    if (!opts.quiet) toast(msg, TOAST_MS.verbose, "error");
    return { outcome: "failed", error: msg };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * 文件夹整组推送：rtype 非空且桥支持 ImportModelFolderTo 时按类型路由落盘，
 * 否则降级 ImportModelFolder（内容推断）；rtype 有值而桥不支持时显式告警不静默。
 */
async function pushFolderToBackend(
  App: ImportApp,
  folderName: string,
  subpath: string,
  rtype: string,
  items: FolderItems,
  opts: ImportOpts,
): Promise<void> {
  if (rtype && typeof App.ImportModelFolderTo === "function") {
    await App.ImportModelFolderTo(folderName, subpath, rtype, items);
    return;
  }
  if (rtype) {
    console.warn(
      `[import] ImportModelFolderTo 不可用（旧桥/Android 时序），降级为内容推断：rtype=${rtype}`,
    );
    if (!opts.quiet) toast(t("import.contextRouteUnavailable"), TOAST_MS.verbose, "warn");
  }
  await App.ImportModelFolder(folderName, subpath, items);
}

/** 文件夹导入失败文案：已存在走专属措辞，否则 friendlyError 单源。 */
function folderFailureMsg(e: unknown, folderName: string): string {
  if (isFileExistsError(e)) return `${folderName} ${t("import.alreadyExists")}`;
  return `${t("import.failed")}: ${friendlyError(e)}`;
}

/** 文件夹整组导入。 */
async function importFolderGroup(
  dir: string,
  files: CollectedEntry[],
  rtype: string,
  opts: ImportOpts,
  inFlight: Set<string>,
): Promise<ImportResult> {
  const firstFile = files.length > 0 ? files[0].file : null;
  const dirKey = `${dir}:${firstFile ? `${firstFile.name}:${firstFile.size}:${firstFile.lastModified}` : ""}`;
  if (inFlight.has(dirKey)) {
    if (!opts.quiet) toast(t("import.busyImporting"), TOAST_MS.success, "warn");
    return { outcome: "skipped" };
  }
  inFlight.add(dirKey);
  const parts = dir.split("/");
  const folderName = parts[parts.length - 1] || "模型";
  const subpath = parts.slice(0, -1).join("/");
  try {
    const { items, skipped } = await buildFolderItems(dir, files);
    if (!items.length) {
      const msg = t("import.emptyFolder");
      if (!opts.quiet) toast(msg, TOAST_MS.verbose, "error");
      return { outcome: "failed", error: msg };
    }
    const App = await importGetApp();
    await pushFolderToBackend(App, folderName, subpath, rtype, items, opts);
    refreshRepo();
    const skipHint = skipped > 0 ? `（${skipped} 个文件读取失败已跳过）` : "";
    if (!opts.quiet)
      toast(`${t("import.success")}: ${folderName}${skipHint}`, TOAST_MS.info, "success");
    return { outcome: "imported" };
  } catch (e) {
    const msg = folderFailureMsg(e, folderName);
    if (!opts.quiet) toast(msg, TOAST_MS.verbose, "error");
    return { outcome: "failed", error: msg };
  } finally {
    inFlight.delete(dirKey);
  }
}

/** 执行一组拖拽收集的条目。 */
async function executeBatch(
  collected: CollectedEntry[],
  rtype: string,
  opts: ImportOpts,
  inFlight: Set<string>,
): Promise<ImportBatchResult> {
  logImport(`执行导入 ${collected.length} 个条目`);
  const { folders, singles } = groupCollected(collected);
  logImport(`分组: folders=${folders.length} singles=${singles.length}`);
  const imported: ImportResult[] = [];
  for (const g of folders) {
    imported.push(await importFolderGroup(g.dir, g.files, rtype, opts, inFlight));
  }
  for (const c of singles) {
    imported.push(await importSingleFile(c.file, opts, inFlight));
  }
  // 汇总（对接锐评 UX #2 收口）：调用方据 imported/failed/skipped 出「N 成功 M 失败」一条 toast
  const failed = imported.filter((r) => r.outcome === "failed");
  return {
    folders: folders.length,
    singles: singles.length,
    imported: imported.filter((r) => r.outcome === "imported").length,
    failed: failed.length,
    skipped: imported.filter((r) => r.outcome === "skipped").length,
    errors: failed.slice(0, 3).map((r) => r.error ?? ""),
  };
}

/** 网页版导入执行。 */
async function importWebBatch(
  files: File[],
  onFinally?: () => void,
): Promise<{ imported: number; failed: number }> {
  try {
    const r = await importWebFiles(files, currentRepoType());
    toast(
      r.failed > 0
        ? `${r.imported} 个导入成功，${r.failed} 个失败`
        : `${r.imported} 个模型已导入浏览器模型库`,
      TOAST_MS.verbose,
      r.failed > 0 ? "warn" : "success",
    );
    bus.emit("tree:reload");
    bus.emit("stats:refresh");
    return r;
  } catch (e) {
    console.error("[import-web] importWebFiles 失败:", e);
    toast(`${t("import.processError")}: ${friendlyError(e)}`, TOAST_MS.verbose, "error");
    return { imported: 0, failed: files.length };
  } finally {
    onFinally?.();
  }
}

/**
 * 创建独立的导入会话（_inFlight 状态隔离，测试可注入）。
 * 生产代码使用模块级 defaultImportSession，无需手动创建。
 */
export function createImportSession(): ImportSession {
  /** per-file 在途集合：仅阻止同一文件并发/重复提交，不同文件可并行 */
  const inFlight = new Set<string>();

  return {
    directImport: (file, opts) => importSingleFile(file, opts ?? {}, inFlight),
    importFolder: (dir, files, rtype, opts) =>
      importFolderGroup(dir, files, rtype ?? "", opts ?? {}, inFlight),
    executeCollected: (collected, rtype, opts) =>
      executeBatch(collected, rtype ?? "", opts ?? {}, inFlight),
    importWebFilesWithToast: importWebBatch,
  };
}

/** 模块级默认导入会话（生产代码消费方零改动） */
const defaultImportSession = createImportSession();

/** @deprecated 使用 defaultImportSession.directImport 或 createImportSession() 注入 */
export const directImport: ImportSession["directImport"] = defaultImportSession.directImport;
/** @deprecated 使用 defaultImportSession.importFolder 或 createImportSession() 注入 */
export const importFolder: ImportSession["importFolder"] = defaultImportSession.importFolder;
/** @deprecated 使用 defaultImportSession.executeCollected 或 createImportSession() 注入 */
export const executeCollected: ImportSession["executeCollected"] =
  defaultImportSession.executeCollected;
/** @deprecated 使用 defaultImportSession.importWebFilesWithToast 或 createImportSession() 注入 */
export const importWebFilesWithToast: ImportSession["importWebFilesWithToast"] =
  defaultImportSession.importWebFilesWithToast;
