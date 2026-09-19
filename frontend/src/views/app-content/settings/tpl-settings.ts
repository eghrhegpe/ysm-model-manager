// ===== tpl-settings.ts — settingsHTML 页面模板（从 tpl.ts 拆出，ADR-040 P1 第2轮拆分）=====
// basic + ui 标签页在此；about + credits 已拆至 tpl-settings-about.ts

import { isViewerMode } from "@/backend/platform.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { t } from "@/core/i18n/t.ts";
import { THEME_VALID } from "@/theme-core";
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
<button class="stg-tab" data-tab="ops">${UI_ICONS.joystick} ${t("settings.operations")}</button>
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
  // 升格为 .stg-card 正典卡（设置页样式范式契约待修债 #1）：原手写 <div class="stg-card"> 未走
  // stgCard() 构造器，hdr 缺失、间距/圆角与正典卡不一致。单卡场景：hdr 标题即「语言」，
  // body 内 select+描述，不再另挂 .section-title（避免标题重复，与动画卡同构）。
  return stgCard(
    UI_ICONS.web,
    t("settings.language"),
    `<div style="display:flex;align-items:center;gap:8px">
    <select id="set-lang" class="stg-select" style="width:auto">
      <option value="zh-CN">简体中文</option>
      <option value="en">English</option>
      <option value="ja">日本語</option>
    </select>
    <span style="font-size:var(--fs-xs);color:var(--muted)">${t("settings.languageDesc")}</span>
  </div>`,
    {
      header: { titleSize: "md" },
      cardId: "stg-lang-card",
      delayMs: 240,
    },
  );
}

// ===== 主题卡片数据：三态色点声明 + 图标键（单一事实源 = THEME_VALID）=====
// 色点经 data-var 声明要取的 3 个主题变量（全仓 var 使用最高频）：
//   --bg(72) 常态基调 / --accent(245) 选中态强调 / --bd(212) 边框选中态
// 实际色值不在模板内联：主题色只定义在 document 层 variables.css（.theme-x 块），
// 而设置页处于 Shadow DOM——document 规则不匹配 shadow 内元素，卡片上的 .theme-x
// 类解析不到，var() 只会落回宿主（当前主题）继承值，导致六卡同色（2026-09 修）。
// 真实色由 theme.ts initThemeSection 用 document 探针逐主题取回填 inline；
// 此处 var(--${v}) 仅作回退底色（探针不可用时仍有三点不裸奔）。
const THEME_SWATCH_VARS = ["bg", "accent", "bd"] as const;
const THEME_ICON: Record<string, string> = {
  warm: "sun",
  sakura: "sakura",
  mint: "mint",
  pro: "dot",
  cyber: "moon",
  ocean: "ocean",
};
/** 主题 → 标签 i18n 键（静态映射，与 THEME_ICON 平行）。
 *  原为 ``t(`settings.theme.${theme}` as Parameters<typeof t>[0])`` 动态拼接，两处弊病：
 *  ① 六个键在静态扫描里全被判死（check-i18n-unused 的 constructed 假阳性——
 *     该脚本注释的前提是「本仓该形态为 0 处」，动态拼接即破坏它）；
 *  ② `as` 强转绕过键名类型校验（拼错不报错）。改静态映射后两者皆消。 */
const THEME_LABEL_KEY: Record<string, Parameters<typeof t>[0]> = {
  warm: "settings.theme.warm",
  sakura: "settings.theme.sakura",
  mint: "settings.theme.mint",
  pro: "settings.theme.pro",
  cyber: "settings.theme.cyber",
  ocean: "settings.theme.ocean",
};

