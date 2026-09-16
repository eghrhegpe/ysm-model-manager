// ===== tpl-settings.ts — settingsHTML 页面模板（从 tpl.ts 拆出，ADR-040 P1 第2轮拆分）=====
// basic + ui 标签页在此；about + credits 已拆至 tpl-settings-about.ts

import { isViewerMode } from "@/backend/platform.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { t } from "@/core/i18n/t.ts";
import { resolveIcon } from "@/utils/icon/resolve.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { navItems } from "@/views/app-nav/nav-items.ts";
import { stgCard } from "./stg-card.ts";
import { aboutHTML, creditsHTML } from "./tpl-settings-about.ts";

// ADR-133 阶段 B/C+：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = ["set-mc-path"];

function renderStgTabs(): string {
  return `<div class="repo-tabs">
<button class="stg-tab active" data-tab="basic">${UI_ICONS.settings} ${t("settings.basic")}</button>
<button class="stg-tab" data-tab="ui">${UI_ICONS.appearance} ${t("settings.appearance")}</button>
<button class="stg-tab" data-tab="parser">${UI_ICONS.parser} ${t("settings.parser")}</button>
<button class="stg-tab" data-tab="about">${UI_ICONS.info} ${t("settings.about")}</button>
<button class="stg-tab" data-tab="credits">${UI_ICONS.thanks} ${t("settings.credits")}</button>
</div>`;
}

function renderStgBasicPaths(isViewer: boolean): string {
  const gameRootCard = isViewer
    ? ""
    : stgCard(
        UI_ICONS.game,
        t("settings.paths.gameRoot"),
        `<div class="stg-path-val" id="set-mc-path" data-testid="set-mc-path">${t("common.loading")}</div>
        <div class="stg-card-desc">${t("settings.paths.gameRootDesc")}</div>`,
        {
          header: {
            actions: `<button class="btn-base sm" id="set-mc-detect">${UI_ICONS.search} ${t("settings.paths.autoSearch")}</button>`,
          },
          delayMs: 0,
        },
      );
  const linkCard = isViewer
    ? ""
    : stgCard(
        UI_ICONS.link,
        t("settings.links.title"),
        `<select id="set-link-mode" class="stg-select" style="width:100%;margin-bottom:6px">
          <option value="copy">${UI_ICONS.clipboard} ${t("settings.links.copy")}</option>
          <option value="hardlink" selected>${UI_ICONS.link} ${t("settings.links.hardlink")} ${UI_ICONS.success}</option>
          <option value="symlink">${UI_ICONS.link} ${t("settings.links.symlink")}</option>
        </select>
        <div id="lm-hint-copy" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">${t("settings.links.copyHint")}</div>
        <div id="lm-hint-hardlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">${t("settings.links.hardlinkHint")}</div>
        <div id="lm-hint-symlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0"><span style="color:var(--status-error)">${t("settings.links.symlinkHint")}</span></div>`,
        {
          header: {
            forId: "set-link-mode",
            actions: `<button id="set-relink" class="btn-base sm">${UI_ICONS.refresh} ${t("settings.links.reapply")}</button>`,
          },
          delayMs: 60,
        },
      );
  const mirrorCard = isViewer
    ? ""
    : stgCard(
        UI_ICONS.web,
        t("settings.mirror.title"),
        `<select id="set-mirror" class="stg-select" style="width:100%;margin-bottom:6px">
          <option value="">${UI_ICONS.globe} ${t("settings.mirror.directOption")}</option>
          <option value="jsdelivr">${UI_ICONS.performance} ${t("settings.mirror.jsdelivrOption")}</option>
          <option value="githubapi">${UI_ICONS.github} GitHub API</option>
        </select>
        <div id="mirror-hint-direct" style="font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">${t("settings.mirror.directHint")}</div>
        <div id="mirror-hint-jsdelivr" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">${t("settings.mirror.jsdelivrHint")}</div>
        <div id="mirror-hint-githubapi" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:2px 0;line-height:1.5">${t("settings.mirror.githubapiHint")}</div>`,
        { header: { forId: "set-mirror" }, delayMs: 120 },
      );
  return `<div class="section-title stg-title">${UI_ICONS.settings} ${t("settings.paths.title")}</div>

<div class="stg-grid">
    ${gameRootCard}
    ${linkCard}
    ${mirrorCard}
  </div>`;
}

