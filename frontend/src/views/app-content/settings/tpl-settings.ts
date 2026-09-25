// ===== tpl-settings.ts — settingsHTML 页面模板（从 tpl.ts 拆出，ADR-040 P1 第2轮拆分）=====
// env + appearance + preview3d 标签页在此；aboutUpdate（含鸣谢小节）已拆至 tpl-settings-about.ts。
// 2026-10 锐评收尾：tab 文案键 settings.tab3d → settings.preview3d（与 TabSpec.id 同名对齐——
//   「tab」前缀描述的是「这是个 tab」而非「这里配什么」，与 settings.operations 同病根）；
//   镜像源 option/hint 接 MIRROR_SOURCES 派生（存在性随 schema，此前是半截接线，见 mirrorCardBody）。
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
import { THEME_AUTO_VALID, THEME_VALID } from "@/theme-core";
import { stagger } from "@/utils/animation/stagger.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { renderTabs, type TabSpec } from "@/views/app-content/tabs-shell.ts";
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
  LINK_MODE_DEFAULT,
  LINK_MODES,
  type LinkMode,
  MIRROR_DEFAULT,
  MIRROR_SOURCES,
  type MirrorSource,
} from "./settings-schema.ts";
import { type StgCardSpec, stgCard, stgCards, stgUnits } from "./stg-card.ts";
import { aboutPageBody } from "./tpl-settings-about.ts";

// ADR-133 阶段 B/C+：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = ["set-mc-path"];

// ===== 设置页 tab 声明（唯一事实源：id / 图标 / 文案键 / 声明序在此一处）=====
/** 设置页 tab id 联合；面板 id = `stg-tab-<id>`、按钮 testid = `stg-tabbtn-<id>`。
 *  新增 tab：改类型 + 改下方 Record（两处漏一即编译期报错）。 */
type SettingsTabId = "env" | "appearance" | "preview3d" | "aboutUpdate";

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
  preview3d: { icon: UI_ICONS.voxel, labelKey: "settings.preview3d" },
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

// ===== 组入场延迟编排（2026-10 方案 A：声明顺序即档位）=====
// 顶层单元编排已整体迁入 stg-card.ts|stgUnits（有序单元表按声明顺序自动累加槽位派生，
// 加卡/加组 = 表加一项，零手算、零撞车）。本表仅余 preview3d「解析」折叠区的**内部**
// 行组档：details 默认收起、展开时才播，内部三行组按 band 0 + 60ms 步长错峰
// （0/60/120，与顶部三卡同节奏，2026-10 收债后不再有 240ms 残锚/编排倒挂）。
/** 折叠区内部行组步长（ms）：解析 details 内三行组的错峰间隔。 */
const STG_GROUP_STEP_MS = 60;
const STG_BAND: Partial<Record<SettingsTabId, number>> = { preview3d: 0 };
/** 第 i 个组的延迟值（band 缺省 0 = 首屏立即入场） */
const groupDelay = (band: number | undefined, i: number): number =>
  (band ?? 0) + stagger(i, STG_GROUP_STEP_MS);

/** 设置页平台态：桌面 / 安卓查看器 / 网页查看器（isViewer + isWebViewer 两 flag 表达三态，集中归一） */
type SettingsPlatform = "desktop" | "androidViewer" | "webViewer";

/** 路径相关卡片的平台能力单一事实源（ADR-307 D2 查实修正收口）：
 * 能力事实（哪张卡在哪些平台真能用）只在此声明，渲染函数与测试一律消费此处，不再各自手搓 flag。
 * - mc-path 与 storage 同走 directory-picker resolveAndroidRepoDir（Java 桥 requestStoragePermission →
 *   系统授权页 → 授权后定位 /storage/emulated/0/YSM-Model-Manager），是真授权入口，故同含 androidViewer；
 * - mc-path 网页版不渲染（指向 /web 虚拟根，与 webRepo FSA 卡语义重叠）；
 * - links/mirror 纯桌面/网络概念，查看器（安卓+网页）无意义。 */
