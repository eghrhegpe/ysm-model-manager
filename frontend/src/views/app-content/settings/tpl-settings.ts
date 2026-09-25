// ===== tpl-settings.ts — settingsHTML 页面模板（从 tpl.ts 拆出，ADR-040 P1 第2轮拆分）=====
// env + appearance + preview3d 标签页在此；aboutUpdate（含鸣谢小节）已拆至 tpl-settings-about.ts。
// 2026-10 菜单收口（锐评方案 A）：6 tab → 4 tab（常规/外观/3D 预览/关于）——
//   （2026-09 锐评：第三个 tab 名原为「3D 与解析」、键名却叫 settings.operations，已改名
//    settings.tab3d = 「3D 预览」，键名与文案对齐，详本文件 settingsHTML 内注释）
//   ① 「解析」（FBX/MMD worker 两个开关）降级为「3D 预览」tab 的「解析」节：
//      两个开关不值得占一个菜单槽，且并入 3D 域后「解析」节标题不再与 tab 名同名重复；
//   ② 「鸣谢」（纯只读展示）降级为「关于」tab 的下段小节（aboutPageBody 组合）：
//      设置菜单槽位语义 = 「这里能配置什么」，只读展示不占槽；「关于」含真实设置
//      （更新检查间隔/检查更新/版本）保留 tab；
//   ③ 「启动默认页面」从外观迁至常规，避免启动导航行为混入视觉偏好。
// 2026-09-25 第二轮语义收债（锐评：槽名答不了「这里能配什么」+ 图标跨层级撞形）：
//   id = general/appearance/preview3d/about → env/appearance/preview3d/aboutUpdate，
//   i18n 键 settings.general→settings.env（「环境」）、settings.about→settings.aboutUpdate
//   （「更新与关于」）；语言卡自「环境」迁至「外观」；「3D 预览」tab 内同名节标题删除；
//   三个 tab 图标校正（folder / brush / voxel，消与一级导航「社区」的同形歧义）。
// 2026-09 tab id 命名脱钩收债：id 原为 basic/ui/ops，其中 ops 却显示「3D 预览」、ui 却显示
//   「外观」——上一轮只把 i18n 键 operations→tab3d 改了，**同一个命名债的第二个载体
//   TabSpec.id 原地未动**，而 id 才是 DOM `data-tab` / 面板 id `stg-tab-<id>` 的唯一锚点
//   （测试钩子与未来深链接都抓它）。现 id = env/appearance/preview3d/aboutUpdate，并由
//   `SettingsTabId` 联合类型 + `SETTINGS_TAB_META` 的 Record 形态在编译期兜住「新增 tab 必须
//   同时给图标 + 文案键 + 面板体」，漏一处即报错。testid 由 id 派生（stg-tabbtn-<id> /
//   stg-panel-<id>——前缀须与面板 DOM id 模板 `stg-tab-*` 岔开，否则 data-testid 属性文本
//   会被 `id="` 锚点误命中），不再手写在模板里跟着 id 漂移。

import { isViewerMode } from "@/backend/platform.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { SUPPORTED_LANGS } from "@/core/i18n/locale.ts";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { TD_CAM_SPEED, TD_ROT_MODE, type TdRotMode } from "@/preview-3d/infra/settings-schema.ts";
import { THEME_VALID } from "@/theme-core";
import { stagger } from "@/utils/animation/stagger.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { renderTabs, type TabSpec } from "@/views/app-content/tabs-shell.ts";
import { navItems } from "@/views/app-nav/nav-items.ts";
import { type StgCardSpec, stgCard, stgCards } from "./stg-card.ts";
import { aboutPageBody } from "./tpl-settings-about.ts";

// ADR-133 阶段 B/C+：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = ["set-mc-path"];

// ===== 设置页 tab 声明（唯一事实源：id / 图标 / 文案键 / 声明序在此一处）=====
/** 设置页 tab id 联合；面板 id = `stg-tab-<id>`、按钮 testid = `stg-tabbtn-<id>`。
 *  新增 tab：改类型 + 改下方 Record（两处漏一即编译期报错）。 */
export type SettingsTabId = "env" | "appearance" | "preview3d" | "aboutUpdate";

