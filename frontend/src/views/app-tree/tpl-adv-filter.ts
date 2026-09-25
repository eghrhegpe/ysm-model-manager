// ===== 高级筛选弹窗 — DOM 模板层（ADR-190 D1a：DOM 模板归 views，组合根注入；
// R8 销账：自 features/dialogs/adv-filter.ts 内嵌模板外抽，2026-09-24）=====
// 唯一消费者 = views/app-tree/toolbar-search.ts 经 modalAdvFilter 注入本模块的 advFilterTpl；
// 模板只吃纯数据（Partial<AdvFilterValue>，无 DOM/内部结构），features 不自渲染。
// 先例：tpl-batch-rename.ts。

import { t } from "@/core/i18n/t.ts";
import type { AdvFilterTpl, AdvFilterValue } from "@/features/dialogs/adv-filter.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

/** 渲染弹窗表单 HTML（纯函数，无 DOM 副作用；标题行由 createDialog 统一渲染 — ADR-190 D3；样式全部走 components.css） */
function buildAdvFilterFormHTML(v: Partial<AdvFilterValue>): string {
  return `
      <div class="afv-form">
        <div>
          <label for="afv-kw" class="afv-label">${UI_ICONS.search} ${t("dialog.keyword")}</label>
          <input id="afv-kw" class="afv-input-kw" maxlength="100" value="${esc(v.keyword || "")}" placeholder="${t("dialog.matchAll")}">
        </div>

        <div class="afv-grid">
          <div>
            <label for="afv-minBones" class="afv-label">${UI_ICONS.bone} ${t("dialog.bones")}</label>
            <div class="afv-range-row">
              <input id="afv-minBones" type="number" min="0" value="${esc(String(v.minBones ?? ""))}" placeholder="${t("dialog.min")}" class="afv-inp">
              <span class="afv-sep">—</span>
              <input id="afv-maxBones" type="number" min="0" value="${esc(String(v.maxBones ?? ""))}" placeholder="${t("dialog.max")}" aria-label="${t("dialog.bones")} ${t("dialog.max")}" class="afv-inp">
            </div>
          </div>
          <div>
            <label for="afv-minCubes" class="afv-label">${UI_ICONS.voxel} ${t("dialog.cubes")}</label>
            <div class="afv-range-row">
              <input id="afv-minCubes" type="number" min="0" value="${esc(String(v.minCubes ?? ""))}" placeholder="${t("dialog.min")}" class="afv-inp">
              <span class="afv-sep">—</span>
              <input id="afv-maxCubes" type="number" min="0" value="${esc(String(v.maxCubes ?? ""))}" placeholder="${t("dialog.max")}" aria-label="${t("dialog.cubes")} ${t("dialog.max")}" class="afv-inp">
            </div>
          </div>
        </div>

        <div>
          <label for="afv-minTex" class="afv-label">${UI_ICONS.image} ${t("dialog.textureSize")}</label>
          <div class="afv-range-row">
            <input id="afv-minTex" type="number" min="0" value="${esc(String(v.minTex ?? ""))}" placeholder="${t("dialog.min")}" class="afv-inp">
            <span class="afv-sep">—</span>
            <input id="afv-maxTex" type="number" min="0" value="${esc(String(v.maxTex ?? ""))}" placeholder="${t("dialog.max")}" aria-label="${t("dialog.textureSize")} ${t("dialog.max")}" class="afv-inp">
          </div>
        </div>

        <div>
          <label for="afv-tag" class="afv-label">${UI_ICONS.tag} ${t("dialog.tags")}</label>
          <div class="afv-range-row">
            <input id="afv-tag" maxlength="30" value="${esc(v.tag || "")}" placeholder="${t("dialog.tagPlaceholder")}" class="afv-inp">
            <span id="afv-tag-hint" class="afv-tag-hint"></span>
          </div>
        </div>
      </div>

      <div id="afv-err" class="dlg-err"></div>

      <div class="dlg-footer afv-footer">
        <button id="afv-clear" class="dlg-btn afv-clear">${UI_ICONS.clean} ${t("dialog.clearAll")}</button>
        <button id="afv-cancel" class="dlg-btn">${t("dialog.cancelEsc")}</button>
        <button id="afv-ok" class="dlg-btn dlg-btn-primary">${UI_ICONS.search} ${t("dialog.applyEnter")}</button>
      </div>
    `;
}

/** 组合根注入对象（views/app-tree/toolbar-search.ts 传给 modalAdvFilter） */
export const advFilterTpl: AdvFilterTpl = {
  formHTML: buildAdvFilterFormHTML,
};
