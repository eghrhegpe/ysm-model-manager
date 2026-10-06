// ===== 标签编辑弹窗 — DOM 模板层（ADR-190 D1a 先例：DOM 模板归 views，组合根注入；
// ADR-208 D2 收口：自 features/dialogs/tag-editor.ts 内嵌模板外抽，消 R8 html-literal 基线边）=====
// 唯一消费者 = features 组合根注入（views/app-content/index.ts 经 injectFileDialogDeps
// 注入本模块的 tagEditorTpl，最终落到 modalTagEditor 的 opts.tpl）；模板只吃纯数据
// （字符串数组 / modelPath，无 DOM/内部结构），features 不自渲染。
// 先例：tpl-batch-rename.ts / tpl-adv-filter.ts / tpl-rename.ts。

import { t } from "@/core/i18n/t.ts";
import type { TagEditorTpl } from "@/features/dialogs/tag-editor.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

/** 已选标签 chips HTML */
function buildTagsHTML(tags: string[]): string {
  return tags
    .map(
      (tag) =>
        '<span class="te-tag">' +
        esc(tag) +
        '<button class="te-tag-del" data-tag="' +
        esc(tag) +
        '">' +
        UI_ICONS.close + // ADR-238 §1.4：结构槽图标位走 SVG（原字面 glyph "✕"）
        "</button>" +
        "</span>",
    )
    .join("");
}

/** 建议区（未使用标签）HTML */
function buildSuggestionsHTML(allTags: string[], current: string[]): string {
  const unused = allTags.filter((tag) => !current.includes(tag));
  return unused.length
    ? unused
        .map((tag) => `<button class="te-sug-btn" data-tag="${esc(tag)}">+${esc(tag)}</button>`)
        .join("")
    : `<span class="te-suggest-empty">${t("dialog.noOtherTags")}</span>`;
}

/** 弹窗内容区 HTML（标题行由 createDialog 统一渲染 — ADR-190 D3；样式全部走 components.css） */
function buildBoxHTML(modelPath: string): string {
  return `
    <div class="te-path">${esc(modelPath)}</div>

    <div id="te-tags" class="te-tags"></div>

    <div class="te-input-row">
      <input id="te-input" class="te-input" maxlength="20" placeholder="${t("dialog.tagInputHint")}">
      <button id="te-add" class="dlg-btn dlg-btn-primary te-add-btn">+ ${t("dialog.add")}</button>
    </div>

    <details class="te-suggest-details">
      <summary class="te-suggest-summary">${UI_ICONS.tag} ${t("dialog.existingTags")}</summary>
      <div id="te-suggest" class="te-suggest-wrap"></div>
    </details>

    <div id="te-err" class="dlg-err"></div>

    <div class="dlg-footer te-footer">
      <button id="te-cancel" class="dlg-btn">${t("common.cancel")}</button>
      <button id="te-save" class="dlg-btn dlg-btn-primary">${UI_ICONS.save} ${t("common.save")}</button>
    </div>
  `;
}

/** 组合根注入对象（views/app-content/index.ts 传给 modalTagEditor 的 opts.tpl） */
export const tagEditorTpl: TagEditorTpl = {
  boxHTML: buildBoxHTML,
  tagsHTML: buildTagsHTML,
  suggestionsHTML: buildSuggestionsHTML,
};