/** tab 元信息。Record 形态 ⇒ 新增 tab 必须同时给图标与文案键（ADR-303 `Record<TdRotMode, …>`
 *  同款护栏；无它则「加了 id 忘了图标」只在运行时表现为空白按钮）。
 *
 *  2026-09-25 菜单语义收债（两条同源病：槽名答不了「这里能配什么」+ 图标与一级导航撞形）：
 *   ① `general`→`env`：旧名「常规」是零信息量抽屉（路径/链接/镜像源/存储/启动页无一与
 *      「常规」同义），键名 `settings.general` 与显示文案同样脱钩 → 一并改名 `settings.env`
 *      （「环境」= 东西放哪、怎么拉、开机去哪）。**语言随之迁出本 tab**（显示偏好，归外观）。
 *   ② `about`→`aboutUpdate`：本 tab 除只读展示外含真实设置（更新检查间隔 / 立即检查更新），
 *      旧名「关于」不回答「这里能配什么」 → 键名 `settings.aboutUpdate`「更新与关于」。
 *   ③ 图标：`appearance`（圆脸笑脸）同时被一级导航「社区」占用（nav-items.ts），跨两级同形
 *      = 同一字形两种语义 → 外观 tab 改 `brush`；`controls`（三滑块）挂在没有滑块的常规 tab、
 *      真正有滑块的相机速度却在 3D tab → 3D 预览改 `voxel`（立方体），常规改 `folder`。 */
const SETTINGS_TAB_META: Record<SettingsTabId, { icon: string; labelKey: LocaleKey }> = {
  // 「环境」用 folder（本地落点）而非 settings（齿轮）：齿轮是左侧一级导航的设置入口
  // （nav-items.ts icon:"settings"），页内二级 tab 复用同形 → 「点齿轮」在两种层级间歧义。
  env: { icon: UI_ICONS.folder, labelKey: "settings.env" },
  appearance: { icon: UI_ICONS.brush, labelKey: "settings.appearance" },
  // 3D 预览用 voxel（立方体）而非 joystick（手柄=输入操作）：本 tab 配的是「看的方式」
  // （相机/旋转/键位/解析），不是手柄映射
  preview3d: { icon: UI_ICONS.voxel, labelKey: "settings.tab3d" },
  aboutUpdate: { icon: UI_ICONS.info, labelKey: "settings.aboutUpdate" },
};

/**
 * 按 id 产出 tab 声明：label 与 testid 均从 id 派生，id 改名不会留下漂移的钩子。
 *
 * ⚠️ buttonTestid 必须叫 `stg-tabbtn-*`：不能与面板 DOM id 模板 `stg-tab-*` 同名——
 * `data-testid="stg-tab-general"` 里天然含子串 `id="stg-tab-general"`，会让测试/脚本按
 * `id="` 锚点定位面板时先命中 tab 栏按钮（2026-09 实测把 panelSlice 切片顶到 bar 上）。
 * 前缀岔开后两套命名空间互不误伤；bindTabs 运行期给按钮写的 DOM id 是 stg-tab-btn-*
 *（也不同前缀），三者各据一词。
 */
function buildSettingsTabs(bodies: Record<SettingsTabId, string>): TabSpec<SettingsTabId>[] {
  const entries = Object.entries(SETTINGS_TAB_META) as [
    SettingsTabId,
    { icon: string; labelKey: LocaleKey },
  ][];
  return entries.map(([id, meta]) => ({
    id,
    label: `${meta.icon} ${t(meta.labelKey)}`,
    body: bodies[id],
    buttonTestid: `stg-tabbtn-${id}`,
    panelTestid: `stg-panel-${id}`,
  }));
}

// ===== 组入场延迟编排（去魔数；派生值与改前逐位一致 ⇒ 零视觉变化）=====
/** 行组步长（ms）：同一 tab 内相邻组的错峰间隔。注：不用 stagger 的默认 30ms——
 *  本页组是一屏可见的大块，30ms 太快看不出节奏（历史沿用自上轮收敛）。 */
const STG_GROUP_STEP_MS = 60;
/** 页面级编排起点（ms）：各 tab 的首组入场档位；组内序号经 stagger 派生。
 *  `Partial<Record<SettingsTabId, number>>` 而非 `as const` 字面量对象——后者不校验键名
 *  （拼错 tab id 静默变 undefined → 动画档位乱跳）；Partial 允许「只有行组型 tab 才声明」。 */