const PATH_CARD_PLATFORMS: Record<"mc-path" | "links" | "mirror" | "storage", SettingsPlatform[]> =
  {
    "mc-path": ["desktop", "androidViewer"],
    links: ["desktop"],
    mirror: ["desktop"],
    storage: ["desktop", "androidViewer", "webViewer"],
  };

const resolveSettingsPlatform = (isViewer: boolean, isWebViewer: boolean): SettingsPlatform =>
  isWebViewer ? "webViewer" : isViewer ? "androidViewer" : "desktop";

const cardSupportedOn = (id: keyof typeof PATH_CARD_PLATFORMS, p: SettingsPlatform): boolean =>
  PATH_CARD_PLATFORMS[id].includes(p);

// ===== 镜像源 UI 映射（schema 语义值 → UI 值 / 文案键；ADR-307 D3 消费面收口）=====
// Record<MirrorSource, …> ⇒ MIRROR_SOURCES 加成员时此处编译期报错，逼出 option/hint 同步。
// 原模板三行 <option> 手写裸列 = schema 宣称「option 渲染单一来源」却未接线的半截工程：
// 加第四个镜像源会出现「schema 有、下拉框静默没有」。option 与 hint 块改由 MIRROR_SOURCES.map
// 派生（存在性 + 顺序随 schema）；direct 的 UI 值 = ""（存储层同，归一逻辑见 settings-schema.ts 注），
// 默认项（MIRROR_DEFAULT）hint 初始可见、其余 display:none（init.ts|applyMirrorHints 载入按实值纠正）。
const MIRROR_UI: Record<
  MirrorSource,
  { uiValue: string; optionKey: LocaleKey; hintKey: LocaleKey }
> = {
  direct: {
    uiValue: "",
    optionKey: "settings.mirror.directOption",
    hintKey: "settings.mirror.directHint",
  },
  jsdelivr: {
    uiValue: "jsdelivr",
    optionKey: "settings.mirror.jsdelivrOption",
    hintKey: "settings.mirror.jsdelivrHint",
  },
  githubapi: {
    uiValue: "githubapi",
    optionKey: "settings.mirror.nameGithubapi",
    hintKey: "settings.mirror.githubapiHint",
  },
};

/** 镜像源卡 body：option 行 + `mirror-hint-<语义值>` 说明块（id 与 init.ts|applyMirrorHints 的
 *  `mirror-hint-<MIRROR_SOURCES 成员>` 约定同源——改名即静默断链的双端在此钉死）。 */
function mirrorCardBody(): string {
  const options = MIRROR_SOURCES.map(
    (s) => `<option value="${MIRROR_UI[s].uiValue}">${t(MIRROR_UI[s].optionKey)}</option>`,
  ).join("\n          ");
  const hints = MIRROR_SOURCES.map(
    (s) =>
      `<div id="mirror-hint-${s}" class="stg-hint-block"${s === MIRROR_DEFAULT ? "" : ' style="display:none"'}>${t(MIRROR_UI[s].hintKey)}</div>`,
  ).join("\n        ");
  return `<select id="set-mirror" class="stg-select" style="width:100%;margin-bottom:6px">
          ${options}
        </select>
        ${hints}`;
}

// ===== 基础路径三卡（grid 成员）声明式 spec 表（2026-10 形态统一）=====
// 三卡原为「mc-path 单独 if / links+mirror 合并 if / storage 独立函数」三种手写形态并存，
// 加一张卡要挑对 if 写进去（无编译期护栏）。现统一经 spec 表 .map 产出：
// 加一张基础路径卡 = 写一个 spec 函数 + 表加一项 + PATH_CARD_PLATFORMS 加一行
// （后者 Record 键联合编译期强制平台声明）。storage 不参与本表——它 grid 下方独立全宽
// （webViewer 为 FSA 卡），形态与 grid 成员不同，仍走 renderStgStorageCard。
function mcPathCardSpec(): StgCardSpec {
  // 游戏根目录：桌面 + 安卓 viewer 通用（网页版不渲染，见 PATH_CARD_PLATFORMS）
  return {
    icon: UI_ICONS.game,
    title: t("settings.paths.gameRoot"),
    body: `<button type="button" class="stg-path-val" id="set-mc-path" data-testid="set-mc-path">${t("common.loading")}</button>
      <div class="stg-card-desc">${t("settings.paths.gameRootDesc")}</div>`,
    header: {
      actions: `<button class="btn-base sm" id="set-mc-detect">${UI_ICONS.search} ${t("settings.paths.autoSearch")}</button>`,
    },
  };
}

