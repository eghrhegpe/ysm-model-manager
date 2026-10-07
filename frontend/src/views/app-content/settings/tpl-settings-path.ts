// ===== tpl-settings-path.ts — 设置页「环境」tab 模板（路径卡 + 存储卡 + 启动默认页编排所需事实）=====
// 来源：从 frontend/src/views/app-content/settings/tpl-settings.ts 拆出（ADR-040 P1 分片收口）。
// 职责：环境 tab 的模板渲染——基础路径三卡（mc-path/links/mirror，spec 表驱动）与存储卡
//       （桌面+安卓 viewer 常规卡 / webViewer FSA 卡），以及 PATH_CARD_PLATFORMS 平台能力事实。
// 拆分日期：2026-10-07。只搬移不改行为：所有 render* 函数逐字保留，仍返回 string（R8 不新增
//       HTML 字面量到非模板文件——本文件仍是模板文件）。
// 与 SettingsPlatform 类型关系：类型定义留在 tpl-settings.ts（各分片 import），本文件仅 type-only
//       引用，编译期擦除、不构成运行时环；平台能力事实（PATH_CARD_PLATFORMS / cardSupportedOn /
//       resolveSettingsPlatform）与其消费函数同文件收口（ADR-307 D2）。
import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import {
  LINK_MODE_DEFAULT,
  LINK_MODES,
  MIRROR_DEFAULT,
  MIRROR_SOURCES,
} from "./settings-schema.ts";
import { type StgCardSpec, stgCard, stgCards } from "./stg-card.ts";
import type { SettingsPlatform } from "./tpl-settings.ts";
import { LINK_MODE_UI, MIRROR_UI } from "./ui-maps.ts";

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

export const resolveSettingsPlatform = (
  isViewer: boolean,
  isWebViewer: boolean,
): SettingsPlatform => (isWebViewer ? "webViewer" : isViewer ? "androidViewer" : "desktop");

export const cardSupportedOn = (
  id: keyof typeof PATH_CARD_PLATFORMS,
  p: SettingsPlatform,
): boolean => PATH_CARD_PLATFORMS[id].includes(p);

// ===== 镜像源卡 body（值→文案映射在 ui-maps.ts|MIRROR_UI，模板消费派生渲染）=====
// option 与 hint 块由 MIRROR_SOURCES.map 派生（存在性 + 顺序随 schema；加成员编译期逼出
// ui-maps 文案同步）；默认项（MIRROR_DEFAULT）hint 初始可见、其余 display:none
//（init.ts|applyMirrorHints 载入按实值纠正）。
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
  return `<select id="set-mirror" class="stg-select stg-select-block">
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

// ===== 链接模式卡：option 由 LINK_MODES 派生，值→文案表在 ui-maps.ts|LINK_MODE_UI =====
// （与 toast/确认框共用单表，2026-10 迁 ui-maps——多消费面共享映射不再住模板文件）
function linksCardSpec(): StgCardSpec {
  // 链接模式：纯桌面 / 网络概念，查看器模式无意义（网页版+安卓 viewer 均不渲染）。
  // hint 块排版走 .stg-hint-block（2026-10 收 6 处内联配方债）。
  // hint 显隐：模板里仅默认档（copy）可见，其余 display:none；init.ts|applyHintVisibility 按
  // 当前 linkMode 揭示对应项（与镜像源同口径。旧注释称「全部 display:none、无默认可见项」，
  // 与实现和 tpl.test.ts 断言相反，属 2026-10 收债期的过期描述，一并校正）。
  const lmOptions = LINK_MODES.map(
    (m) =>
      `<option value="${m}"${m === LINK_MODE_DEFAULT ? " selected" : ""}>${t(LINK_MODE_UI[m].labelKey)}</option>`,
  ).join("\n      ");
  const lmHints = LINK_MODES.map((m) => {
    const text = t(LINK_MODE_UI[m].hintKey);
    const inner =
      LINK_MODE_UI[m].hintColor === "error"
        ? `<span style="color:var(--status-error)">${text}</span>`
        : text;
    return `<div id="lm-hint-${m}" class="stg-hint-block"${m === LINK_MODE_DEFAULT ? "" : ' style="display:none"'}>${inner}</div>`;
  }).join("\n    ");
  return {
    icon: UI_ICONS.link,
    title: t("settings.links.title"),
    body: `<select id="set-link-mode" class="stg-select stg-select-block">
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

export const BASIC_PATH_CARD_SPECS: ReadonlyArray<{
  id: keyof typeof PATH_CARD_PLATFORMS;
  spec: () => StgCardSpec;
}> = [
  { id: "mc-path", spec: mcPathCardSpec },
  { id: "links", spec: linksCardSpec },
  { id: "mirror", spec: mirrorCardSpec },
];

export function renderStgBasicPaths(
  p: SettingsPlatform,
  startMs: number,
  cardStep: number,
): string {
  // 路径三卡为同族组，入场延迟由 stgCards 按（平台过滤后的）序号派生（组内步长 = 单元表
  // cardStep 60，首屏三张大卡节奏放缓一档；2026-09 前为手填 0/60/120 字面量）。
  // 2026-10 起 startMs/cardStep 均由 stgUnits 注入（本 tab 首单元 startMs 恒 0；
  // ⚠️ 步长经 stgUnits 传入——禁止内部硬编码 step:60 造成「单元表声明 + 内部步长」双源）。
  const specs = BASIC_PATH_CARD_SPECS.filter((it) => cardSupportedOn(it.id, p)).map((it) =>
    it.spec(),
  );
  const cards = stgCards(specs, { startMs, step: cardStep });
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

export function renderStgStorageCard(p: SettingsPlatform, startMs: number): string {
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
