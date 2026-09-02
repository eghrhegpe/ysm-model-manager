// ===== DnD 导入共享逻辑（import-queue 与 handler-dnd 共用，消除重复）=====
import { ALL_EXTS } from "../utils/resource/extensions.ts";
import { collectFiles } from "./dnd-collector.ts";

const getExt = (name: string): string =>
  "." + (name.split(".").pop() || "").toLowerCase();

/** 扩展名是否在支持列表 */
export const isSupportedFile = (name: string): boolean =>
  ALL_EXTS.includes(getExt(name));

/** 是否可作为独立文件导入：.json 仅放行 ysm.json 入口清单
 *  包内 geometry/animation/语言 json（main.json / *.animation.json / zh_cn.json 等）不得单独导入
 *  与 go/scanner/scanner.go:80-87 的 ysm.json 白名单对齐（base name 级判断，任意子目录均适用） */
export const isImportableFile = (name: string): boolean => {
  if (getExt(name) === ".json") return name.toLowerCase() === "ysm.json";
  return isSupportedFile(name);
};

/** 判断文件是否需要进入命名表单
 *  2026-08-05：导入默认直接（保留原文件名，后端自动路由类型/冲突覆盖确认），
 *  不再强制命名表单；ysm.json 单文件保留表单提示（整组导入走文件夹路由）。 */
export const shouldEnterForm = (name: string): boolean => {
  const ext = getExt(name);
  return ext === ".json" && name.toLowerCase() === "ysm.json";
};

/** 获取小写扩展名（含点，如 ".ysm"） */
export { getExt };

// ===== 文件夹整组分组（dnd.ts 全局拖拽与 import-queue 导入页共用）=====

/** 收集条目（文件 + 相对路径） */
export interface CollectedEntry {
  file: File;
  relPath: string;
}

/** 文件夹组：dir 为顶层目录名（可能含多级嵌套，组内文件保留完整 relPath） */
export interface FolderGroup {
  dir: string;
  files: CollectedEntry[];
}

/**
 * 将收集到的条目分组：
 * - 有目录前缀的条目 → 按「顶层目录」整组（dir = 第一段路径），组内保留完整 relPath（支持多层嵌套）
 * - 无目录前缀的散落文件 → 单文件队列（isImportableFile 过滤）
 * - 组内至少含 1 个支持文件（.ysm/.zip/ysm.json 等）才作为整组导入，否则整组丢弃（防杂物）
 *   与 go/fileops.WriteModelFolder 的 isSupportedEntryFile 判定对齐
 */
export const groupCollected = (
  collected: CollectedEntry[],
): { folders: FolderGroup[]; singles: CollectedEntry[] } => {
  const byDir = new Map<string, CollectedEntry[]>();
  const singles: CollectedEntry[] = [];
  for (const c of collected) {
    const slash = c.relPath.indexOf("/");
    if (slash === -1) {
      // 顶层散落文件：过滤后再入单文件队列
      if (isImportableFile(c.file.name)) singles.push(c);
      continue;
    }
    const dir = c.relPath.slice(0, slash);
    const arr = byDir.get(dir) || [];
    arr.push(c);
    byDir.set(dir, arr);
  }
  const folders: FolderGroup[] = [];
  for (const [dir, files] of byDir) {
    // 组内至少 1 个支持文件才整组导入（与后端 WriteModelFolder 校验一致）
    if (files.some((c) => isImportableFile(c.file.name))) {
      folders.push({ dir, files });
    }
  }
  return { folders, singles };
};

// ===== File → base64 + 文件夹条目构建（DnD 域共享，消除重复）=====

/** File → base64（10s 超时兜底，防 FileReader 悬挂卡死导入）。
 *  原位于 import-executor.ts，下沉至此统一收口，消除 pack-dnd → import-executor 横向依赖。 */
export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    // P3 修复（子代理审计）：无超时兜底——FileReader 既不走 onload 也不走 onerror 时
    // Promise 永久 pending → 调用方卡死、在途标记永不释放。取 10s 覆盖大文件读取
    const timer = setTimeout(() => {
      reader.abort();
      reject(new Error("读取文件超时: " + file.name));
    }, 10000);
    reader.onload = () => {
      clearTimeout(timer);
      resolve(String(reader.result).split(",")[1] || "");
    };
    reader.onerror = () => {
      clearTimeout(timer);
      reject(new Error("读取文件失败: " + file.name));
    };
    reader.readAsDataURL(file);
  });

/** 文件夹整组导入条目：relPath 去 dir 前缀 + per-file base64（单文件读取失败计入 skipped 跳过，不拖垮整组）。
 *  importFolder 与 handleInstanceDrop 共用，消除两份同构构建逻辑。 */
export const buildFolderItems = async (
  dir: string,
  files: CollectedEntry[],
): Promise<{ items: Array<{ RelPath: string; Base64: string }>; skipped: number }> => {
  const items: Array<{ RelPath: string; Base64: string }> = [];
  let skipped = 0;
  for (const c of files) {
    const rel = c.relPath.startsWith(dir + "/")
      ? c.relPath.slice(dir.length + 1)
      : c.relPath;
    try {
      const b64 = await fileToBase64(c.file);
      if (!b64) continue; // 0 字节文件：base64 为空，跳过（与 importFolder 旧行为一致）
      items.push({ RelPath: rel, Base64: b64 });
    } catch (e) {
      console.warn("[dnd-shared] 跳过读取失败文件:", rel, e);
      skipped++;
    }
  }
  return { items, skipped };
};

// ===== drop 事件文件收集（仓库页 / 整合包卡片共用收集口径）=====

const fileKey = (f: File): string => f.name + ":" + f.size + ":" + f.lastModified;

/** drop 目标是否为可编辑元素（输入框内 drop 不应触发导入） */
export const isEditableTarget = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  return Boolean(
    node &&
      (node.tagName === "INPUT" ||
        node.tagName === "TEXTAREA" ||
        node.isContentEditable),
  );
};

/**
 * 从 drop 事件的 DataTransfer 收集文件（桌面端）：
 * 优先 dataTransfer.files（WebView2 可靠），再 items → webkitGetAsEntry 补充目录条目，
 * 按 name:size:lastModified 去重合并。handleTreeDrop / handleInstanceDrop 共用。
 */
export const collectDropFiles = async (e: DragEvent): Promise<CollectedEntry[]> => {
  const baseFiles: CollectedEntry[] = Array.from(e.dataTransfer?.files || []).map((f) => ({
    file: f,
    relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
  }));
  const items = Array.from(e.dataTransfer?.items || []);
  if (items.length === 0) return baseFiles;
  const viaItems = await collectFiles(items, false);
  const seen = new Set(baseFiles.map((c) => fileKey(c.file)));
  for (const c of viaItems) {
    if (!seen.has(fileKey(c.file))) {
      seen.add(fileKey(c.file));
      baseFiles.push(c);
    }
  }
  return baseFiles;
};