function linksCardSpec(): StgCardSpec {
  // 链接模式：纯桌面 / 网络概念，查看器模式无意义（网页版+安卓 viewer 均不渲染）。
  // hint 块排版走 .stg-hint-block（2026-10 收 6 处内联配方债）。
  // option / hint 值域由 settings-schema|LINK_MODES 派生（ADR-307 D3 扩编，与 MIRROR_UI 同口径）：
  // 加第四种链接模式只改 schema 一处，Record 文案表编译期逼出同步；默认 selected = LINK_MODE_DEFAULT。
  // hint 显隐与镜像源不同：模板里 lm-hint-* 全部 display:none（无默认可见项），
  // 由 init.ts|applyHintVisibility 按当前 linkMode 揭示对应项——保持原静态态，不改变观感。
  const LINK_UI: Record<
    LinkMode,
    { optionKey: LocaleKey; hintKey: LocaleKey; hintColor?: "error" }
  > = {
    copy: { optionKey: "settings.links.copy", hintKey: "settings.links.copyHint" },
    hardlink: { optionKey: "settings.links.hardlink", hintKey: "settings.links.hardlinkHint" },
    // symlink 的 hint 带错误色（与 copy/hardlink 中性提示区分——symlink 失败概率最高）
    symlink: {
      optionKey: "settings.links.symlink",
      hintKey: "settings.links.symlinkHint",
      hintColor: "error",
    },
  };
  const lmOptions = LINK_MODES.map(
    (m) =>
      `<option value="${m}"${m === LINK_MODE_DEFAULT ? " selected" : ""}>${t(LINK_UI[m].optionKey)}</option>`,
  ).join("\n      ");
  const lmHints = LINK_MODES.map((m) => {
    const text = t(LINK_UI[m].hintKey);
    const inner =
      LINK_UI[m].hintColor === "error"
        ? `<span style="color:var(--status-error)">${text}</span>`
        : text;
    return `<div id="lm-hint-${m}" class="stg-hint-block"${m === LINK_MODE_DEFAULT ? "" : ' style="display:none"'}>${inner}</div>`;
  }).join("\n    ");
  return {
    icon: UI_ICONS.link,
    title: t("settings.links.title"),
    body: `<select id="set-link-mode" class="stg-select" style="width:100%;margin-bottom:6px">
      ${lmOptions}
    </select>
    ${lmHints}`,
    header: {
      forId: "set-link-mode",
      actions: `<button id="set-relink" class="btn-base sm">${UI_ICONS.refresh} ${t("settings.links.reapply")}</button>`,
    },
  };
}

function mirrorCardSpec(): StgCardSpec {
  // 图标用 download 而非 web（globe 的别名）：`web` 与语言卡的 `globe` 引用同一 GLOBE_PATH
  // 常量（ui-icons.ts），渲染逐字节相同——同屏「语言」与「下载镜像源」曾是两个一模一样的
  // 地球，2026-09 那次「语义校正」只换了变量名、零视觉产出。镜像源 = 下载来源，用 download。
  return {
    icon: UI_ICONS.download,
    title: t("settings.mirror.title"),
    body: mirrorCardBody(),
    header: { forId: "set-mirror" },
  };
}

const BASIC_PATH_CARD_SPECS: ReadonlyArray<{
  id: keyof typeof PATH_CARD_PLATFORMS;
  spec: () => StgCardSpec;
}> = [
  { id: "mc-path", spec: mcPathCardSpec },
  { id: "links", spec: linksCardSpec },
  { id: "mirror", spec: mirrorCardSpec },
];

