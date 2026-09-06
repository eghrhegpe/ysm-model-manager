// ===== 可导入文件判定（纯函数叶子，utils 层）=====
// 原生在 features/dnd/shared.ts；backend/web-fs-auth（FSA 扫描过滤）也要用同一口径，
// 为避免 backend → features 反向依赖（backend 是胶水层，只许向下），下沉至此，
// features/dnd/shared.ts re-export 兼容下游。

import { ALL_EXTS } from "./extensions.ts";

export const getExt = (name: string): string => `.${(name.split(".").pop() || "").toLowerCase()}`;

/** 扩展名是否在支持列表 */
export const isSupportedFile = (name: string): boolean => ALL_EXTS.includes(getExt(name));

/** 是否可作为独立文件导入：.json 仅放行 ysm.json 入口清单
 *  包内 geometry/animation/语言 json（main.json / *.animation.json / zh_cn.json 等）不得单独导入
 *  与 go/scanner/scanner.go:80-87 的 ysm.json 白名单对齐（base name 级判断，任意子目录均适用） */
export const isImportableFile = (name: string): boolean => {
  if (getExt(name) === ".json") return name.toLowerCase() === "ysm.json";
  return isSupportedFile(name);
};
