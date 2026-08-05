// ===== DnD 导入共享逻辑（import-queue 与 handler-dnd 共用，消除重复）=====
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { ALL_EXTS } from "../utils/resource/extensions.ts";
import { getApp } from "../wails/app.ts";

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

/** 判断文件是否需要进入命名表单（异步） */
export const shouldEnterForm = async (
  name: string,
  base64: string,
): Promise<boolean> => {
  const ext = getExt(name);
  if (ext === ".ysm") return true;
  if (ext === ".json" && name.toLowerCase() === "ysm.json") return true;
  if (ext === ".zip" || ext === ".7z") {
    try {
      const { DetectZipType } = await getApp();
      return (await DetectZipType(base64)) === RESOURCE_TYPES.YSM;
    } catch {
      return false;
    }
  }
  return false;
};

/** 获取小写扩展名（含点，如 ".ysm"） */
export { getExt };