function renderStgBasicPaths(p: SettingsPlatform, startMs: number): string {
  // 路径三卡为同族组，入场延迟由 stgCards 按（平台过滤后的）序号派生（step 60ms，与其余组
  // 的 30ms 区分：首屏三张大卡节奏放缓一档）。2026-09 前为手填 0/60/120 字面量；
  // 2026-10 起 startMs 由 stgUnits 编排器按声明顺序注入（本 tab 首单元恒 0）。
  const specs = BASIC_PATH_CARD_SPECS.filter((it) => cardSupportedOn(it.id, p)).map((it) =>
    it.spec(),
  );
  const cards = stgCards(specs, { startMs, step: 60 });
  // viewer 模式（安卓 + 网页版）段标题统一为「文件来源」，桌面为「路径配置」——
  // 与「这里是可配置路径 vs 这里只有来源入口」语义对齐
  const title = t(p !== "desktop" ? "settings.paths.sourceTitle" : "settings.paths.title");
  if (!cards) {
    // 仅网页版无本地路径卡（mc-path/links/mirror 全关），仍输出「文件来源」节标题给下方 FSA 卡；
    // 安卓 viewer 现含 mc-path 授权卡，不再走此空分支
    return p === "webViewer"
      ? `<div class="section-title stg-title">${UI_ICONS.settings} ${title}</div>`
      : "";
  }
  return `<div class="section-title stg-title">${UI_ICONS.settings} ${title}</div>

<div class="stg-grid">
    ${cards}
  </div>`;
}

function renderStgStorageCard(p: SettingsPlatform, startMs: number): string {
  return p === "webViewer"
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
          delayMs: startMs,
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
          delayMs: startMs,
        },
      );
}

