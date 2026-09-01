// ===== web-fs 共享原语：IDB key 规约 + 主文件优先级 =====
// 从 web-fs.ts 拆出的叶子模块（ADR-040 职责切分延续）：web-fs-import.ts（写组用
// dirKey/fileKey/mainFileRank）、web-fs-auth.ts（FSA 递归收集用 mainFileRank）与
// web-fs.ts 主文件（scan/rename/rekey 用同款）三方共用——立此叶子断
// auth → import → web-fs 主文件 的值级循环依赖。
import { RESOURCE_EXTS } from "../utils/resource/extensions.ts";

// --- key 规约（对齐 MikuMikuAR ADR-177：dir:*: / file:*: 前缀）---
export const dirKey = (type: string, name: string): string => `dir:${type}/${name}:`;
export const fileKey = (type: string, name: string, rel: string): string =>
  `file:${type}/${name}/${rel}`;

// --- 主文件优先级（scanWebModels / importWebFiles 共用）---
// ADR-066 识别层对齐 Go scanner：主文件判定注册表驱动——每类型注册表扩展名都是
// 该类型主文件；.json 仅 ysm.json（IsYsmEntryJSON 口径）；.ysm/.zip 为 YSM 主文件
// （多文件模型竞争时优先）。原实现只认 .ysm/.zip/ysm.json，蓝图/投影/MMD/VRC
// 的 .nbt/.schematic/.litematic/.pmx/.pmd/.vrca/.vrm 全被归为辅助文件不显示。
export const MAIN_FILE_RANK_YSM = 3;
export const MAIN_FILE_RANK_JSON = 2;
export const MAIN_FILE_RANK_TYPE = 1; // 其他类型主文件（注册表扩展名，.json 除外）
export const MAIN_FILE_RANK_NONE = 0;

/** 注册表主文件扩展名集合（全类型，.json 除外——仅 ysm.json 是主文件） */
const TYPE_MAIN_EXTS: Set<string> = (() => {
  const s = new Set<string>();
  for (const exts of Object.values(RESOURCE_EXTS)) {
    for (const e of exts) {
      if (e !== ".json") s.add(e.toLowerCase());
    }
  }
  return s;
})();

/** 主文件优先级打分（注册表驱动：YSM .ysm/.zip > ysm.json > 其他类型主文件 > 辅助文件）。
 * 不剥 .ban/.disabled——禁用模型在导入层即被拒（与 Go 导入层拒绝 .ban 一致）。 */
export function mainFileRank(rel: string): number {
  const low = rel.toLowerCase();
  const dot = low.lastIndexOf(".");
  const ext = dot > 0 ? low.slice(dot) : "";
  if (ext === ".json") return low === "ysm.json" ? MAIN_FILE_RANK_JSON : MAIN_FILE_RANK_NONE;
  if (ext === ".ysm" || ext === ".zip") return MAIN_FILE_RANK_YSM;
  if (TYPE_MAIN_EXTS.has(ext)) return MAIN_FILE_RANK_TYPE;
  return MAIN_FILE_RANK_NONE;
}
