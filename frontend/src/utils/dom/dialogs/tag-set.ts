// ===== 标签集合操作（纯函数层）=====
// 从 utils/dom/dialogs/tag-editor.ts 的 addTag 抽出：去重 / 长度限制 / 排序，
// 供单测覆盖（ADR-023 L3）。

export interface TagSetResult {
  tags: string[];
  error: string | null;
}

/** 标签最大长度（与原 addTag 一致） */
export const MAX_TAG_LENGTH = 20;

/**
 * 向标签集合添加一个标签（已 trim）：
 * 空输入 → 原样返回；重复 → error「标签已存在」；超长 → error「最多 20 个字符」；
 * 合法 → 排序后返回新数组。错误文案与 tag-editor 弹窗展示一致。
 */
export function addTagToSet(tags: string[], raw: string): TagSetResult {
  const t = raw.trim();
  if (!t) return { tags, error: null };
  if (tags.includes(t)) return { tags, error: "⚠️ 标签已存在" };
  if (t.length > MAX_TAG_LENGTH)
    return { tags, error: "⚠️ 标签最多 20 个字符" };
  return { tags: [...tags, t].sort(), error: null };
}