function renderStgLangSelect(startMs: number): string {
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

function renderStgThemePicker(startMs: number): string {
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
<div class="settings-group" style="animation-delay:${startMs}ms">
  <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
    <span class="label">${UI_ICONS.appearance} ${t("settings.theme.select")}</span>
    <div class="theme-picker" id="theme-picker">${cards}</div>
  </div>
</div>`;
}

function renderStgThemeAuto(startMs: number): string {
  // 自动模式 option 由 theme-core|THEME_AUTO_VALID 派生（白名单单一事实源；文案键经
  // THEME_AUTO_LABEL Record——加模式此处编译期报错，同 MIRROR_UI 口径）。
  const autoOptions = THEME_AUTO_VALID.map(
    (m) => `<option value="${m}">${t(THEME_AUTO_LABEL[m])}</option>`,
  ).join("\n      ");
  return `<!-- 自动切换：独立一栏 -->
<div class="settings-group" style="animation-delay:${startMs}ms">
  <div class="setting-row">
    <label for="theme-auto" class="label">${UI_ICONS.clock} ${t("settings.theme.autoTitle")}</label>
    <select id="theme-auto" class="stg-select" style="width:auto">
      ${autoOptions}
    </select>
  </div>
</div>`;
}

function renderStgFontFamily(startMs: number): string {
  // 三栏裸样式手写卡升格为 .stg-grid + .stgCard 正典卡（设置页样式范式契约待修债 #2）：
  // 原 <div style="background:var(--surf);border:..."> 三处间距/圆角/动画各自为政，已漂移；
  // 现与路径三卡同构（stg-grid 三列平铺，各卡 hdr 小标题 + body 控件）。
  // 字体三卡同族：延迟由序号派生（startMs 60 = 本组在「外观」tab 的入场档位，属页面级编排）。
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
        body: `<select id="set-font-size" class="stg-select" style="width:100%;margin-bottom:4px">
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
        body: `<select id="set-display-font" class="stg-select" style="width:100%;margin-bottom:6px">
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
        body: `<select id="set-card-density" class="stg-select" style="width:100%;margin-bottom:6px">
      ${densityOptions}
    </select>
    <div class="stg-desc">${t("settings.densityHint")}</div>`,
        header: { forId: "set-card-density", titleSize: "md" },
        cardId: "stg-font-density-card",
      },
    ],
    { startMs },
  );
  return `<div class="section-title stg-title">${UI_ICONS.geometry} ${t("settings.font.title")}</div>
<div class="stg-grid">
  ${fontCards}
</div>`;
}

function renderStgAnimationSection(startMs: number): string {
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

function renderStgDefaultPageSection(startMs: number): string {
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
      delayMs: startMs,
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

function renderStgPreview3d(startMs: number): string {
  // 2026-10 卡片流收口：三个 3D 设置行（相机速度 / 旋转模式 / 键位映射）自裸 .settings-group
  // 行组升格为 .stg-card 正典卡（与 env / appearance / about 各 tab 卡片口径统一）——
  // 行组范式「左右边缘与卡片/标题不齐 + 背景厚度不一」的视觉断裂收口。
  // 口径细则：
  //   ① 首卡自带 .stg-section 顶距（B 式，与 stg-card.ts|stgCard 同口径，防贴顶）；
  //   ② 卡内行组用 .stg-keybind-row 类（键位项专属：透明底 + 边框，避免标签/按钮共享
  //      厚重卡片背景，与 content-stg.ts|.stg-keybind-row 契约一致）；
  //   ③ 值域 / 默认值 / 枚举仍消费 settings-schema（ADR-303）：min/max/value/rotOptions
  //      全部 schema 派生，升卡不改数据面；
  //   ④ 入场延迟 2026-10 起由 stgUnits 编排器注入（本 tab 首单元 startMs=0，三卡组内
  //      step 60 → 0/60/120 大卡节奏，与升卡前 STG_BAND.preview3d 档位一致，不重排节奏）。
  // 测试钩子（td-camspeed / td-rotmode / td-keymap-grid / td-keymap-reset）全保留。
  // 旋转模式 option 由 schema 枚举派生（ROT_MODE_LABEL Record 锁文案键域，同 ADR-303 §2）。
  const rotOptions = TD_ROT_MODE.values
    .map((v) => `<option value="${v}">${t(ROT_MODE_LABEL[v])}</option>`)
    .join("\n        ");

  const camSpeedCard = stgCard(
    UI_ICONS.video,
    t("settings.preview3d.camSpeed"),
    `<div class="setting-row" style="background:none;padding:var(--sp-vh-pane);animation:none">
      <input type="range" id="td-camspeed" min="${TD_CAM_SPEED.min}" max="${TD_CAM_SPEED.max}" value="${TD_CAM_SPEED.default}" style="flex:1;accent-color:var(--accent,#7c83ff)">
      <span id="td-camspeed-val" style="min-width:28px;text-align:right;color:var(--txt)">${TD_CAM_SPEED.default}</span>
    </div>
    <div class="stg-card-desc">${t("settings.preview3d.camSpeedHint")}</div>`,
    {
      header: { spaceBetween: false, titleSize: "md" },
      cardId: "stg-camspeed-card",
      cardStyle: `animation-delay:${startMs}ms`,
    },
  );

  const rotModeCard = stgCard(
    UI_ICONS.refresh,
    t("settings.preview3d.rotMode"),
    `<div class="setting-row" style="background:none;padding:var(--sp-vh-pane);animation:none">
      <select id="td-rotmode" class="stg-select" style="width:auto">
        ${rotOptions}
      </select>
    </div>
    <div class="stg-card-desc">${t("settings.preview3d.rotModeHint")}</div>`,
    {
      header: { spaceBetween: false, titleSize: "md" },
      cardId: "stg-rotmode-card",
      marginTop: 8,
      cardStyle: `animation-delay:${startMs + 60}ms`,
    },
  );

  const keymapCard = stgCard(
    UI_ICONS.game,
    t("settings.preview3d.keymap"),
    `<div class="setting-row stg-keybind-row" style="align-items:flex-start;flex-direction:column;gap:8px;background:none;padding:var(--sp-vh-pane);animation:none">
      <div id="td-keymap-grid" class="stg-grid stg-keymap-grid" style="gap:8px"></div>
    </div>
    <div class="stg-card-desc" id="td-keymap-hint">${t("settings.preview3d.keymapHint")}</div>
    <div style="margin-top:8px"><button class="btn-base sm" id="td-keymap-reset">${UI_ICONS.undo} ${t("settings.preview3d.resetKeys")}</button></div>`,
    {
      header: { spaceBetween: false, titleSize: "md" },
      cardId: "stg-keymap-card",
      marginTop: 8,
      cardStyle: `animation-delay:${startMs + 120}ms`,
    },
  );

  // 三卡平铺（与字体三卡同构）；.stg-section 首组顶距由 camSpeedCard 的 stg-section 承载
  return `<div class="stg-section">${camSpeedCard}
${rotModeCard}
${keymapCard}
</div>`;
}

function renderStgParserWorkers(): string {
  return `<details class="stg-details stg-parser-details">
  <summary class="stg-details-summary">${UI_ICONS.parser} ${t("settings.parser")}</summary>
  <div class="stg-details-body">
    <div class="settings-group" style="animation-delay:${groupDelay(STG_BAND.preview3d, 0)}ms">
      <div class="stg-desc">${t("settings.parserDesc")}</div>
    </div>

    <div class="settings-group" style="animation-delay:${groupDelay(STG_BAND.preview3d, 1)}ms">
      <div class="setting-row">
        <span class="label" id="stg-fbx-worker-label">${UI_ICONS.parser} ${t("settings.preview3d.fbxWorker")}</span>
        <label class="stg-label" for="set-fbx-worker" style="gap:8px">
          <input type="checkbox" id="set-fbx-worker" aria-labelledby="stg-fbx-worker-label stg-fbx-worker-action" aria-describedby="stg-fbx-worker-hint">
          <span id="stg-fbx-worker-action">${t("settings.preview3d.workerCheck")}</span>
        </label>
      </div>
      <div class="stg-desc" id="stg-fbx-worker-hint">${t("settings.preview3d.fbxWorkerHint")}</div>
    </div>

    <div class="settings-group" style="animation-delay:${groupDelay(STG_BAND.preview3d, 2)}ms">
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
  const p = resolveSettingsPlatform(isViewer, isWebPlatform());

  // ===== 各 tab 按有序单元表编排（stgUnits：声明顺序即档位，2026-10 方案 A）=====
  // 渲染函数不再手填 startMs/delayMs——stgUnits 按声明顺序自动累加槽位派生并传入
  // render(startMs)。加卡/加组 = 表加一项，零手算、零撞车（槽位规则见 stg-card.ts|stgUnits）。
  // 环境 tab：路径卡组（桌面三卡 0/60/120；安卓仅 mc-path 一卡；网页零卡）→ 存储卡 → 启动默认页
  // 卡组槽数随平台派生（PATH_CARD_PLATFORMS 过滤后实卡数）——stgUnits 据此推进后续档位
  const pathCardCount = BASIC_PATH_CARD_SPECS.filter((it) => cardSupportedOn(it.id, p)).length;
  const envBody = stgUnits([
    {
      cardCount: pathCardCount,
      cardStep: 60,
      render: (startMs) => renderStgBasicPaths(p, startMs),
    },
    { render: (startMs) => renderStgStorageCard(p, startMs) },
    { render: (startMs) => renderStgDefaultPageSection(startMs) },
  ]);

  // 语言卡归「外观」（显示偏好），排在字体与布局之后、行为与动画之前
  // 外观 tab：主题选择器（行组）→ 主题自动（行组）→ 字体三卡（卡组 cardCount 3）→ 语言 → 动画
  const appearanceBody = `<div class="section-title stg-title">${UI_ICONS.moon} ${t("settings.theme.title")}</div>

${stgUnits([
  { render: (startMs) => renderStgThemePicker(startMs) },
  { render: (startMs) => renderStgThemeAuto(startMs) },
  { cardCount: 3, render: (startMs) => renderStgFontFamily(startMs) },
  { render: (startMs) => renderStgLangSelect(startMs) },
  { render: (startMs) => renderStgAnimationSection(startMs) },
])}`;

  // 「3D 预览」tab = 3D 预览设置（相机/旋转/键位）+ 解析（FBX/MMD worker 开关，2026-10 自
  // 独立「解析」tab 降级并入）——3D 域设置一处收口；「解析」节标题因此不再与 tab 名同名重复。
  // preview3d tab：三张 3D 设置卡（卡组，cardStep 60 大卡节奏）→ 解析 details（折叠区，
  // 内部另起 0 档——展开时才播，不参与首屏竞争）
  const previewBody = stgUnits([
    { cardCount: 3, cardStep: 60, render: (startMs) => renderStgPreview3d(startMs) },
    { render: () => renderStgParserWorkers() },
  ]);

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
