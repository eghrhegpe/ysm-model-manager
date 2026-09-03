// ===== 批量重命名纯函数层 =====
// 从 utils/dom/dialogs/batch-rename.ts 抽出：解析名重建 + 查找替换，供单测覆盖（ADR-023 L3）。
// 与单个重命名对话框（rename-format.ts）语义差异：
// 批量重建空段跳过（无缺省「未知」/「?」），并保留禁用尾缀与「角色名回退到文件名」。
import type { ParsedModelName } from "../../utils/dom/display.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { buildModelName } from "./rename-format.ts";

/**
 * 按 YSM 命名规范重建文件名：`[作者]【作品】角色 (日期).ext(.disabled)`
 * - 作者/作品空值跳过；角色缺省回退到「剥禁用尾缀与扩展名后的文件名」；
 * - 扩展名取原名（缺省 ysm）；banned 文件保留 `.disabled` 尾缀。
 * 调用方负责比较 newName !== name 判定 changed。
 * 拼接收敛至 rename-format 的 buildModelName 引擎（索引 4.9：空段跳过 + keepBan）。
 */
export function rebuildParsedName(
  name: string,
  p: ParsedModelName,
  overrides?: { author?: string; work?: string },
): string {
  const isBan = /\.(disabled|ban)$/i.test(name);
  const clean = name.replace(/\.(disabled|ban)$/i, "");
  const a = overrides?.author || p.author;
  const w = overrides?.work || p.work;
  const c = p.chara || clean.replace(/\.\w+$/, "");
  const d = p.date || "";
  const ext = clean.match(/\.(\w+)$/)?.[1] || RESOURCE_TYPES.YSM;
  return buildModelName({ author: a, work: w, chara: c, date: d }, ext, { keepBan: isBan });
}

export interface ReplaceResult {
  newName: string;
  ok: boolean;
}

/**
 * 查找替换：分离扩展名，仅对文件名主体做替换。
 * - 空查找串：返回原样（ok=true，调用方已在入口守卫）；
 * - 正则无效：返回原样且 ok=false（调用方提示用户保持原名）。
 */
export function applyReplaceToName(
  name: string,
  findText: string,
  replaceText: string,
  isRegex: boolean,
): ReplaceResult {
  if (!findText) return { newName: name, ok: true };
  const extMatch = name.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : "";
  const body = extMatch ? name.slice(0, -ext.length) : name;
  let newBody: string;
  try {
    newBody = isRegex
      ? body.replace(new RegExp(findText, "g"), replaceText)
      : body.replaceAll(findText, replaceText);
  } catch {
    return { newName: name, ok: false };
  }
  return { newName: (newBody || body) + ext, ok: true };
}