const STG_BAND: Partial<Record<SettingsTabId, number>> = { appearance: 0, preview3d: 240 };
/** 第 i 个组的延迟值（band 缺省 0 = 首屏立即入场） */
const groupDelay = (band: number | undefined, i: number): number =>
  (band ?? 0) + stagger(i, STG_GROUP_STEP_MS);

function renderStgBasicPaths(isViewer: boolean, isWebViewer: boolean): string {
  // 路径三卡为同族组，入场延迟由 stgCards 按序号派生（step 60ms，与其余组的 30ms 区分：
  // 首屏三张大卡节奏放缓一档）。2026-09 前为手填 0/60/120 字面量。
  const specs: StgCardSpec[] = [];
  // mc-path（游戏根目录）：桌面 + 安卓 viewer 通用——安卓 viewer 点击走 directory-picker.ts
  // resolveAndroidRepoDir（未授权弹系统授权页、授权后定位 /storage/emulated/0/YSM-Model-Manager），
  // 是查看器模式的真授权入口，严禁隐藏（ADR-307 D2 查实修正：原 if(!isViewer) 整体消失把这条
  // 入口一并埋了）；网页版不渲染（mc-path 会指向 /web 虚拟根，与 webRepo FSA 授权卡语义重叠）。
  if (!isWebViewer) {
    specs.push({
      icon: UI_ICONS.game,
      title: t("settings.paths.gameRoot"),
      body: `<button type="button" class="stg-path-val" id="set-mc-path" data-testid="set-mc-path">${t("common.loading")}</button>
        <div class="stg-card-desc">${t("settings.paths.gameRootDesc")}</div>`,
      header: {
        actions: `<button class="btn-base sm" id="set-mc-detect">${UI_ICONS.search} ${t("settings.paths.autoSearch")}</button>`,
      },
    });
  }
  // 链接模式 / 下载镜像源：纯桌面 / 网络概念，查看器模式（安卓 + 网页版）无意义 → 不渲染
  if (!isViewer) {
    specs.push(
      {
        icon: UI_ICONS.link,
        title: t("settings.links.title"),
        body: `<select id="set-link-mode" class="stg-select" style="width:100%;margin-bottom:6px">
          <option value="copy">${t("settings.links.copy")}</option>
          <option value="hardlink" selected>${t("settings.links.hardlink")}</option>
          <option value="symlink">${t("settings.links.symlink")}</option>
        </select>
        <div id="lm-hint-copy" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:var(--pad-v-2)">${t("settings.links.copyHint")}</div>
        <div id="lm-hint-hardlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:var(--pad-v-2)">${t("settings.links.hardlinkHint")}</div>
        <div id="lm-hint-symlink" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:var(--pad-v-2)"><span style="color:var(--status-error)">${t("settings.links.symlinkHint")}</span></div>`,
        header: {
          forId: "set-link-mode",
          actions: `<button id="set-relink" class="btn-base sm">${UI_ICONS.refresh} ${t("settings.links.reapply")}</button>`,
        },
      },
      {
        // 图标用 download 而非 web（globe 的别名）：`web` 与语言卡的 `globe` 引用同一 GLOBE_PATH
        // 常量（ui-icons.ts），渲染逐字节相同——同屏「语言」与「下载镜像源」曾是两个一模一样的
        // 地球，2026-09 那次「语义校正」只换了变量名、零视觉产出。镜像源 = 下载来源，用 download。
        icon: UI_ICONS.download,
        title: t("settings.mirror.title"),
        body: `<select id="set-mirror" class="stg-select" style="width:100%;margin-bottom:6px">
          <option value="">${t("settings.mirror.directOption")}</option>
          <option value="jsdelivr">${t("settings.mirror.jsdelivrOption")}</option>
          <option value="githubapi">${t("settings.mirror.nameGithubapi")}</option>
        </select>
        <div id="mirror-hint-direct" style="font-size:var(--fs-sm);color:var(--muted);padding:var(--pad-v-2);line-height:1.5">${t("settings.mirror.directHint")}</div>
        <div id="mirror-hint-jsdelivr" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:var(--pad-v-2);line-height:1.5">${t("settings.mirror.jsdelivrHint")}</div>
        <div id="mirror-hint-githubapi" style="display:none;font-size:var(--fs-sm);color:var(--muted);padding:var(--pad-v-2);line-height:1.5">${t("settings.mirror.githubapiHint")}</div>`,
        header: { forId: "set-mirror" },
      },
    );
  }
  const cards = stgCards(specs, { step: 60 });
  // viewer 模式（安卓 + 网页版）段标题统一为「文件来源」，桌面为「路径配置」——
  // 与「这里是可配置路径 vs 这里只有来源入口」语义对齐，避免 viewer 下声称「路径配置」却无本地路径卡
  const title = t(isViewer ? "settings.paths.sourceTitle" : "settings.paths.title");
  if (!cards) {
    // Web viewer still needs the source section label before the FSA card below;
    // Android viewer now has the mc-path card（授权入口），不再走此空分支。
    return isWebViewer
      ? `<div class="section-title stg-title">${UI_ICONS.settings} ${title}</div>`
      : "";
  }
  return `<div class="section-title stg-title">${UI_ICONS.settings} ${title}</div>

<div class="stg-grid">
    ${cards}
  </div>`;
}

