// ===== 可导入文件判定（纯函数叶子，utils 层）=====
// 原生在 features/dnd/shared.ts；backend/web-fs-auth（FSA 扫描过滤）也要用同一口径，
// 为避免 backend → features 反向依赖（backend 是胶水层，只许向下），下沉至此，
// backend/web-fs-auth 与 features/dnd/shared.ts（内部依赖，不再 re-export）直引本文件。

import { ALL_EXTS } from "./extensions.ts";
import { extOf } from "./types.ts";

// 统一扩展名提取口径（extOf：含点小写，无扩展名返回空串——消除与 types.ts/icon.ts 的三重复）
export const getExt = (name: string): string => extOf(name);

/**
 * 扩展名是否在支持列表
 * @param name 文件名（含扩展名）
 * @returns 扩展名受支持时返回 true
 */
export const isSupportedFile = (name: string): boolean => ALL_EXTS.includes(getExt(name));

/**
 * 是否可作为独立文件导入：.json 仅放行 ysm.json 入口清单
 * 包内 geometry/animation/语言 json（main.json / *.animation.json / zh_cn.json 等）不得单独导入
 * 与 go/scanner/scanner.go:80-87 的 ysm.json 白名单对齐（base name 级判断，任意子目录均适用）
 * @param name 文件名（含扩展名）
 * @returns 文件可独立导入时返回 true
 */
export const isImportableFile = (name: string): boolean => {
  if (getExt(name) === ".json") {
    // base name 级判断：路径含点（如 /path/to/file.backup/ysm.json）仍应命中白名单
    const base = name.split(/[/\\]/).pop() || name;
    return base.toLowerCase() === "ysm.json";
  }
  return isSupportedFile(name);
};