function renderStgStorageCard(isWebViewer: boolean): string {
  return isWebViewer
    ? stgCard(
        UI_ICONS.folder,
        t("settings.webRepo.title"),
        `<div class="stg-card-desc">${t("settings.webRepo.desc")}</div>
     <button class="btn-base sm" id="web-repo-auth-btn" style="margin-top:8px;font-size:var(--fs-sm);padding:4px 12px">${UI_ICONS.folderOpen} ${t("settings.webRepo.authorize")}</button>
     <div id="web-repo-auth-status" style="font-size:var(--fs-xs);color:var(--muted);margin-top:6px;line-height:1.5"></div>`,
        {
          header: { spaceBetween: false, titleSize: "base" },
          cardId: "stg-web-repo-card",
          marginTop: 8,
          delayMs: 180,
        },
      )
    : stgCard(
        UI_ICONS.folder,
        t("settings.storage.title"),
        `<div class="stg-path-val" id="set-files-root">${t("common.loading")}</div>
     <div class="stg-card-desc">${t("settings.storage.desc")}</div>
     <div id="set-advanced-panel" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)">
       <div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:6px">${t("settings.path.customHint")}</div>
       <div class="stg-grid" id="set-advanced-grid"></div>
     </div>`,
        {
          header: {
            actions: `<button class="btn-base sm" id="set-advanced-toggle" style="font-size:var(--fs-tiny);padding:2px 8px">${UI_ICONS.folderOpen} ${t("settings.storage.expand")} ▸</button>`,
          },
          cardId: "stg-files-card",
          marginTop: 8,
          delayMs: 180,
        },
      );
}

function renderStgLangSelect(): string {
  // 间距走 .stg-section 显式契约（不再内联 margin-top:12px）——
  // 该组已挂 .section-title（自带 padding-top:16px），故只需补 0；
  // 这里保留 .section-title 作为标题，不重复加 stg-section（否则叠加得 32px）。
  return `<div class="section-title stg-title">${UI_ICONS.web} ${t("settings.language")}</div>
<div class="stg-card" style="animation-delay:240ms">
  <div class="stg-card-body" style="display:flex;align-items:center;gap:8px">
    <select id="set-lang" class="stg-select" style="width:auto">
      <option value="zh-CN">简体中文</option>
      <option value="en">English</option>
      <option value="ja">日本語</option>
    </select>
    <span style="font-size:var(--fs-xs);color:var(--muted)">${t("settings.languageDesc")}</span>
  </div>
</div>`;
}

