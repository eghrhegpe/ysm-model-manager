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

import { importWebFiles, MAX_IMPORT_BYTES } from "@/backend/browser-adapter.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { swallowError } from "@/utils/base/primitives/async.ts";
import { friendlyError, isFileExistsError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import type { CollectedEntry } from "./collector.ts";
import { importGetApp } from "./import-deps.ts";
import { buildFolderItems, fileToBase64, groupCollected } from "./shared.ts";

/** 带相对路径的 File（文件夹导入时标记 _relPath） */
export type ImportFile = File & { _relPath?: string };

/** 导入会话实例（_inFlight 状态内聚于此，不再模块级共享） */
export interface ImportSession {
  directImport(file: File): Promise<void>;
  importFolder(dir: string, files: CollectedEntry[], rtype?: string): Promise<void>;
  executeCollected(
    collected: CollectedEntry[],
    rtype?: string,
  ): Promise<{ folders: number; singles: number }>;
  importWebFilesWithToast(
    files: File[],
    onFinally?: () => void,
  ): Promise<{ imported: number; failed: number }>;
}

const toast = (
  msg: string,
  type: "success" | "error" | "warn" | "info",
  duration: number = TOAST_MS.normal,
): void => {
  bus.emit("toast:show", { msg, duration, type });
};

/** 刷新仓库展示（统计 + 树） */
const refreshRepo = (): void => {
  bus.emit("stats:refresh");
  bus.emit("tree:reload");
};

/**
 * 创建独立的导入会话（_inFlight 状态隔离，测试可注入）。
 * 生产代码使用模块级 defaultImportSession，无需手动创建。
 */
export function createImportSession(): ImportSession {
  /** per-file 在途集合：仅阻止同一文件并发/重复提交，不同文件可并行 */
  const inFlight = new Set<string>();

  /** 单文件直接导入（保留原文件名，后端自动路由类型 + 冲突覆盖确认） */
  async function directImport(file: File): Promise<void> {
    if (file.name.toLowerCase() === "ysm.json") {
      toast(t("import.ysmJsonHint"), "warn", 4000);
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      toast(
        t("import.fileTooLargeSkipped", {
          name: file.name,
          mb: Math.round(MAX_IMPORT_BYTES / 1024 / 1024),
        }),
        "warn",
        TOAST_MS.long,
      );
      return;
    }
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (inFlight.has(key)) {
      toast(t("import.busyImporting"), "warn", TOAST_MS.success);
      return;
    }
    inFlight.add(key);
    try {
      const base64 = await fileToBase64(file);
      const { ImportModelFile } = await importGetApp();
      await ImportModelFile(file.name, base64);
      refreshRepo();
      toast(`${t("import.success")}: ${file.name}`, "success", TOAST_MS.success);
    } catch (e) {
      toast(`❌ ${t("import.failed")}: ${friendlyError(e)}`, "error", TOAST_MS.verbose);
    } finally {
      inFlight.delete(key);
    }
  }

  /** 文件夹整组导入 */
  async function importFolder(dir: string, files: CollectedEntry[], rtype = ""): Promise<void> {
    const firstFile = files.length > 0 ? files[0].file : null;
    const dirKey = `${dir}:${firstFile ? `${firstFile.name}:${firstFile.size}:${firstFile.lastModified}` : ""}`;
    if (inFlight.has(dirKey)) {
      toast(t("import.busyImporting"), "warn", TOAST_MS.success);
      return;
    }
    inFlight.add(dirKey);
    const parts = dir.split("/");
    const folderName = parts[parts.length - 1] || "模型";
    const subpath = parts.slice(0, -1).join("/");
    try {
      const { items, skipped } = await buildFolderItems(dir, files);
      if (!items.length) {
        toast(`❌ ${t("import.emptyFolder")}`, "error", TOAST_MS.verbose);
        return;
      }
      const App = await importGetApp();
      if (rtype && typeof App.ImportModelFolderTo === "function") {
        await App.ImportModelFolderTo(folderName, subpath, rtype, items);
      } else {
        if (rtype) {
          console.warn(
            `[import] ImportModelFolderTo 不可用（旧桥/Android 时序），降级为内容推断：rtype=${rtype}`,
          );
          toast(t("import.contextRouteUnavailable"), "warn", TOAST_MS.verbose);
        }
        await App.ImportModelFolder(folderName, subpath, items);
      }
      refreshRepo();
      const skipHint = skipped > 0 ? `（${skipped} 个文件读取失败已跳过）` : "";
      toast(`${t("import.success")}: ${folderName}${skipHint}`, "success", TOAST_MS.info);
    } catch (e) {
      if (isFileExistsError(e)) {
        toast(`❌ ${folderName} ${t("import.alreadyExists")}`, "error", TOAST_MS.verbose);
      } else {
        toast(`❌ ${t("import.failed")}: ${friendlyError(e)}`, "error", TOAST_MS.verbose);
      }
    } finally {
      inFlight.delete(dirKey);
    }
  }

  /** 执行一组拖拽收集的条目 */
  async function executeCollected(
    collected: CollectedEntry[],
    rtype = "",
  ): Promise<{ folders: number; singles: number }> {
    const log = (msg: string) =>
      swallowError(
        importGetApp().then((app) => app.AddOpLog?.("import", msg, "", "", 0, "ok", "")),
      );
    log(`执行导入 ${collected.length} 个条目`);
    const { folders, singles } = groupCollected(collected);
    log(`分组: folders=${folders.length} singles=${singles.length}`);
    for (const g of folders) {
      await importFolder(g.dir, g.files, rtype);
    }
    for (const c of singles) {
      await directImport(c.file);
    }
    return { folders: folders.length, singles: singles.length };
  }

  /** 网页版导入执行 */
  async function importWebFilesWithToast(
    files: File[],
    onFinally?: () => void,
  ): Promise<{ imported: number; failed: number }> {
    try {
      const r = await importWebFiles(files, currentRepoType());
      bus.emit("toast:show", {
        msg:
          r.failed > 0
            ? `✅ ${r.imported} 个导入成功，${r.failed} 个失败`
            : `✅ ${r.imported} 个模型已导入浏览器模型库`,
        duration: TOAST_MS.verbose,
        type: r.failed > 0 ? "warn" : "success",
      });
      bus.emit("tree:reload");
      bus.emit("stats:refresh");
      return r;
    } catch (e) {
      console.error("[import-web] importWebFiles 失败:", e);
      bus.emit("toast:show", {
        msg: `❌ ${t("import.processError")}: ${friendlyError(e)}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
      return { imported: 0, failed: files.length };
    } finally {
      onFinally?.();
    }
  }

  return { directImport, importFolder, executeCollected, importWebFilesWithToast };
}

/** 模块级默认导入会话（生产代码消费方零改动） */
const defaultImportSession = createImportSession();

/** @deprecated 使用 defaultImportSession.directImport 或 createImportSession() 注入 */
export const directImport = defaultImportSession.directImport;
/** @deprecated 使用 defaultImportSession.importFolder 或 createImportSession() 注入 */
export const importFolder = defaultImportSession.importFolder;
/** @deprecated 使用 defaultImportSession.executeCollected 或 createImportSession() 注入 */
export const executeCollected = defaultImportSession.executeCollected;
/** @deprecated 使用 defaultImportSession.importWebFilesWithToast 或 createImportSession() 注入 */
export const importWebFilesWithToast = defaultImportSession.importWebFilesWithToast;
