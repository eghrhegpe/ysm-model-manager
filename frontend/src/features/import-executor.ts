// ===== 全局导入执行器（2026-08-05：静默导入改造）=====
// 拖拽导入不再依赖导入 tab 挂载（initImportQueue 懒加载），由本模块全局执行：
// - directImport：单文件直导（.ysm/.zip 保留原名，后端自动路由）
// - importFolder：文件夹整组导入（含 ysm.json 或普通文件夹，组内至少 1 个支持文件）
// - inFlight 去重 + toast/stats/tree 广播
// 与 go/importer + go/fileops.WriteModelFolder 后端对齐。
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { getApp } from "../backend/app.ts";
import { importWebFiles } from "../backend/browser-adapter.ts";
import { currentRepoType } from "./repo-rtype.ts";
import { groupCollected, isImportableFile, fileToBase64, buildFolderItems } from "./dnd-shared.ts";
import type { CollectedEntry } from "./dnd-shared.ts";
import { isFileExistsError, friendlyError } from "../utils/dom/errors.ts";
import { dbg } from "../utils/debug/debug.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { swallowError } from "../utils/core/async.ts";

/** 带相对路径的 File（文件夹导入时标记 _relPath） */
export type ImportFile = File & { _relPath?: string };

/** 收集条目类型复用 dnd-shared（唯一事实源，消除两处同构定义） */
export type { CollectedEntry };

/** per-file 在途集合：仅阻止同一文件并发/重复提交，不同文件可并行 */
const _inFlight = new Set<string>();

const toast = (msg: string, type: "success" | "error" | "warn" | "info", duration: number = TOAST_MS.normal): void => {
  bus.emit("toast:show", { msg, duration, type });
};

/** 刷新仓库展示（统计 + 树） */
const refreshRepo = (): void => {
  bus.emit("stats:refresh");
  bus.emit("tree:reload");
};

/** 单文件直接导入（保留原文件名，后端自动路由类型 + 冲突覆盖确认） */
export const directImport = async (file: File): Promise<void> => {
  // ysm.json 单文件 = 光杆清单（geometry/纹理全丢），引导拖整个文件夹
  if (file.name.toLowerCase() === "ysm.json") {
    toast(t("import.ysmJsonHint"),
      "warn",
      4000,
    );
    return;
  }
  // 键含 size+lastModified，防同名不同源文件误判在途
  const key = file.name + ":" + file.size + ":" + file.lastModified;
  if (_inFlight.has(key)) {
    // P2 修复（子代理审计）：busy 命中静默 return 违反 ADR-044①「busy 命中必回
    // 反馈」——用户重复提交同一文件时零反馈（无 toast/无 skipped）；与 sync.ts
    // 「busy 命中回 done+skipped」范式对齐，此处发 toast
    toast(t("import.busyImporting"), "warn", TOAST_MS.success);
    return;
  }
  _inFlight.add(key);
  try {
    const base64 = await fileToBase64(file);
    const { ImportModelFile } = await getApp();
    await ImportModelFile(file.name, base64);
    refreshRepo();
    toast(t("import.success") + ": " + file.name, "success", TOAST_MS.success);
  } catch (e) {
    // 显式化：friendlyError 消费 AppError.Code → i18n 文案（FILE_EXISTS 等），
    // 未归类 Code 透传 Go Reason/Suggestion 并剥离内部路径（ADR-082 续）
    toast("❌ " + t("import.failed") + ": " + friendlyError(e), "error", TOAST_MS.verbose);
  } finally {
    _inFlight.delete(key);
  }
};

/** 文件夹整组导入（含 ysm.json 模型目录或普通文件夹；组内至少 1 个支持文件由调用方保证）
 *  rtype：页面上下文类型（当前树根属性，派生自注册表路由配置）——非空走
 *  ImportModelFolderTo 上下文路由（用户拖到哪页落哪页的根），空串走后端内容推断。 */