function renderStgThemePicker(): string {
  const cards = THEME_VALID.filter((theme) => theme !== "system")
    .map((theme) => {
      const icon = UI_ICONS[THEME_ICON[theme] as keyof typeof UI_ICONS] ?? UI_ICONS.dot;
      const labelKey = THEME_LABEL_KEY[theme];
      const label = labelKey ? t(labelKey) : theme;
      // --bd 是 10-12% 透明 color-mix，直接作底色会隐没在卡片上——统一加 muted 描边保证三点半可辨
      const swatches = THEME_SWATCH_VARS.map(
        (v) =>
          `<span data-var="${v}" style="width:8px;height:8px;border-radius:50%;border:1px solid var(--muted);background:var(--${v})"></span>`,
      ).join("");
      return `<div class="theme-card theme-${theme}" data-theme="${theme}">
        <div style="display:flex;gap:2px;margin-bottom:2px">${swatches}</div>
        <span style="font-size:var(--fs-xs);font-weight:600;color:var(--txt)">${icon} ${label}</span>
      </div>`;
    })
    .join("");

  return `<!-- theme cards: dots bound to --bg/--accent/--bd via .theme-x scope -->
<div class="settings-group" style="animation-delay:0ms">
  <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
    <span class="label">${UI_ICONS.appearance} ${t("settings.theme.select")}</span>
    <div class="theme-picker" id="theme-picker">${cards}</div>
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
  // 三栏裸样式手写卡升格为 .stg-grid + .stgCard 正典卡（设置页样式范式契约待修债 #2）：
  // 原 <div style="background:var(--surf);border:..."> 三处间距/圆角/动画各自为政，已漂移；
  // 现与路径三卡同构（stg-grid 三列平铺，各卡 hdr 小标题 + body 控件）。
  const sizeCard = stgCard(
    UI_ICONS.ruler,
    t("settings.fontSize"),
    `<select id="set-font-size" class="stg-select" style="width:100%;margin-bottom:4px">
      <option value="xsmall">${UI_ICONS.bullet} ${t("settings.fontSize.xsmall")}</option>
      <option value="small">${UI_ICONS.bulletAlt} ${t("settings.fontSize.small")}</option>
      <option value="normal" selected>${UI_ICONS.dot} ${t("settings.fontSize.normal")}</option>
      <option value="medium">${UI_ICONS.radioOn} ${t("settings.fontSize.medium")}</option>
      <option value="large">${UI_ICONS.collision} ${t("settings.fontSize.large")}</option>
    </select>
    <div id="set-size-preview" style="display:flex;gap:8px;font-size:var(--fs-sm);color:var(--muted);padding:2px 0">
      <span>${t("settings.ui.body")} <b id="sz-base" style="color:var(--txt)">13px</b></span>
      <span>${t("settings.ui.buttonGap")} <b id="sz-space" style="color:var(--txt)">5px</b></span>
      <span>${t("settings.ui.buttonHeight")} <b id="sz-btn-h" style="color:var(--txt)">25px</b></span>
    </div>
    <div class="stg-desc">${t("settings.fontSizeHint")}</div>`,
    {
      header: { forId: "set-font-size", titleSize: "md" },
      cardId: "stg-font-size-card",
      delayMs: 60,
    },
  );
  const displayCard = stgCard(
    UI_ICONS.brush,
    t("settings.font.creatorFont"),
    `<select id="set-display-font" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="kaiti" selected>${UI_ICONS.brush} ${t("settings.font.kaiti")}</option>
      <option value="system">${UI_ICONS.note} ${t("settings.font.systemFont")}</option>
    </select>
    <div class="stg-desc">${t("settings.fontHint")}</div>`,
    {
      header: { forId: "set-display-font", titleSize: "md" },
      cardId: "stg-font-display-card",
      delayMs: 90,
    },
  );
  const densityCard = stgCard(
    UI_ICONS.payment,
    t("settings.density"),
    `<select id="set-card-density" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="compact" selected>${UI_ICONS.package} ${t("settings.density.compact")}</option>
      <option value="normal">${UI_ICONS.package} ${t("settings.density.normal")}</option>
    </select>
    <div class="stg-desc">${t("settings.densityHint")}</div>`,
    {
      header: { forId: "set-card-density", titleSize: "md" },
      cardId: "stg-font-density-card",
      delayMs: 120,
    },
  );
  return `<div class="section-title stg-title">${UI_ICONS.geometry} ${t("settings.font.title")}</div>
<div class="stg-grid">
  ${sizeCard}
  ${displayCard}
  ${densityCard}
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
  <div class="stg-desc">${t("settings.preview3d.camSpeedHint")}</div>
</div>

<div class="settings-group" style="animation-delay:270ms">
  <div class="setting-row">
    <label for="td-rotmode" class="label">${UI_ICONS.refresh} ${t("settings.preview3d.rotMode")}</label>
    <select id="td-rotmode" class="stg-select" style="width:auto">
      <option value="orbit">${t("settings.preview3d.orbit")}</option>
      <option value="free">${t("settings.preview3d.free")}</option>
    </select>
  </div>
  <div class="stg-desc">${t("settings.preview3d.rotModeHint")}</div>
</div>

<div class="settings-group" style="animation-delay:300ms">
  <div class="setting-row" style="align-items:flex-start;flex-direction:column;gap:8px">
    <span class="label">${UI_ICONS.game} ${t("settings.preview3d.keymap")}</span>
    <div id="td-keymap-grid" class="stg-grid" style="gap:8px"></div>
  </div>
  <div class="stg-desc">${t("settings.preview3d.keymapHint")}</div>
  <div style="margin-top:8px"><button class="btn-base sm" id="td-keymap-reset">${UI_ICONS.undo} ${t("settings.preview3d.resetKeys")}</button></div>
</div>`;
}

function renderStgParserWorkers(): string {
  return `<div class="section-title stg-title">${UI_ICONS.parser} ${t("settings.parser")}</div>
<div class="settings-group" style="animation-delay:0ms">
  <div class="stg-desc">${t("settings.parserDesc")}</div>
</div>

<div class="settings-group" style="animation-delay:60ms">
  <div class="setting-row">
    <span class="label">${UI_ICONS.parser} ${t("settings.preview3d.fbxWorker")}</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-fbx-worker"> ${t("settings.preview3d.workerCheck")}
    </label>
  </div>
  <div class="stg-desc">${t("settings.preview3d.fbxWorkerHint")}</div>
</div>

<div class="settings-group" style="animation-delay:120ms">
  <div class="setting-row">
    <span class="label">${UI_ICONS.parser} ${t("settings.preview3d.mmdWorker")}</span>
    <label class="stg-label" style="gap:8px">
      <input type="checkbox" id="set-mmd-worker"> ${t("settings.preview3d.workerCheck")}
    </label>
  </div>
  <div class="stg-desc">${t("settings.preview3d.mmdWorkerHint")}</div>
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

${renderStgAnimDefault()}`;

  const parserBody = renderStgParserWorkers();

  const opsBody = `${renderStgPreview3d()}`;

  return `<div class="repo-wrap">
${renderStgTabs()}
${renderStgTabBody("basic", "", basicBody)}
${renderStgTabBody("ui", "none", uiBody)}
${renderStgTabBody("parser", "none", parserBody)}
${renderStgTabBody("ops", "none", opsBody)}
${aboutHTML()}
${creditsHTML()}

</div>`;
}
