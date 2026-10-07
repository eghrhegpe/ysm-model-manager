// ===== tpl-settings-preview3d.ts — 设置页「3D 预览」tab 模板（3D 设置卡 + 解析 workers 折叠区）=====
// 来源：从 frontend/src/views/app-content/settings/tpl-settings.ts 拆出（ADR-040 P1 分片收口）。
// 职责：preview3d tab 的模板渲染——相机速度 / 旋转模式 / 键位映射三张正典卡，以及「解析」
//       折叠区（FBX / MMD worker 两个开关，2026-10 自独立「解析」tab 降级并入）。
//       组入场延迟编排（STG_GROUP_STEP_MS / STG_BAND / groupDelay）随之迁入——它们只被
//       renderStgParserWorkers 消费，留在主文件会让分片反向 import 主文件造成运行时环。
// 拆分日期：2026-10-07。只搬移不改行为：所有 render* 函数与常量逐字保留，仍返回 string
//       （R8 不新增 HTML 字面量到非模板文件——本文件仍是模板文件）。
// 值域枚举单一来源 = preview-3d/infra/settings-schema.ts（TD_CAM_SPEED / TD_ROT_MODE，ADR-303），
//   文案键归本面 ROT_MODE_LABEL Record（schema 加模式此处编译期报错）。
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { TD_CAM_SPEED, TD_ROT_MODE, type TdRotMode } from "@/preview-3d/infra/settings-schema.ts";
import { stagger } from "@/utils/animation/stagger.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { stgCard } from "./stg-card.ts";
import type { SettingsTabId } from "./tpl-settings.ts";

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

/** 旋转模式 → 设置页文案键（ADR-303 §2：schema 只供值，文案键域归各面）。
 *  `Record<TdRotMode, LocaleKey>` 形态——schema 新增模式时此处编译期报错，逼出文案同步。 */
const ROT_MODE_LABEL: Record<TdRotMode, LocaleKey> = {
  orbit: "settings.preview3d.orbit",
  free: "settings.preview3d.free",
};

export function renderStgPreview3d(startMs: number, cardStep: number): string {
  // 2026-10 卡片流收口：三个 3D 设置行（相机速度 / 旋转模式 / 键位映射）自裸 .settings-group
  // 行组升格为 .stg-card 正典卡（与 env / appearance / about 各 tab 卡片口径统一）——
  // 行组范式「左右边缘与卡片/标题不齐 + 背景厚度不一」的视觉断裂收口。
  // 口径细则：
  //   ① 首卡自带 .stg-section 顶距（B 式，与 stg-card.ts|stgCard 同口径，防贴顶）；
  //   ② 卡内行组用 .stg-keybind-row 类（键位项专属：透明底 + 边框，避免标签/按钮共享
  //      厚重卡片背景，与 content-stg.ts|.stg-keybind-row 契约一致）；
  //   ③ 值域 / 默认值 / 枚举仍消费 settings-schema（ADR-303）：min/max/value/rotOptions
  //      全部 schema 派生，升卡不改数据面；
  //   ④ 入场延迟 2026-10 起由 stgUnits 注入：startMs 为本 tab 首单元起始（0），组内步长
  //      = 单元表 cardStep（60）→ 0/60/120 大卡节奏，与升卡前 STG_BAND.preview3d 档位一致；
  //      ⚠️ 步长经 stgUnits 传入（cardStep 参数）——禁止内部硬编码 +60/+120（2026-10 P1-2：
  //      曾「单元表声明 cardStep + 内部硬编码」双源，改步长一处不跟、details 起始撞车且
  //      测试 details 剔除正则掩盖）。
  // 测试钩子（td-camspeed / td-rotmode / td-keymap-grid / td-keymap-reset）全保留。
  // 旋转模式 option 由 schema 枚举派生（ROT_MODE_LABEL Record 锁文案键域，同 ADR-303 §2）。
  const rotOptions = TD_ROT_MODE.values
    .map((v) => `<option value="${v}">${t(ROT_MODE_LABEL[v])}</option>`)
    .join("\n        ");

  const camSpeedCard = stgCard(
    UI_ICONS.camera,
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
      <select id="td-rotmode" class="stg-select">
        ${rotOptions}
      </select>
    </div>
    <div class="stg-card-desc">${t("settings.preview3d.rotModeHint")}</div>`,
    {
      header: { spaceBetween: false, titleSize: "md" },
      cardId: "stg-rotmode-card",
      marginTop: 8,
      cardStyle: `animation-delay:${startMs + cardStep}ms`,
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
      cardStyle: `animation-delay:${startMs + 2 * cardStep}ms`,
    },
  );

  // 三卡平铺（与字体三卡同构）；.stg-section 首组顶距由 camSpeedCard 的 stg-section 承载
  return `<div class="stg-section">${camSpeedCard}
${rotModeCard}
${keymapCard}
</div>`;
}

export function renderStgParserWorkers(): string {
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