export const importFolder = async (
  dir: string,
  files: CollectedEntry[],
  rtype = "",
): Promise<void> => {
  // 并发守护：与 directImport 的 _inFlight 对称，阻止同一文件夹重复提交
  // BUG-FIX（审核 2026-08-20）：原 key 仅用 dir（顶层文件夹名），不同来源的同名
  // 文件夹（如分别从 Desktop 和 Documents 拖入两个 "model" 文件夹）会误碰撞——
  // 第二个导入被 "busy" 拦截而实际并非同一文件夹。修复：key 追加首文件指纹
  // （name+size+lastModified），与 directImport 的 key 构造范式对齐，保证跨源唯一
  const firstFile = files.length > 0 ? files[0].file : null;
  const dirKey = dir + ":" + (firstFile ? firstFile.name + ":" + firstFile.size + ":" + firstFile.lastModified : "");
  if (_inFlight.has(dirKey)) {
    // P2 修复（子代理审计）：同上——busy 命中静默 return 零反馈，改 toast
    toast(t("import.busyImporting"), "warn", TOAST_MS.success);
    return;
  }
  _inFlight.add(dirKey);
  const parts = dir.split("/");
  const folderName = parts[parts.length - 1] || "模型";
  const subpath = parts.slice(0, -1).join("/");
  try {
    // 共享构建（dnd-shared.buildFolderItems）：relPath 切片 + per-file base64，
    // 读取失败计入 skipped 跳过整组不拖垮；空 base64 自动 continue
    const { items, skipped } = await buildFolderItems(dir, files);
    if (!items.length) {
      toast("❌ " + t("import.emptyFolder"), "error", TOAST_MS.verbose);
      return;
    }
    const App = await getApp();
    // P3 审核修复：旧桥/Android 绑定时序缺 ImportModelFolderTo 时 typeof 守卫，
    // 退回内容推断旧路径而非整条拖入 TypeError（文档承诺的空上下文兜底语义）。
    // P3-2（审核）：降级不可静默——有页面上下文但桥缺失时 warn 提示，否则
    // .zip 歧义文件夹会按内容推断落 ysm 根却 toast「导入成功」，错位不可见。
    if (rtype && typeof App.ImportModelFolderTo === "function") {
      await App.ImportModelFolderTo(folderName, subpath, rtype, items);
    } else {
      if (rtype) {
        console.warn(`[import] ImportModelFolderTo 不可用（旧桥/Android 时序），降级为内容推断：rtype=${rtype}`);
        toast(t("import.contextRouteUnavailable"), "warn", TOAST_MS.verbose);
      }
      await App.ImportModelFolder(folderName, subpath, items);
    }
    refreshRepo();
    // 部分文件跳过时成功 toast 带计数，避免用户以为全部导入（ADR-082 续）
    const skipHint = skipped > 0 ? `（${skipped} 个文件读取失败已跳过）` : "";
    toast(t("import.success") + ": " + folderName + skipHint, "success", TOAST_MS.info);
  } catch (e) {
    // 统一文件已存在判定（索引 4.2）：结构化 Code 优先，字符串兜底覆盖漂移文案
    if (isFileExistsError(e)) {
      toast(`❌ ${folderName} ${t("import.alreadyExists")}`, "error", TOAST_MS.verbose);
    } else {
      // 显式化：friendlyError 展示 Go 结构化错误（Reason/Suggestion），剥内部路径
      toast("❌ " + t("import.failed") + ": " + friendlyError(e), "error", TOAST_MS.verbose);
    }
  } finally {
    _inFlight.delete(dirKey);
  }
};

/**
 * 执行一组拖拽收集的条目（静默导入入口）：
 * 文件夹 → 整组（组内至少 1 个支持文件）；散落单文件 → 直导。
 * 与导入页 routeCollected 语义一致；全局调用不依赖导入 tab 挂载。
 */
export const executeCollected = async (
  collected: CollectedEntry[],
  rtype = "",
): Promise<{ folders: number; singles: number }> => {
  const log = (msg: string) =>
    swallowError(getApp().then((app) => app.AddOpLog?.("import", msg, "", "", 0, "ok", "")));
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
};

/**
 * 网页版导入执行（ADR-049 Phase 3）：拖入/选择文件 → importWebFiles 直写 IndexedDB
 * → toast 反馈 → tree/stats 刷新。收敛 import-dnd.ts + import-queue-events.ts 三处重复。
 * @param files 文件数组（网页版不支持文件夹，调用方已校验）
 * @param onFinally 可选收尾（如清空 fileInput.value）
 * @returns importWebFiles 结果 { imported, failed }
 */
export const importWebFilesWithToast = async (
  files: File[],
  onFinally?: () => void,
): Promise<{ imported: number; failed: number }> => {
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
      // 显式化：friendlyError 消费 AppError 结构化错误（ADR-082 续）
      msg: "❌ " + t("import.processError") + ": " + friendlyError(e),
      duration: TOAST_MS.verbose,
      type: "error",
    });
    return { imported: 0, failed: files.length };
  } finally {
    onFinally?.();
  }
};

/** 是否可作为独立文件导入（供外部过滤，dnd-shared 透传） */
export { isImportableFile };
