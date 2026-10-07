// ===== tpl-settings-appearance.ts — 设置页「外观」tab 模板（语言 + 主题 + 字体 + 动画 + 默认页）=====
// 来源：从 frontend/src/views/app-content/settings/tpl-settings.ts 拆出（ADR-040 P1 分片收口）。
// 职责：外观 tab 的模板渲染——语言选择、主题选择器（六主题色点卡 + 自动切换）、字体三卡
//       （字号/创作者名字体/卡片密度）、动画开关、启动默认页卡。
// 拆分日期：2026-10-07。只搬移不改行为：所有 render* 函数与常量表逐字保留，仍返回 string
//       （R8 不新增 HTML 字面量到非模板文件——本文件仍是模板文件）。
// 值域枚举单一来源 = settings-schema.ts（FONT_SIZE_LEVELS / DISPLAY_FONTS / DENSITY_LEVELS）与
//   theme-core（THEME_VALID / THEME_AUTO_VALID），文案键归本面 Record 表（加档位编译期报错）。
import { SUPPORTED_LANGS } from "@/core/i18n/locale.ts";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { THEME_AUTO_VALID, THEME_VALID, type ThemeCard } from "@/theme-core";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { navItems } from "@/views/app-nav/nav-items.ts";
import {
  DENSITY_DEFAULT,
  DENSITY_LEVELS,
  type DensityLevel,
  DISPLAY_FONT_DEFAULT,
  DISPLAY_FONTS,
  type DisplayFont,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_LEVELS,
  type FontSizeLevel,
} from "./settings-schema.ts";
import { stgCard, stgCards } from "./stg-card.ts";

