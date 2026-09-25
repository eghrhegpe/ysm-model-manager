// ===== 创意工坊/GitHub 仓库模型页 — DOM 模板层（ADR-190 D1a：DOM 模板归 views，组合根注入；
// R8 销账：自 features/community/render.ts 内嵌 renderRepoHeaderHTML 外抽，2026-09-25）=====
// 两个消费者：
//   1. 工坊页 features/community/show-repo-models.ts 经 RepoTpl 注入（组合根 init-workshop.ts）；
//   2. GitHub 页 init-github.ts 本属 views，直接消费本模块。
// 模板只吃纯数据（RepoHeaderData，source/mirror 为字符串枚举，无 DOM/内部结构）。
// 先例：tpl-adv-filter.ts / tpl-batch-rename.ts。

import { t } from "@/core/i18n/t.ts";
import type { RepoHeaderData, RepoTpl } from "@/features/community/render.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { ICONS } from "@/utils/icon/workshop-icons.ts";

/**
 * 数据源 + 镜像徽章（纯展示派生，原两份手抄三元链——show-repo-models / init-github——
 * 收口于此）。source/mirror 均为内部枚举串，不含用户数据；图标走 SVG
 * （ADR-238：⚡→performance、🐙→github，映射据 scripts/_lib/icon-map.ts）。
 */
function sourceBadges(source: string, mirror: string): string {
  const sourceBadge =
    source === "raw"
      ? '<span class="link-badge link-badge-raw">raw</span>'
      : source === "jsd"
        ? `<span class="link-badge link-badge-jsd">${UI_ICONS.performance}jsd</span>`
        : source === "api"
          ? '<span class="link-badge link-badge-api">API</span>'
          : "";
  const mirrorBadge =
    mirror === "jsdelivr"
      ? `<span class="link-badge link-badge-cdn">${UI_ICONS.performance}CDN</span>`
      : mirror === "githubapi"
        ? `<span class="link-badge link-badge-ghapi">${UI_ICONS.github}API</span>`
        : "";
  return sourceBadge + mirrorBadge;
}

/** 仓库模型页头部（返回按钮、计数徽章、仓库名+来源、搜索、操作区、列表挂载点） */
function repoHeaderHTML(d: RepoHeaderData): string {
  const { repo, source, mirror, modelsLength, missingCount } = d;
  return (
    '<div class="gh-header">' +
    // 行1: 返回 | 模型计数徽章
    '<div class="gh-header-top">' +
    '<button class="btn-base sm gh-back-repo" data-testid="gh-back">' +
    UI_ICONS.back +
    " " +
    t("common.back") +
    "</button>" +
    '<span class="gh-section-fill"></span>' +
    '<span class="gh-model-badge gh-model-badge-total">' +
    t("gh.modelCount", { n: modelsLength }) +
    "</span>" +
    (missingCount > 0
      ? `<span class="gh-model-badge gh-model-badge-missing">${UI_ICONS.download} ${missingCount}</span>`
      : "") +
    "</div>" +
    // 行2: 仓库名（独占）+ 来源/镜像徽章
    '<div class="gh-header-repo">' +
    '<span class="gh-repo-name">' +
    ICONS.PACKAGE +
    " " +
    esc(repo) +
    "</span>" +
    sourceBadges(source, mirror) +
    "</div>" +
    // 行3: 搜索（placeholder 为纯文本提示——emoji 装饰跨平台渲染不一致，且是 ADR-238 债，不塞）
    '<div class="gh-search-wrap">' +
    '<input id="gh-repo-srch" class="gh-search" type="text" data-testid="gh-srch" placeholder="' +
    t("gh.searchPlaceholder") +
    '">' +
    "</div>" +
    // 行4: 操作按钮
    '<div class="gh-header-actions">' +
    '<label class="btn-base sm gh-select-all" data-testid="gh-select-all"><input type="checkbox"> ' +
    UI_ICONS.checkbox +
    " " +
    t("common.selectAll") +
    "</label>" +
    '<button class="btn-base sm gh-toggle-missing" data-testid="gh-toggle">' +
    UI_ICONS.folder +
    " " +
    t("gh.showMissingOnly") +
    "</button>" +
    '<span class="gh-section-fill"></span>' +
    '<button class="btn-base sm gh-dl-selected" data-testid="gh-dl-selected" disabled>' +
    UI_ICONS.download +
    " " +
    t("gh.downloadSelected", { n: 0 }) +
    "</button>" +
    "</div>" +
    '<div id="gh-queue-status" class="gh-queue-status" data-testid="download-queue"></div>' +
    '<div id="gh-repo-list" data-testid="gh-list"></div>' +
    "</div>"
  );
}

/** 组合根注入对象（init-workshop.ts 传给 showRepoModels；init-github.ts 直接消费） */
export const workshopTpl: RepoTpl = {
  repoHeaderHTML,
};
