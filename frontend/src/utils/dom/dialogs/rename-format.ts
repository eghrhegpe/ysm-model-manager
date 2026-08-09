// ===== 重命名文件名构建 + 字段校验（纯函数层）=====
// 从 utils/dom/dialogs/rename.ts 抽出：文件名拼接与校验逻辑，供单测覆盖（ADR-023 L3）。
// 原实现中拼接逻辑在 update() 预览与提交按钮里重复两份，此处收敛为单一事实来源。
import { t } from "../../../core/i18n/t.ts";

/** 重命名字段（调用方已 trim） */
export interface RenameFields {
  author: string;
  work: string;
  chara: string;
  variant: string;
  date: string;
}

/**
 * 按 YSM 命名规范拼接新文件名：`[作者]【品牌】角色-变体 (年月).ext`
 * 品牌缺省「未知」、角色缺省「?」，与预览一致。
 */
export function buildRenameName(f: RenameFields, ext: string): string {
  const parts: string[] = [];
  if (f.author) parts.push("[" + f.author + "]");
  parts.push("【" + (f.work || "未知") + "】");
  parts.push(f.chara || "?");
  if (f.variant) parts.push("-" + f.variant);
  if (f.date) parts.push(" (" + f.date + ")");
  return parts.join("") + "." + ext;
}

/** Windows 文件名非法字符（含控制字符） */
const ILLEGAL_CHARS = /[<>:"\\|?*\/\u0000-\u001f]/;

/**
 * 校验重命名字段，返回错误文案；合法返回 null。
 * 规则：作者/角色必填；任意字段含非法字符即拒绝；拼接后总长 ≤ 255。
 */
export function validateRenameFields(f: RenameFields, ext: string): string | null {
  if (!f.author || !f.chara) return "⚠️ 作者、角色名不能为空";
  const allFields = [f.author, f.work, f.chara, f.variant, f.date].filter(Boolean);
  if (allFields.some((x) => ILLEGAL_CHARS.test(x)))
    return "⚠️ " + t("dialog.fileNameIllegal");
  const newName = buildRenameName(f, ext);
  if (newName.length > 255)
    return "⚠️ " + t("dialog.fileNameTooLong");
  return null;
}