function renderStgStorageCard(isWebViewer: boolean): string {
  return isWebViewer
    ? stgCard(
        UI_ICONS.folder,
        t("settings.webRepo.title"),
        `<div class="stg-card-desc">${t("settings.webRepo.desc")}</div>
     <button class="btn-base sm" id="web-repo-auth-btn" style="margin-top:8px;font-size:var(--fs-sm);padding:var(--btn-padding-filter-lg)">${UI_ICONS.folderOpen} ${t("settings.webRepo.authorize")}</button>
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
        `<button type="button" class="stg-path-val" id="set-files-root">${t("common.loading")}</button>
     <div class="stg-card-desc">${t("settings.storage.desc")}</div>
     <div id="set-advanced-panel" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)">
       <div style="font-size:var(--fs-xs);color:var(--muted);margin-bottom:6px">${t("settings.path.customHint")}</div>
       <div class="stg-grid" id="set-advanced-grid"></div>
     </div>`,
        {
          header: {
            actions: `<button class="btn-base sm" id="set-advanced-toggle" style="font-size:var(--fs-tiny);padding:var(--btn-padding-tool-lg)">${UI_ICONS.folderOpen} ${t("settings.storage.expand")} ▸</button>`,
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
    <select id="set-lang" class="stg-select" style="width:auto">
      ${options}
    </select>
    <span style="font-size:var(--fs-xs);color:var(--muted)">${t("settings.languageDesc")}</span>
  </div>`,
    {
      header: { titleSize: "md" },
      cardId: "stg-lang-card",
      delayMs: 150,
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
      return `<button type="button" class="theme-card theme-${theme}" data-theme="${theme}" aria-pressed="false">
        <div style="display:flex;gap:2px;margin-bottom:2px">${swatches}</div>
        <span style="font-size:var(--fs-xs);font-weight:600;color:var(--txt)">${icon} ${label}</span>
      </button>`;
    })
    .join("");

  return `<!-- theme cards: dots bound to --bg/--accent/--bd via .theme-x scope -->
<div class="settings-group" style="animation-delay:${groupDelay(STG_BAND.appearance, 0)}ms">
  <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
    <span class="label">${UI_ICONS.appearance} ${t("settings.theme.select")}</span>
    <div class="theme-picker" id="theme-picker">${cards}</div>
  </div>
</div>`;
}