function renderStgThemePicker(): string {
  return `<!-- 主题卡片：直接展示 -->
<div class="settings-group" style="animation-delay:0ms">
  <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
    <span class="label">${UI_ICONS.appearance} ${t("settings.theme.select")}</span>
    <div class="theme-picker" id="theme-picker">
      <div class="theme-card" data-theme="warm">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#8b4513"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#a0866a"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#d4a574"></span>
        </div>
        <span style="font-size:var(--fs-xs);font-weight:600;color:#5d4037">${UI_ICONS.sun} ${t("settings.theme.warm")}</span>
      </div>
      <div class="theme-card" data-theme="sakura">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#d81b60"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#f5b8cc"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#fce4ec"></span>
        </div>
        <span style="font-size:var(--fs-xs);font-weight:600;color:#5d4037">${UI_ICONS.sakura} ${t("settings.theme.sakura")}</span>
      </div>
      <div class="theme-card" data-theme="mint">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#D5F5E3"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#A2D9CE"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#76D7C4"></span>
        </div>
        <span style="font-size:var(--fs-xs);font-weight:600;color:#2c3e3a">${UI_ICONS.mint} ${t("settings.theme.mint")}</span>
      </div>
      <div class="theme-card" data-theme="pro">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#ff8a65"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#b0bec5"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#757575"></span>
        </div>
        <span style="font-size:var(--fs-xs);font-weight:600;color:#e0e0e0">${UI_ICONS.dot} ${t("settings.theme.pro")}</span>
      </div>
      <div class="theme-card" data-theme="cyber">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#9575cd"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#66d9ef"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#f1fa8c"></span>
        </div>
        <span style="font-size:var(--fs-xs);font-weight:600;color:#e0d5f5">${UI_ICONS.moon} ${t("settings.theme.cyber")}</span>
      </div>
      <div class="theme-card" data-theme="ocean">
        <div style="display:flex;gap:2px;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:50%;background:#5c6bc0"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#7986cb"></span>
          <span style="width:8px;height:8px;border-radius:50%;background:#9fa8da"></span>
        </div>
        <span style="font-size:var(--fs-xs);font-weight:600;color:#c5d8e8">${UI_ICONS.ocean} ${t("settings.theme.ocean")}</span>
      </div>
    </div>
  </div>
</div>`;
}

function renderStgThemeAuto(): string {
  return `<!-- 自动切换：独立一栏 -->
<div class="settings-group" style="animation-delay:60ms">
  <div class="setting-row">
    <label for="theme-auto" class="label">${UI_ICONS.clock} ${t("settings.theme.autoTitle")}</label>
    <select id="theme-auto" class="stg-select" style="width:auto">
      <option value="off">${t("settings.theme.autoOff")}</option>
      <option value="system">${t("settings.theme.autoSystem")}</option>
      <option value="time">${t("settings.theme.autoTime")}</option>
    </select>
  </div>
</div>`;
}

function renderStgFontFamily(): string {
  return `<div class="section-title stg-title">${UI_ICONS.geometry} ${t("settings.font.title")}</div>

<div style="display:flex;gap:12px">
  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:60ms">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <label for="set-font-size" class="label" style="font-size:var(--fs-md);font-weight:600">${UI_ICONS.ruler} ${t("settings.fontSize")}</label>
    </div>
    <select id="set-font-size" class="stg-select" style="width:100%;margin-bottom:4px">
      <option value="small">${UI_ICONS.bullet} ${t("settings.fontSize.small")}</option>
      <option value="normal" selected>${UI_ICONS.bulletAlt} ${t("settings.fontSize.normal")}</option>
      <option value="large">${UI_ICONS.collision} ${t("settings.fontSize.large")}</option>
    </select>
    <div id="set-size-preview" style="display:flex;gap:8px;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">
      <span>${t("settings.ui.body")} <b id="sz-base" style="color:var(--txt)">12px</b></span>
      <span>${t("settings.ui.buttonGap")} <b id="sz-space" style="color:var(--txt)">5px</b></span>
      <span>${t("settings.ui.buttonHeight")} <b id="sz-btn-h" style="color:var(--txt)">23px</b></span>
    </div>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">${t("settings.fontSizeHint")}</div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:90ms">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <label for="set-display-font" class="label" style="font-size:var(--fs-md);font-weight:600">${UI_ICONS.brush} ${t("settings.font.creatorFont")}</label>
    </div>
    <select id="set-display-font" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="kaiti" selected>${UI_ICONS.brush} ${t("settings.font.kaiti")}</option>
      <option value="system">${UI_ICONS.note} ${t("settings.font.systemFont")}</option>
    </select>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">${t("settings.fontHint")}</div>
  </div>

  <div style="flex:1;background:var(--surf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:10px 14px;animation:card-in var(--tr-enter) both;animation-delay:120ms">
    <div class="setting-row" style="margin:0 0 6px;padding:4px 0">
      <label for="set-card-density" class="label" style="font-size:var(--fs-md);font-weight:600">${UI_ICONS.payment} ${t("settings.density")}</label>
    </div>
    <select id="set-card-density" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="compact" selected>${UI_ICONS.package} ${t("settings.density.compact")}</option>
      <option value="normal">${UI_ICONS.package} ${t("settings.density.normal")}</option>
    </select>
    <div class="stg-hint" style="font-size:var(--fs-sm);color:var(--muted);padding:0">${t("settings.densityHint")}</div>
  </div>
</div>`;
}