export function renderStgLangSelect(startMs: number): string {
  // 升格为 .stg-card 正典卡（设置页样式范式契约待修债 #1）：原手写 <div class="stg-card"> 未走
  // stgCard() 构造器，hdr 缺失、间距/圆角与正典卡不一致。单卡场景：hdr 标题即「语言」，
  // body 内 select+描述，不再另挂 .section-title（避免标题重复，与动画卡同构）。
  // 选项从 SUPPORTED_LANGS 派生（label = 语言内生名，自名不经 t()——zh-CN 的 lang.* 死键
  // 已在 49b5ce13d 删除，见 locale.ts L16-20 契约注）：原三行硬编码是注释宣称
  // 「设置页下拉按 label 渲染」却未兑现的滞后实现，语言增删须双处同步。
  const options = SUPPORTED_LANGS.map((l) => `<option value="${l.code}">${l.label}</option>`).join(
    "\n      ",
  );
  // 图标语义校正（2026-09 锐评 P3）：「语言」用 globe（🌍 国际化）而非 web（🌐 网络）——
  // 后者已被下方「下载镜像源」卡占用，同屏两个相同字形表达不同语义是认知噪音。
  // 归属校正（2026-09-25）：语言是**显示偏好**，原挂在「常规」（零信息量抽屉）里，
  // 用户找语言的第一直觉是「外观」→ 迁至外观 tab，排在字体组之后、动画卡之前，
  // delay 150 接入外观 tab 的编排档位（主题0 / 自动60 / 字体60-120 / 语言150 / 动画180）。
  return stgCard(
    UI_ICONS.globe,
    t("settings.language"),
    `<div style="display:flex;align-items:center;gap:8px">
    <select id="set-lang" class="stg-select">
      ${options}
    </select>
    <span style="font-size:var(--fs-xs);color:var(--muted)">${t("settings.languageDesc")}</span>
  </div>`,
    {
      header: { titleSize: "md" },
      cardId: "stg-lang-card",
      delayMs: startMs,
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
/** 主题 → 图标键。`Record<ThemeCard, …>` 形态：theme-core|THEME_VALID 加主题时此处漏键即
 *  编译期红（2026-10 锐评第七轮收编——原 `Record<string, string>` 松键只能靠 `?? UI_ICONS.dot`
 *  运行时兜底，加主题漏一处表现为「卡片裸点图标 + 裸主题名」静默漂移）。 */
const THEME_ICON: Record<ThemeCard, keyof typeof UI_ICONS> = {
  warm: "sun",
  sakura: "sakura",
  mint: "mint",
  pro: "dot",
  cyber: "moon",
  ocean: "ocean",
};
/** 主题 → 标签 i18n 键（静态映射，与 THEME_ICON 平行，同 `Record<ThemeCard, …>` 护栏）。
 *  原为 ``t(`settings.theme.${theme}` as Parameters<typeof t>[0])`` 动态拼接，两处弊病：
 *  ① 六个键在静态扫描里全被判死（check-i18n-unused 的 constructed 假阳性——
 *     该脚本注释的前提是「本仓该形态为 0 处」，动态拼接即破坏它）；
 *  ② `as` 强转绕过键名类型校验（拼错不报错）。改静态映射后两者皆消。 */
const THEME_LABEL_KEY: Record<ThemeCard, LocaleKey> = {
  warm: "settings.theme.warm",
  sakura: "settings.theme.sakura",
  mint: "settings.theme.mint",
  pro: "settings.theme.pro",
  cyber: "settings.theme.cyber",
  ocean: "settings.theme.ocean",
};

// ===== 值域文案表（ADR-307 D3 扩编消费面：值→文案归各面，Record 护栏逼 schema 加成员同步）=====
// 原为模板里手写裸 <option> 列——加一档/改默认漏一处即「下拉框静默没有」或「默认值漂移」。
// 现 option 全部由 schema 枚举 .map 派生（存在性 + 顺序 + selected 默认项随 schema）。
/** 主题自动模式 → i18n 键（白名单 = theme-core.ts|THEME_AUTO_VALID，本表 Record 形态锁死键域）。 */
const THEME_AUTO_LABEL: Record<(typeof THEME_AUTO_VALID)[number], LocaleKey> = {
  off: "settings.theme.autoOff",
  system: "settings.theme.autoSystem",
  time: "settings.theme.autoTime",
};

/** 字号五档 → i18n 键（Record<FontSizeLevel,…>：schema 加档此处编译期报错）。 */
const FONT_SIZE_LABEL: Record<FontSizeLevel, LocaleKey> = {
  xsmall: "settings.fontSize.xsmall",
  small: "settings.fontSize.small",
  normal: "settings.fontSize.normal",
  medium: "settings.fontSize.medium",
  large: "settings.fontSize.large",
};

/** 卡片密度 → i18n 键。 */
const DENSITY_LABEL: Record<DensityLevel, LocaleKey> = {
  compact: "settings.density.compact",
  normal: "settings.density.normal",
};

/** 创作者名字体 → i18n 键。 */
const DISPLAY_FONT_LABEL: Record<DisplayFont, LocaleKey> = {
  kaiti: "settings.font.kaiti",
  system: "settings.font.systemFont",
};

export function renderStgThemePicker(startMs: number): string {
  // 键域收窄：filter 带类型谓词把 "system" 摘掉后 theme 落进 ThemeCard——图标/文案表按下标取
  // 必命中（无 `?? UI_ICONS.dot` / `labelKey ? … : theme` 运行时兜底，漏键在编译期就红）。
  const cards = THEME_VALID.filter((theme): theme is ThemeCard => theme !== "system")
    .map((theme) => {
      const icon = UI_ICONS[THEME_ICON[theme]];
      const label = t(THEME_LABEL_KEY[theme]);
      // --bd 是 10-12% 透明 color-mix，直接作底色会隐没在卡片上——统一加 muted 描边保证三点半可辨
      const swatches = THEME_SWATCH_VARS.map(
        (v) =>
          `<span data-var="${v}" style="width:8px;height:8px;border-radius:50%;border:1px solid var(--muted);background:var(--${v})"></span>`,
      ).join("");
      return `<button type="button" class="theme-card theme-${theme}" data-theme="${theme}" aria-pressed="false">
        <div style="display:flex;gap:2px;margin-bottom:2px">${swatches}</div>
        <span style="font-size:var(--fs-xs);font-weight:600;color:var(--txt)">${icon} ${label}</span>
      </button>`;
    })
    .join("");

  return `<!-- theme cards: dots bound to --bg/--accent/--bd via .theme-x scope -->
<div class="settings-group" style="animation-delay:${startMs}ms">
  <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
    <span class="label">${UI_ICONS.appearance} ${t("settings.theme.select")}</span>
    <div class="theme-picker" id="theme-picker">${cards}</div>
  </div>
</div>`;
}

export function renderStgThemeAuto(startMs: number): string {
  // 自动模式 option 由 theme-core|THEME_AUTO_VALID 派生（白名单单一事实源；文案键经
  // THEME_AUTO_LABEL Record——加模式此处编译期报错，同 MIRROR_UI 口径）。
  const autoOptions = THEME_AUTO_VALID.map(
    (m) => `<option value="${m}">${t(THEME_AUTO_LABEL[m])}</option>`,
  ).join("\n      ");
  return `<!-- 自动切换：独立一栏 -->
<div class="settings-group" style="animation-delay:${startMs}ms">
  <div class="setting-row">
    <label for="theme-auto" class="label">${UI_ICONS.clock} ${t("settings.theme.autoTitle")}</label>
    <select id="theme-auto" class="stg-select">
      ${autoOptions}
    </select>
  </div>
</div>`;
}

export function renderStgFontFamily(startMs: number, cardStep: number): string {
  // 三栏裸样式手写卡升格为 .stg-grid + .stgCard 正典卡（设置页样式范式契约待修债 #2）：
  // 原 <div style="background:var(--surf);border:..."> 三处间距/圆角/动画各自为政，已漂移；
  // 现与路径三卡同构（stg-grid 三列平铺，各卡 hdr 小标题 + body 控件）。
  // 字体三卡同族：延迟 = startMs + i×cardStep（startMs/cardStep 由 stgUnits 注入，
  // 步长经参数传入——禁止内部硬编码 step，防「单元表声明 + 内部步长」双源）。
  // option 值域由 settings-schema 派生（ADR-307 D3 扩编：字号/字体/密度三张裸列收编——
  // 加档位改 schema 一处，Record 文案表编译期逼同步；selected 项 = schema 默认值）。
  const fontSizeOptions = FONT_SIZE_LEVELS.map(
    (v) =>
      `<option value="${v}"${v === FONT_SIZE_DEFAULT ? " selected" : ""}>${t(FONT_SIZE_LABEL[v])}</option>`,
  ).join("\n      ");
  const displayFontOptions = DISPLAY_FONTS.map(
    (v) =>
      `<option value="${v}"${v === DISPLAY_FONT_DEFAULT ? " selected" : ""}>${t(DISPLAY_FONT_LABEL[v])}</option>`,
  ).join("\n      ");
  const densityOptions = DENSITY_LEVELS.map(
    (v) =>
      `<option value="${v}"${v === DENSITY_DEFAULT ? " selected" : ""}>${t(DENSITY_LABEL[v])}</option>`,
  ).join("\n      ");
  const fontCards = stgCards(
    [
      {
        icon: UI_ICONS.ruler,
        title: t("settings.fontSize"),
        body: `<select id="set-font-size" class="stg-select stg-select-block">
      ${fontSizeOptions}
    </select>
    <div id="set-size-preview" style="display:flex;gap:8px;font-size:var(--fs-sm);color:var(--muted);padding:var(--pad-v-2)">
      <span>${t("settings.ui.body")} <b id="sz-base" style="color:var(--txt)">13px</b></span>
      <span>${t("settings.ui.buttonGap")} <b id="sz-space" style="color:var(--txt)">5px</b></span>
      <span>${t("settings.ui.buttonHeight")} <b id="sz-btn-h" style="color:var(--txt)">25px</b></span>
    </div>
    <div class="stg-desc">${t("settings.fontSizeHint")}</div>`,
        header: { forId: "set-font-size", titleSize: "md" },
        cardId: "stg-font-size-card",
      },
      {
        icon: UI_ICONS.brush,
        title: t("settings.font.creatorFont"),
        body: `<select id="set-display-font" class="stg-select stg-select-block">
      ${displayFontOptions}
    </select>
    <div class="stg-desc">${t("settings.fontHint")}</div>`,
        header: { forId: "set-display-font", titleSize: "md" },
        cardId: "stg-font-display-card",
      },
      {
        // 图标语义校正（2026-09 锐评 P3）：原用 UI_ICONS.payment（信用卡）表达「卡片密度」——
        // 字形与语义无关，用户需二次猜测。改 UI_ICONS.grid（四宫格，与紧密/稀疏的排版语义同构），
        // 复用既有图标、零新增成本；与同组「字号=标尺 ruler」形成「度量类」视觉族。
        icon: UI_ICONS.grid,
        title: t("settings.density"),
        body: `<select id="set-card-density" class="stg-select stg-select-block">
      ${densityOptions}
    </select>
    <div class="stg-desc">${t("settings.densityHint")}</div>`,
        header: { forId: "set-card-density", titleSize: "md" },
        cardId: "stg-font-density-card",
      },
    ],
    { startMs, step: cardStep },
  );
  return `<div class="section-title stg-title">${UI_ICONS.edit} ${t("settings.font.title")}</div>
<div class="stg-grid">
  ${fontCards}
</div>`;
}

export function renderStgAnimationSection(startMs: number): string {
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
      delayMs: startMs,
    },
  );

  // 本组没有 section-title（卡片自带标题），用 stg-section 保留组间上间距。
  return `<div class="stg-section">${animCard}</div>`;
}

export function renderStgDefaultPageSection(startMs: number): string {
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
      <select id="set-default-page" class="stg-select">
        ${navItems()
          .map((it) => `<option value="${it.id}">${t(it.key)}</option>`)
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
      delayMs: startMs,
    },
  );

  // 本组没有 section-title（卡片自带标题），用 stg-section 保留组间上间距。
  return `<div class="stg-section">${defaultPageCard}</div>`;
}
