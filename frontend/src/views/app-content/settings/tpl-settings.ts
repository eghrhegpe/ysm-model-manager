// ===== tpl-settings.ts — settingsHTML 页面模板（从 tpl.ts 拆出，ADR-040 P1 第2轮拆分）=====
// env + appearance + preview3d 标签页在此；aboutUpdate（含鸣谢小节）已拆至 tpl-settings-about.ts。
// 2026-10-07 分片收口：三个 tab 的渲染函数迁至同目录兄弟文件（本文件只保留编排入口）——
//   · env（路径卡 + 存储卡 + PATH_CARD_PLATFORMS 平台事实）→ tpl-settings-path.ts
//   · appearance（语言 + 主题 + 字体 + 动画 + 默认页）→ tpl-settings-appearance.ts
//   · preview3d（3D 设置卡 + 解析 workers 折叠区 + 组入场延迟编排）→ tpl-settings-preview3d.ts
//   编排逻辑（settingsHTML 内的 stgUnits 单元表 + buildSettingsTabs）照旧，只改 import 来源。
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
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { renderTabs, type TabSpec } from "@/views/app-content/tabs-shell.ts";
import { stgUnits } from "./stg-card.ts";
import { aboutPageBody } from "./tpl-settings-about.ts";
import {
  renderStgAnimationSection,
  renderStgDefaultPageSection,
  renderStgFontFamily,
  renderStgLangSelect,
  renderStgThemeAuto,
  renderStgThemePicker,
} from "./tpl-settings-appearance.ts";
import {
  BASIC_PATH_CARD_SPECS,
  cardSupportedOn,
  renderStgBasicPaths,
  renderStgStorageCard,
  resolveSettingsPlatform,
} from "./tpl-settings-path.ts";
import { renderStgParserWorkers, renderStgPreview3d } from "./tpl-settings-preview3d.ts";

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

/** 设置页平台态：桌面 / 安卓查看器 / 网页查看器（isViewer + isWebViewer 两 flag 表达三态，集中归一）
 *  ——平台能力事实与其消费函数（resolveSettingsPlatform / cardSupportedOn / PATH_CARD_PLATFORMS）
 *  已下沉 tpl-settings-path.ts 收口（ADR-307 D2）；本文件仅保留类型定义供各分片 type-only 引用。 */
export type SettingsPlatform = "desktop" | "androidViewer" | "webViewer";

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
      render: (startMs, cardStep) => renderStgBasicPaths(p, startMs, cardStep),
    },
    { render: (startMs) => renderStgStorageCard(p, startMs) },
    { render: (startMs) => renderStgDefaultPageSection(startMs) },
  ]);

  // 语言卡归「外观」（显示偏好），排在字体与布局之后、行为与动画之前
  // 外观 tab：主题选择器（行组）→ 主题自动（行组）→ 字体三卡（卡组 cardCount 3）→ 语言 → 动画
  const appearanceBody = `<div class="section-title stg-title">${UI_ICONS.appearance} ${t("settings.theme.title")}</div>

${stgUnits([
  { render: (startMs) => renderStgThemePicker(startMs) },
  { render: (startMs) => renderStgThemeAuto(startMs) },
  {
    cardCount: 3,
    cardStep: 30,
    render: (startMs, cardStep) => renderStgFontFamily(startMs, cardStep),
  },
  { render: (startMs) => renderStgLangSelect(startMs) },
  { render: (startMs) => renderStgAnimationSection(startMs) },
])}`;

  // 「3D 预览」tab = 3D 预览设置（相机/旋转/键位）+ 解析（FBX/MMD worker 开关，2026-10 自
  // 独立「解析」tab 降级并入）——3D 域设置一处收口；「解析」节标题因此不再与 tab 名同名重复。
  // preview3d tab：三张 3D 设置卡（卡组，cardStep 60 大卡节奏）→ 解析 details（折叠区，
  // 内部另起 0 档——展开时才播，不参与首屏竞争）
  const previewBody = stgUnits([
    {
      cardCount: 3,
      cardStep: 60,
      render: (startMs, cardStep) => renderStgPreview3d(startMs, cardStep),
    },
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