function renderStgAnimDefault(): string {
  // 开关放卡片标题行（actions，与「游戏根目录 / 自动搜索」同构），
  // body 只留说明——曾左右各写一句同义描述（信息量 1、占用 2，重复描述）。
  const animCard = stgCard(
    UI_ICONS.sparkle,
    t("settings.animation.title"),
    `<div class="stg-card-desc" style="margin-top:0">${t("settings.animation.hint")}</div>`,
    {
      header: {
        actions: `<label class="stg-label" style="gap:8px">
        <input type="checkbox" id="set-animations" checked> ${t("settings.animation.enableCheck")}
      </label>`,
      },
      cardId: "stg-anim-card",
      delayMs: 180,
    },
  );

  // 启动默认页：升格为 .stg-card（与「游戏根目录」「文件存储」「语言」同属卡片口径）——
  // 原用 .settings-group 裸行组，无卡片框、两侧 padding:0 16px 缩进，夹在一堆 .stg-card
  // 之间视觉断裂（跨口径混搭）。body 内用 .setting-row 保持行内两端对齐。
  // 启动默认页：记忆开关上标题行，body 只留「固定页下拉 + 说明」。
  // 旧写法左侧「跟随上次访问」与右侧「记住并恢复…」同义重复，已删左侧标题
  // （settings.defaultPage.remember 随之退役）。
  const defaultPageCard = stgCard(
    UI_ICONS.home,
    t("settings.defaultPage"),
    `<div class="setting-row" style="padding:0;background:none;animation:none">
      <label for="set-default-page" class="label">${t("settings.defaultPage.fixed")}</label>
      <select id="set-default-page" class="stg-select" style="width:auto">
        ${navItems()
          .map((it) => `<option value="${it.id}">${resolveIcon(it.icon)} ${t(it.key)}</option>`)
          .join("\n        ")}
      </select>
    </div>
    <div class="stg-card-desc">${t("settings.defaultPageHint")}</div>`,
    {
      header: {
        actions: `<label class="stg-label" style="gap:8px">
        <input type="checkbox" id="set-remember-page" checked> ${t("settings.defaultPage.rememberCheck")}
      </label>`,
      },
      cardId: "stg-default-page-card",
      delayMs: 210,
    },
  );

  // 两卡并排：.stg-grid-2 命名类（不再内联 grid-template-columns）。
  // stg-section 补上组间上间距：本组未挂 .section-title（卡片自带 card-hdr），
  // 而组间空白一直由该标题的 padding 隐式提供——不补会与上方行组贴死。
  return `<div class="stg-grid stg-grid-2 stg-section">${animCard}${defaultPageCard}</div>`;
}

