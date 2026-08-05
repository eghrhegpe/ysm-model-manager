// ===== DnD 导入共享逻辑（import-queue 与 handler-dnd 共用，消除重复）=====
import { ALL_EXTS } from "../utils/resource/extensions.ts";

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

/** 判断文件是否需要进入命名表单（异步）
 *  2026-08-05：导入默认直接（保留原文件名，后端自动路由类型/冲突覆盖确认），
 *  不再强制命名表单；ys m.json 单文件保留表单提示（整组导入走文件夹路由）。 */
export const shouldEnterForm = async (
  name: string,
  base64: string,
): Promise<boolean> => {
  const ext = getExt(name);
  if (ext === ".json" && name.toLowerCase() === "ysm.json") return true;
  return false;
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
 * - 组内至少含 1 个支持文件（.ysm/.zip/.7z/ysm.json 等）才作为整组导入，否则整组丢弃（防杂物）
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