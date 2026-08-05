// ===== 全局导入执行器（2026-08-05：静默导入改造）=====
// 拖拽导入不再依赖导入 tab 挂载（initImportQueue 懒加载），由本模块全局执行：
// - directImport：单文件直导（.ysm/.zip/.7z 保留原名，后端自动路由）
// - importFolder：文件夹整组导入（含 ysm.json 或普通文件夹，组内至少 1 个支持文件）
// - 内存历史（导入 tab 渲染数据源）+ inFlight 去重 + toast/stats/tree 广播
// 与 go/importer + go/fileops.WriteModelFolder 后端对齐。
import { bus } from "../bus.ts";
import { getApp } from "../wails/app.ts";
import { groupCollected, isImportableFile } from "./dnd-shared.ts";

/** 带相对路径的 File（文件夹导入时标记 _relPath） */
export type ImportFile = File & { _relPath?: string };

/** 已导入历史条目（导入 tab「已导入」列表数据源） */
export interface ImportRecord {
  name: string;
  time: string;
  isYsm?: boolean;
}

/** 收集条目（文件 + 相对路径） */
export interface CollectedEntry {
  file: File;
  relPath: string;
}

let _records: ImportRecord[] = [];
/** per-file 在途集合：仅阻止同一文件并发/重复提交，不同文件可并行 */
const _inFlight = new Set<string>();

export const ImportHistory = {
  get records(): ImportRecord[] {
    return _records;
  },

  push(rec: ImportRecord): void {
    _records.unshift(rec);
    bus.emit("import:history-changed", { records: _records });
  },

  /** 重命名历史条目（导入 tab ✂️ 重命名后同步） */
  rename(oldName: string, newName: string): void {
    const rec = _records.find((r) => r.name === oldName);
    if (rec) {
      rec.name = newName;
      bus.emit("import:history-changed", { records: _records });
    }
  },

  clear(): void {
    _records = [];
    bus.emit("import:history-changed", { records: [] });
  },
};

const toast = (msg: string, type: "success" | "error" | "warn" | "info", duration = 3000): void => {
  bus.emit("toast:show", { msg, duration, type });
};

/** 刷新仓库展示（统计 + 树） */
const refreshRepo = (): void => {
  bus.emit("stats:refresh");
  bus.emit("tree:reload");
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });

/** 单文件直接导入（保留原文件名，后端自动路由类型 + 冲突覆盖确认） */
export const directImport = async (file: File): Promise<void> => {
  // ysm.json 单文件 = 光杆清单（geometry/纹理全丢），引导拖整个文件夹
  if (file.name.toLowerCase() === "ysm.json") {
    toast(
      "ysm.json 是模型清单，请拖入整个模型文件夹（含 geometry/动画/纹理，将整组导入）",
      "warn",
      4000,
    );
    return;
  }
  if (_inFlight.has(file.name)) return;
  _inFlight.add(file.name);
  try {
    const base64 = await fileToBase64(file);
    const { ImportModelFile } = await getApp();
    await ImportModelFile(file.name, base64);
    ImportHistory.push({
      name: file.name,
      time: new Date().toLocaleTimeString(),
      isYsm: false,
    });
    refreshRepo();
    toast("✅ 已导入: " + file.name, "success", 2000);
  } catch (e) {
    toast("❌ 导入失败: " + String(e), "error", 4000);
  } finally {
    _inFlight.delete(file.name);
  }
};

/** 文件夹整组导入（含 ysm.json 模型目录或普通文件夹；组内至少 1 个支持文件由调用方保证） */
export const importFolder = async (
  dir: string,
  files: CollectedEntry[],
): Promise<void> => {
  const parts = dir.split("/");
  const folderName = parts[parts.length - 1] || "模型";
  const subpath = parts.slice(0, -1).join("/");
  const items: Array<{ RelPath: string; Base64: string }> = [];
  for (const c of files) {
    const rel = c.relPath.startsWith(dir + "/")
      ? c.relPath.slice(dir.length + 1)
      : c.relPath;
    const b64 = await fileToBase64(c.file);
    if (!b64) continue;
    items.push({ RelPath: rel, Base64: b64 });
  }
  if (!items.length) return;
  try {
    const { ImportModelFolder } = await getApp();
    await ImportModelFolder(folderName, subpath, items);
    ImportHistory.push({
      name: folderName + "（文件夹）",
      time: new Date().toLocaleTimeString(),
      isYsm: false,
    });
    refreshRepo();
    toast("✅ 已整组导入: " + folderName, "success", 2500);
  } catch (e) {
    const msg = String(e);
    if (msg.includes("FILE_EXISTS") || msg.includes("目标已存在")) {
      toast(`❌ ${folderName} 已存在，请重命名文件夹后再导入`, "error", 4000);
    } else {
      toast("❌ 整组导入失败: " + msg, "error", 4000);
    }
  }
};

/**
 * 执行一组拖拽收集的条目（静默导入入口）：
 * 文件夹 → 整组（组内至少 1 个支持文件）；散落单文件 → 直导。
 * 与导入页 routeCollected 语义一致；全局调用不依赖导入 tab 挂载。
 */
export const executeCollected = async (
  collected: CollectedEntry[],
): Promise<{ folders: number; singles: number }> => {
  const { folders, singles } = groupCollected(collected);
  for (const g of folders) {
    await importFolder(g.dir, g.files);
  }
  for (const c of singles) {
    await directImport(c.file);
  }
  return { folders: folders.length, singles: singles.length };
};

/** 是否可作为独立文件导入（供外部过滤，dnd-shared 透传） */
export { isImportableFile };