function renderStgPreview3d(): string {
  return `<div class="section-title stg-title">${UI_ICONS.joystick} ${t("settings.preview3d.title")}</div>

<div class="settings-group" style="animation-delay:240ms">
  <div class="setting-row">
    <label for="td-camspeed" class="label">${UI_ICONS.video} ${t("settings.preview3d.camSpeed")}</label>
    <input type="range" id="td-camspeed" min="2" max="200" value="20" style="flex:1;accent-color:var(--accent,#7c83ff)">
    <span id="td-camspeed-val" style="min-width:28px;text-align:right;color:var(--txt)">20</span>
  </div>
  <div class="stg-hint">${t("settings.preview3d.camSpeedHint")}</div>
</div>

<div class="settings-group" style="animation-delay:270ms">
  <div class="setting-row">
    <label for="td-rotmode" class="label">${UI_ICONS.refresh} ${t("settings.preview3d.rotMode")}</label>
    <select id="td-rotmode" class="stg-select" style="width:auto">
      <option value="orbit">${t("settings.preview3d.orbit")}</option>
      <option value="free">${t("settings.preview3d.free")}</option>
    </select>
  </div>
  <div class="stg-hint">${t("settings.preview3d.rotModeHint")}</div>
</div>

<div class="settings-group" style="animation-delay:300ms">
  <div class="setting-row" style="align-items:flex-start;flex-direction:column;gap:8px">
    <span class="label">${UI_ICONS.game} ${t("settings.preview3d.keymap")}</span>
    <div id="td-keymap-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;width:100%"></div>
  </div>
  <div class="stg-hint">${t("settings.preview3d.keymapHint")}</div>
  <div style="margin-top:8px"><button class="btn-base sm" id="td-keymap-reset">${UI_ICONS.undo} ${t("settings.preview3d.resetKeys")}</button></div>
</div>`;
}

function renderStgParserWorkers(): string {
  return `<div class="section-title stg-title">${UI_ICONS.parser} ${t("settings.parser")}</div>
<div style="font-size:var(--fs-sm);color:var(--muted);line-height:1.7;margin-bottom:12px">${t("settings.parserDesc")}</div>

<div class="settings-group" style="animation-delay:0ms">
  <div class="setting-row">
    <span class="label">${UI_ICONS.parser} ${t("settings.preview3d.fbxWorker")}</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-fbx-worker"> ${t("settings.preview3d.workerCheck")}
    </label>
  </div>
  <div class="stg-hint">${t("settings.preview3d.fbxWorkerHint")}</div>
</div>

<div class="settings-group" style="animation-delay:60ms">
  <div class="setting-row">
    <span class="label">${UI_ICONS.parser} ${t("settings.preview3d.mmdWorker")}</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-mmd-worker"> ${t("settings.preview3d.workerCheck")}
    </label>
  </div>
  <div class="stg-hint">${t("settings.preview3d.mmdWorkerHint")}</div>
</div>`;
}

function renderStgTabBody(tabId: string, display: string, body: string): string {
  // 激活 tab 传空 display → 不回写 inline，回落 .tab-body{display:flex}(content-stg.ts:102)，
  // 与 bindTabs.activate 置 "" 的行为一致；隐藏 tab 才显式 "none"。
  const style = `overflow-y:auto${display ? `;display:${display}` : ""}`;
  return `<!-- stg-tab-${tabId} -->
<div class="tab-body" id="stg-tab-${tabId}" style="${style}">
<div class="stg-page">
${body}
</div>
</div>
<!-- /stg-tab-${tabId} -->`;
}

export function settingsHTML(): string {
  const isViewer = isViewerMode();
  const isWebViewer = isWebPlatform();

  const basicBody = `${renderStgBasicPaths(isViewer)}
  ${renderStgStorageCard(isWebViewer)}
${renderStgLangSelect()}`;

  const uiBody = `<div class="section-title stg-title">${UI_ICONS.moon} ${t("settings.theme.title")}</div>

${renderStgThemePicker()}

${renderStgThemeAuto()}

${renderStgFontFamily()}

${renderStgAnimDefault()}

${renderStgPreview3d()}`;

  const parserBody = renderStgParserWorkers();

  return `<div class="repo-wrap">
${renderStgTabs()}
${renderStgTabBody("basic", "", basicBody)}
${renderStgTabBody("ui", "none", uiBody)}
${renderStgTabBody("parser", "none", parserBody)}
${aboutHTML()}
${creditsHTML()}

</div>`;
}
