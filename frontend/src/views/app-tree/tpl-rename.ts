// ===== 重命名弹窗 — DOM 模板层（ADR-190 D1a 先例：DOM 模板归 views，组合根注入；
// ADR-208 D2 收口：自 features/dialogs/rename.ts 内嵌模板外抽，消 R8 html-literal 基线边）=====
// 唯一消费者 = features 组合根注入（views/app-content/index.ts 经 injectFileDialogDeps
// 注入本模块的 renameTpl，最终落到 showRenameDialog 的 opts.tpl）；模板只吃纯数据
// （ParsedModelName + currentName，无 DOM/内部结构），features 不自渲染。
// 先例：tpl-batch-rename.ts / tpl-adv-filter.ts。

import { t } from "@/core/i18n/t.ts";
import type { RenameTpl } from "@/features/dialogs/rename.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { ParsedModelName } from "@/utils/model-name/display.ts";

/** 内容区 HTML（标题行由 createDialog 统一渲染 — ADR-190 D3，此处只管内容区） */
function buildBoxHTML(parsed: ParsedModelName, currentName: string): string {
  return `
      <div class="dlg-sub">${esc(currentName)}</div>
      <div class="dlg-row">
        <input id="rn-author" class="dlg-input-bg" style="flex:2" placeholder="${t("import.author")}" value="${esc(parsed.author)}">
        <input id="rn-work" class="dlg-input-bg" style="flex:2" placeholder="${t("import.brand")}" value="${esc(parsed.work === "未知" ? "" : parsed.work)}">
        <input id="rn-chara" class="dlg-input-bg" style="flex:2" placeholder="${t("dialog.chara")}" value="${esc(parsed.chara)}">
        <input id="rn-variant" class="dlg-input-bg" style="flex:1;min-width:50px" placeholder="${t("import.variant")}">
        <input id="rn-date" class="dlg-input-bg" style="flex:1;min-width:50px" placeholder="${t("import.date")}" value="${esc(parsed.date)}">
      </div>
      <div id="rn-tips" class="dlg-tips"></div>
      <div class="dlg-preview-box">
        <span class="dlg-preview-old">${esc(currentName)}</span> → <span id="rn-preview" class="dlg-preview-new">-</span>
      </div>
      <div class="dlg-footer" style="margin-top:2px">
        <button id="rn-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
        <button id="rn-ok" class="dlg-btn dlg-btn-primary">${UI_ICONS.edit} ${t("dialog.renameEnter")}</button>
      </div>
      <div id="rn-err" class="dlg-err"></div>
    `;
}

/** 组合根注入对象（views/app-content/index.ts 传给 showRenameDialog 的 opts.tpl） */
export const renameTpl: RenameTpl = {
  boxHTML: buildBoxHTML,
};
