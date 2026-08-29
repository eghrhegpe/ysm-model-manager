// ===== HTML 模板（页面布局级，不含节点行） =====

import { t } from "../../core/i18n/t.ts";

export function headerHTML(): string {
  return `<div class="hdr">
<div class="hdr-row hdr-search-row">
  <input class="srch-inp" id="srch" data-testid="tree-srch" type="text" placeholder="${t("tree.searchPlaceholder")}" autocomplete="off">
</div>
<div class="hdr-row hdr-btn-row">
  <button class="btn-base sm" id="btn-adv-filter" data-testid="tree-adv-filter" title="${t("dialog.advFilter")}">${t("tree.filter")}</button>
  <div class="dd-wrap" id="dd-authors"><button class="btn-base sm" id="btn-authors" data-testid="tree-authors">${t("tree.authors")}</button><div class="dd-menu" id="menu-authors"></div></div>
  <div class="dd-wrap" id="dd-batch"><button class="btn-base sm" id="btn-batch" data-testid="tree-batch">${t("tree.batch")}</button><div class="dd-menu" id="menu-batch"><button class="dd-item" data-batch="enable-all" data-testid="tree-batch-enable">${t("tree.batchEnableAll")}</button><button class="dd-item" data-batch="disable-all" data-testid="tree-batch-disable"> ${t("tree.batchDisableAll")}</button></div></div>
  <button class="btn-base sm" id="sel-all" data-testid="tree-sel-all" title="${t("tree.selectAll")}">${t("tree.selectAll")}</button>
  <div class="dd-wrap" id="dd-more"><button class="btn-base sm" id="btn-more" data-testid="tree-more">${t("tree.more")}</button><div class="dd-menu" id="menu-more"><button class="dd-item" data-more="import-file" data-testid="tree-more-import-file">📄 ${t("tree.moreImportFile")}</button><button class="dd-item" data-more="import-dir" data-testid="tree-more-import-dir">${t("tree.moreImportDir")}</button><div style="border-top:1px solid var(--bd);margin:2px 0"></div><button class="dd-item" data-more="open-folder" data-testid="tree-more-open-folder">${t("tree.moreOpenFolder")}</button><button class="dd-item" data-more="refresh" data-testid="tree-more-refresh">${t("tree.moreRefresh")}</button><button class="dd-item" data-more="genindex" data-testid="tree-more-genindex">${t("tree.moreGenIndex")}</button></div></div>
  <select class="sort-sel" id="sort" data-testid="tree-sort"><option value="name">${t("tree.sortName")}</option><option value="size">${t("tree.sortSize")}</option><option value="date">${t("tree.sortDate")}</option></select>
  <button class="btn-base sm" id="btn-view-mode" data-testid="tree-view-mode" title="${t("tree.toggleView")}">☰</button>
</div>
<div class="adv-filter" id="adv-filter" style="display:none">
  <div class="adv-filter-row">
    <label>${t("dialog.bones")}</label><input type="number" id="af-minBones" data-testid="tree-af-min-bones" placeholder="${t("dialog.min")}" class="af-inp" min="0"><span class="af-sep">—</span><input type="number" id="af-maxBones" data-testid="tree-af-max-bones" placeholder="${t("dialog.max")}" class="af-inp" min="0">
    <label>${t("dialog.cubes")}</label><input type="number" id="af-minCubes" data-testid="tree-af-min-cubes" placeholder="${t("dialog.min")}" class="af-inp" min="0"><span class="af-sep">—</span><input type="number" id="af-maxCubes" data-testid="tree-af-max-cubes" placeholder="${t("dialog.max")}" class="af-inp" min="0">
    <label>${t("tree.afTex")}</label><input type="number" id="af-minTex" data-testid="tree-af-min-tex" placeholder="${t("dialog.min")}" class="af-inp" min="0"><span class="af-sep">—</span><input type="number" id="af-maxTex" data-testid="tree-af-max-tex" placeholder="${t("dialog.max")}" class="af-inp" min="0">
    <button class="btn-base sm" id="af-clear" data-testid="tree-af-clear" title="${t("tree.advFilterClearTip")}">${t("tree.advFilterClear")}</button>
  </div>
</div>
</div>`;
}

export function footerHTML(): string {
  return `<div class="ftr">
<span class="stat" id="ftr-stat" data-testid="tree-ftr-stat">${t("tree.statInitial")}</span>
<div style="flex:1"></div>
<button class="btn-base sm" id="btn-repo" data-testid="tree-repo" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t("tree.repoConfigTitle")}">${t("tree.repoNotSet")}</button>
</div>`;
}

export function emptyHTML(icon: string, msg: string): string {
  return `<div class="empty"><div class="big">${icon}</div>${msg}</div>`;
}

export function spinnerHTML(): string {
  return t("tree.scanning");
}