function renderStgThemeAuto(): string {
  return `<!-- 自动切换：独立一栏 -->
<div class="settings-group" style="animation-delay:${groupDelay(STG_BAND.appearance, 1)}ms">
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
  // 字体三卡同族：延迟由序号派生（startMs 60 = 本组在「外观」tab 的入场档位，属页面级编排）
  const fontCards = stgCards(
    [
      {
        icon: UI_ICONS.ruler,
        title: t("settings.fontSize"),
        body: `<select id="set-font-size" class="stg-select" style="width:100%;margin-bottom:4px">
      <option value="xsmall">${t("settings.fontSize.xsmall")}</option>
      <option value="small">${t("settings.fontSize.small")}</option>
      <option value="normal" selected>${t("settings.fontSize.normal")}</option>
      <option value="medium">${t("settings.fontSize.medium")}</option>
      <option value="large">${t("settings.fontSize.large")}</option>
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
        body: `<select id="set-display-font" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="kaiti" selected>${t("settings.font.kaiti")}</option>
      <option value="system">${t("settings.font.systemFont")}</option>
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
        body: `<select id="set-card-density" class="stg-select" style="width:100%;margin-bottom:6px">
      <option value="compact" selected>${t("settings.density.compact")}</option>
      <option value="normal">${t("settings.density.normal")}</option>
    </select>
    <div class="stg-desc">${t("settings.densityHint")}</div>`,
        header: { forId: "set-card-density", titleSize: "md" },
        cardId: "stg-font-density-card",
      },
    ],
    { startMs: 60 },
  );
  return `<div class="section-title stg-title">${UI_ICONS.geometry} ${t("settings.font.title")}</div>
<div class="stg-grid">
  ${fontCards}
</div>`;
}

function renderStgAnimationSection(): string {
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

  // 本组没有 section-title（卡片自带标题），用 stg-section 保留组间上间距。
  return `<div class="stg-section">${animCard}</div>`;
}

function renderStgDefaultPageSection(): string {
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
      delayMs: 210,
    },
  );

  // 本组没有 section-title（卡片自带标题），用 stg-section 保留组间上间距。
  return `<div class="stg-section">${defaultPageCard}</div>`;
}

/** 旋转模式 → 设置页文案键（ADR-303 §2：schema 只供值，文案键域归各面）。
 *  `Record<TdRotMode, LocaleKey>` 形态——schema 新增模式时此处编译期报错，逼出文案同步。 */
const ROT_MODE_LABEL: Record<TdRotMode, LocaleKey> = {
  orbit: "settings.preview3d.orbit",
  free: "settings.preview3d.free",
};

function renderStgPreview3d(): string {
  // 值域 / 默认值 / 枚举全部消费 settings-schema（ADR-303）：曾与 3D ⚙ 面板 + 读取层
  // 三处各写一份裸字面量，改一处漏一处即「拖了没反应且无报错」。
  const rotOptions = TD_ROT_MODE.values
    .map((v) => `<option value="${v}">${t(ROT_MODE_LABEL[v])}</option>`)
    .join("\n      ");
  // 不再挂「3D 预览」节标题：tab 名即「3D 预览」（settings.tab3d），面板首行再写一遍同名
  // 大标题是纯装饰——与「解析」节标题同类病，aboutPageBody 已按同口径不挂「关于」标题。
  // 首组改 B 式 .stg-section 供 16px 顶距：.stg-page 契约 padding:0 20px 16px 顶部零垫，
  // 原本的顶距一直由这个被删的 section-title 的 padding 隐式提供（删它不补类就贴顶）。
  return `<div class="settings-group stg-section" style="animation-delay:${groupDelay(STG_BAND.preview3d, 0)}ms">
  <div class="setting-row">
    <label for="td-camspeed" class="label">${UI_ICONS.video} ${t("settings.preview3d.camSpeed")}</label>
    <input type="range" id="td-camspeed" min="${TD_CAM_SPEED.min}" max="${TD_CAM_SPEED.max}" value="${TD_CAM_SPEED.default}" style="flex:1;accent-color:var(--accent,#7c83ff)">
    <span id="td-camspeed-val" style="min-width:28px;text-align:right;color:var(--txt)">${TD_CAM_SPEED.default}</span>
  </div>
  <div class="stg-desc">${t("settings.preview3d.camSpeedHint")}</div>
</div>

<div class="settings-group" style="animation-delay:${groupDelay(STG_BAND.preview3d, 1)}ms">
  <div class="setting-row">
    <label for="td-rotmode" class="label">${UI_ICONS.refresh} ${t("settings.preview3d.rotMode")}</label>
    <select id="td-rotmode" class="stg-select" style="width:auto">
      ${rotOptions}
    </select>
  </div>
  <div class="stg-desc">${t("settings.preview3d.rotModeHint")}</div>
</div>

<div class="settings-group" style="animation-delay:${groupDelay(STG_BAND.preview3d, 2)}ms">
  <div class="setting-row" style="align-items:flex-start;flex-direction:column;gap:8px">
    <span class="label">${UI_ICONS.game} ${t("settings.preview3d.keymap")}</span>
    <div id="td-keymap-grid" class="stg-grid stg-keymap-grid" style="gap:8px"></div>
  </div>
  <div class="stg-desc" id="td-keymap-hint">${t("settings.preview3d.keymapHint")}</div>
  <div style="margin-top:8px"><button class="btn-base sm" id="td-keymap-reset">${UI_ICONS.undo} ${t("settings.preview3d.resetKeys")}</button></div>
</div>`;
}

function renderStgParserWorkers(): string {
  return `<details class="stg-details stg-parser-details">
  <summary class="stg-details-summary">${UI_ICONS.parser} ${t("settings.parser")}</summary>
  <div class="stg-details-body">
    <div class="settings-group" style="animation-delay:${groupDelay(0, 0)}ms">
      <div class="stg-desc">${t("settings.parserDesc")}</div>
    </div>

    <div class="settings-group" style="animation-delay:${groupDelay(0, 1)}ms">
      <div class="setting-row">
        <span class="label" id="stg-fbx-worker-label">${UI_ICONS.parser} ${t("settings.preview3d.fbxWorker")}</span>
        <label class="stg-label" for="set-fbx-worker" style="gap:8px">
          <input type="checkbox" id="set-fbx-worker" aria-labelledby="stg-fbx-worker-label stg-fbx-worker-action" aria-describedby="stg-fbx-worker-hint">
          <span id="stg-fbx-worker-action">${t("settings.preview3d.workerCheck")}</span>
        </label>
      </div>
      <div class="stg-desc" id="stg-fbx-worker-hint">${t("settings.preview3d.fbxWorkerHint")}</div>
    </div>

    <div class="settings-group" style="animation-delay:${groupDelay(0, 2)}ms">
      <div class="setting-row">
        <span class="label" id="stg-mmd-worker-label">${UI_ICONS.parser} ${t("settings.preview3d.mmdWorker")}</span>
        <label class="stg-label" for="set-mmd-worker" style="gap:8px">
          <input type="checkbox" id="set-mmd-worker" aria-labelledby="stg-mmd-worker-label stg-mmd-worker-action" aria-describedby="stg-mmd-worker-hint">
          <span id="stg-mmd-worker-action">${t("settings.preview3d.workerCheck")}</span>
        </label>
      </div>
      <div class="stg-desc" id="stg-mmd-worker-hint">${t("settings.preview3d.mmdWorkerHint")}</div>
    </div>
  </div>
</details>`;
}

export function settingsHTML(): string {
  const isViewer = isViewerMode();
  const isWebViewer = isWebPlatform();

  const envBody = `${renderStgBasicPaths(isViewer, isWebViewer)}
  ${renderStgStorageCard(isWebViewer)}
${renderStgDefaultPageSection()}`;

  // 语言卡归「外观」（显示偏好），排在字体与布局之后、行为与动画之前
  const appearanceBody = `<div class="section-title stg-title">${UI_ICONS.moon} ${t("settings.theme.title")}</div>

${renderStgThemePicker()}

${renderStgThemeAuto()}

${renderStgFontFamily()}

${renderStgLangSelect()}

${renderStgAnimationSection()}`;

  // 「3D 预览」tab = 3D 预览设置（相机/旋转/键位）+ 解析（FBX/MMD worker 开关，2026-10 自
  // 独立「解析」tab 降级并入）——3D 域设置一处收口；「解析」节标题因此不再与 tab 名同名重复。
  const previewBody = `${renderStgPreview3d()}
${renderStgParserWorkers()}`;

  const { bar, panels } = renderTabs<SettingsTabId>({
    prefix: "stg",
    buttonClass: "stg-tab",
    // 半截接线补全（ADR-307 D2）：isViewer 已算却未传给 renderTabs → 对齐 ADR-300 §2.5
    // 机制；settings 当前无 desktopOnly tab，tab 级告知行暂不触发，机制接好即零视觉变化
    viewerMode: isViewer,
    tabs: buildSettingsTabs({
      env: `<div class="stg-page">${envBody}</div>`,
      appearance: `<div class="stg-page">${appearanceBody}</div>`,
      preview3d: `<div class="stg-page">${previewBody}</div>`,
      // 更新与关于（含鸣谢小节，aboutPageBody 自带 .stg-page 壳，不再外包）
      aboutUpdate: aboutPageBody(),
    }),
  });
  return `<div class="repo-wrap">${bar}${panels}</div>`;
}
