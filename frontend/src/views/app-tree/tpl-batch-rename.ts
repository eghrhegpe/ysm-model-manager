// ===== 批量重命名弹窗 — DOM 模板层（ADR-190 D1a 先例：DOM 模板归 views，组合根注入；
// ADR-208 D2 收口：自 features/dialogs/batch-rename.ts 内嵌模板外抽）=====
// 唯一消费者 = features 组合根调用（views/app-tree/bus-handlers.ts 经 showBatchRenameDialog
// 注入本模块的 batchRenameTpl）；模板只吃纯数据（BrRowView 由 features 定义，无 DOM/内部结构），
// features 不自渲染。

import { t } from "@/core/i18n/t.ts";
import type { BatchRenameTpl, BrRowView } from "@/features/dialogs/batch-rename.ts";
import { stagger } from "@/utils/animation/stagger.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

/** 批量重命名弹窗主表单（header + 模式切换 + parse/replace 分区 + footer） */
function buildFormHTML(dir: string, total: number, changed: number): string {
  return `<div class="dlg-box">
<div class="dlg-header">
  <span class="dlg-header-title">${UI_ICONS.note} ${t("dialog.batchRenameTitle")}</span>
  <span class="dlg-header-path">${esc(dir)}</span>
  <span class="dlg-header-count">${total} ${t("dialog.filesUnit")} · <span id="br-changed">${changed}</span> ${t("dialog.changesUnit")}</span>
</div>
<div class="dlg-section">
  <span class="dlg-section-label">${t("dialog.pattern")}：</span>
  <select id="br-mode" class="dlg-input">
    <option value="parse">${t("dialog.parseFormat")}</option>
    <option value="replace">${t("dialog.findReplace")}</option>
  </select>
</div>
<div id="br-parse-mode" class="dlg-section">
  <span class="dlg-section-label">${t("dialog.author")}：</span>
  <input id="br-batch-author" class="dlg-input-sm" placeholder="${t("dialog.keepEmpty")}">
  <span class="dlg-section-label">${t("dialog.work")}：</span>
  <input id="br-batch-work" class="dlg-input-sm" placeholder="${t("dialog.keepEmpty")}">
  <span class="dlg-header-count" style="font-size:var(--fs-micro)">${t("dialog.enterToApply")}</span>
</div>
<div id="br-replace-mode" class="dlg-section" style="display:none">
  <span class="dlg-section-label">${t("dialog.find")}：</span>
  <input id="br-find" class="dlg-input-flex" placeholder="${t("dialog.findPlaceholder")}">
  <span class="dlg-section-label">${t("dialog.replace")}：</span>
  <input id="br-replace" class="dlg-input-flex" placeholder="${t("dialog.replaceEmptyDelete")}">
  <label class="dlg-label-check">
    <input type="checkbox" id="br-regex"> ${t("dialog.regex")}
  </label>
  <button id="br-presets" class="dlg-btn-accent">${UI_ICONS.clipboard} ${t("dialog.presets")}</button>
  <div id="br-presets-menu" class="dlg-presets-menu">
    <div class="br-preset dlg-preset-chip" data-find="(\\d{4}-\\d{2})" data-replace="" data-regex="1">${UI_ICONS.cut} ${t("dialog.presetRemoveYear")}</div>
    <div class="br-preset dlg-preset-chip" data-find="-v\\d+(?=.)" data-replace="" data-regex="1">${UI_ICONS.cut} ${t("dialog.presetRemoveVersion")}</div>
    <div class="br-preset dlg-preset-chip" data-find="【(.+?)】" data-replace="[$1]" data-regex="1">${t("dialog.presetBrackets")}</div>
    <div class="br-preset dlg-preset-chip" data-find="[(.+?)]【(.+?)】" data-replace="$1-$2" data-regex="1">${UI_ICONS.tools} ${t("dialog.presetFlatten")}</div>
    <div class="br-preset dlg-preset-chip" data-find="\\s+" data-replace="_" data-regex="1">${UI_ICONS.edit} ${t("dialog.presetSpaceUnderscore")}</div>
  </div>
</div>
<div id="br-preview" class="dlg-preview"></div>
<div class="dlg-footer">
  <button id="br-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
  <button id="br-apply" class="dlg-btn dlg-btn-primary">${UI_ICONS.success} ${t("dialog.applyRenameEnter")}</button>
</div>
</div>`;
}

/** 预览区模板（全选 header + 行；入场动画 stagger 随模板走） */
function buildPreviewHTML(rows: BrRowView[]): string {
  return (
    `<div class="br-header">
  <label style="display:flex;align-items:center;gap:3px;cursor:pointer">
    <input type="checkbox" id="br-select-all" checked class="br-cb"> ${t("dialog.selectAll")}
  </label>
  <span style="flex:1;text-align:center">${t("dialog.oldName")}</span>
  <span class="br-spacer"></span>
  <span style="flex:1;text-align:center">${t("dialog.newName")}</span>
</div>` +
    rows
      .map(
        (r, i) =>
          `<div class="br-row" style="animation-delay:${stagger(i, 15, 300)}ms">
  <input type="checkbox" class="br-file-cb br-cb" data-ci="${i}" aria-label="${esc(r.name)}" ${r.selected ? "checked" : ""}>
  ${
    r.selected && r.changed
      ? `<span class="br-name br-name-old" title="${esc(r.name)}">${esc(r.name)}</span>
  <span class="br-arrow">${UI_ICONS.chevronRight}</span>
  <span class="br-name br-name-new" title="${esc(r.newName)}">${esc(r.newName)}</span>`
      : `<span class="br-name-plain" style="opacity:${r.selected ? 1 : 0.5}">${esc(r.name)}</span>`
  }
</div>`,
      )
      .join("")
  );
}

/** 组合根注入对象（views/app-tree/bus-handlers.ts 传给 showBatchRenameDialog） */
export const batchRenameTpl: BatchRenameTpl = {
  formHTML: buildFormHTML,
  previewHTML: buildPreviewHTML,
};
