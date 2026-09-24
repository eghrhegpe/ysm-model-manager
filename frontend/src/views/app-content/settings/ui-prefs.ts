// ===== 设置页：外观/界面偏好设置（ADR-040 拆分自 init.ts）=====
// 读取/应用 UI 偏好（localStorage），统一走 safeGet/safeSet——
// 隐私模式（存储禁用）下抛错会中断 initSettings（applyUIPref 是 init 同步执行的一部分）。
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import {
  ROW_H_GRID_COMPACT,
  ROW_H_GRID_NORMAL,
  ROW_H_LIST_COMPACT,
  ROW_H_LIST_NORMAL,
} from "@/views/app-tree/render.ts";

// 魔法数值收敛：偏好变更成功 toast 展示时长（ms）
const TOAST_DURATION_MS = TOAST_MS.quick;

/** 应用 UI 偏好到 CSS 变量（字号/字体/密度/动画）——启动链与设置页共用（ADR-040 拆分去重） */
export function applyUIPrefs(): void {
  const fontSize = safeGet("ui-font-size") || "normal";
  const displayFont = safeGet("ui-display-font") || "kaiti";
  const density = safeGet("ui-card-density") || "compact";
  const anim = safeGet("ui-animations") !== "off";

  // 基准字号 — 通过 --fs-scale 控制，CSS 自动缩放所有 --fs-*（含语义字号）与 --space-*
  // 先清除旧版直接设 --fs-* 的内联值（避免覆盖 calc()）
  [
    "--fs-base-size",
    "--fs-base",
    "--fs-xs",
    "--fs-sm",
    "--fs-md",
    "--fs-lg",
    "--fs-tiny",
    "--fs-xl",
  ].forEach((v) => {
    document.documentElement.style.removeProperty(v);
  });
  // 五档偏移：极小 −2px / 小 −1px / 标准 0 / 大 +1px / 很大 +2px
  const scaleMap: Record<string, string> = {
    xsmall: "-2px",
    small: "-1px",
    normal: "0px",
    medium: "1px",
    large: "2px",
  };
  document.documentElement.style.setProperty("--fs-scale", scaleMap[fontSize] || "0px");
  // --fs-base-size（真基准）单点定义在 frontend/css/variables.css 的 :root，此处不再内联覆盖

  // 创作者名字字体
  document.documentElement.style.setProperty(
    "--font-display",
    displayFont === "system" ? "var(--font-ui)" : "'STKaiti','KaiTi','楷体',serif",
  );

  // 卡片密度：纵向/横向两分量各出变量，--card-padding 由二者拼出（单一事实源），
  // 使「需要单独用水平分量」的场景（如侧栏选中态补偿边框）不必再抄一份 10px/14px 字面量。
  const padY = density === "compact" ? "6px" : "10px";
  const padX = density === "compact" ? "10px" : "14px";
  document.documentElement.style.setProperty("--card-pad-y", padY);
  document.documentElement.style.setProperty("--card-pad-x", padX);
  document.documentElement.style.setProperty("--card-padding", `${padY} ${padX}`);
  const cardGap = density === "compact" ? "6px" : "10px";
  document.documentElement.style.setProperty("--card-gap", cardGap);
  // 树行高同源变量（grid/list 两档）：数值单一事实源在 app-tree/render.ts 的
  // ROW_H_* 常量（JS 虚拟滚动行高与 CSS height 共用同一组数字），此处只做 px 字符串化注入。
  // 这样「改 JS 行高忘改 CSS」不可能发生——见 render.ts rowHeightGrid/List。
  const isCompact = density === "compact";
  document.documentElement.style.setProperty(
    "--tree-row-grid",
    `${isCompact ? ROW_H_GRID_COMPACT : ROW_H_GRID_NORMAL}px`,
  );
  document.documentElement.style.setProperty(
    "--tree-row-list",
    `${isCompact ? ROW_H_LIST_COMPACT : ROW_H_LIST_NORMAL}px`,
  );

  // 动画
  document.documentElement.classList.toggle("no-animations", !anim);
}

/** 初始化外观设置：应用偏好 + 绑定字号/字体/密度/动画/默认页变更 */
export function initUiPrefs(root: ShadowRoot): void {
  const applyUIPref = (): void => {
    applyUIPrefs();
    // 更新字号预览值
    updateSizePreview();
  };

  /**
   * 解析 CSS 变量的计算像素值（getComputedStyle 对 calc() 返回原始表达式，
   * 需要间接通过真实 CSS 属性读取）
   */
  const resolvePx = (varName: string): string => {
    const d = document.body;
    const orig = d.style.paddingTop;
    d.style.paddingTop = `var(${varName})`;
    const val = getComputedStyle(d).paddingTop;
    d.style.paddingTop = orig;
    return val;
  };

  /**
   * 读取当前 --fs-* 和 --space-* 的计算值并显示
   */
  const updateSizePreview = (): void => {
    const base = resolvePx("--fs-base");
    const spaceMd = resolvePx("--space-md");
    const spaceSm = resolvePx("--space-sm");
    const fsSm = resolvePx("--fs-sm");

    // 按钮高示例：secondary 按钮 = padding-v(space-sm) * 2 + font-size * 1.4
    const basePx = parseFloat(base);
    const mdPx = parseFloat(spaceMd);
    const smPx = parseFloat(spaceSm);
    const smFontPx = parseFloat(fsSm);
    const btnH = `${Math.round(smPx * 2 + smFontPx * 1.4)}px`;

    const szBase = root.querySelector("#sz-base");
    const szSpace = root.querySelector("#sz-space");
    const szBtn = root.querySelector("#sz-btn-h");
    if (szBase) szBase.textContent = basePx ? `${Math.round(basePx)}px` : base;
    if (szSpace) szSpace.textContent = mdPx ? `${Math.round(mdPx)}px` : spaceMd;
    if (szBtn) szBtn.textContent = btnH;
  };

  // 初始化 UI 控件值（2026-09 锐评 P3：`&&` 空值短路 + 重复 getElementById + 双断言 → 守卫赋值，
  // 与本文件其余 `if (el)` 惯例对齐）
  const fontSizeSel = root.querySelector<HTMLSelectElement>("#set-font-size");
  if (fontSizeSel) fontSizeSel.value = safeGet("ui-font-size") || "normal";
  const displayFontSel = root.querySelector<HTMLSelectElement>("#set-display-font");
  if (displayFontSel) displayFontSel.value = safeGet("ui-display-font") || "kaiti";
  const cardDensitySel = root.querySelector<HTMLSelectElement>("#set-card-density");
  if (cardDensitySel) cardDensitySel.value = safeGet("ui-card-density") || "compact";
  const animationsInput = root.querySelector<HTMLInputElement>("#set-animations");
  if (animationsInput) animationsInput.checked = safeGet("ui-animations") !== "off";
  // 启动默认页面（记忆开关 + 固定页下拉框二态回填）已收编至 default-page.ts：
  // initDefaultPagePrefs——曾在此处裸写 `safeGet(...) || "repository"`，
  // 该 `||` 会把空串当成仓库页显示，与其真实启动行为（落回 nav_page）不符。

  applyUIPref();

  // 基准字号变更
  root.getElementById("set-font-size")?.addEventListener("change", (e) => {
    safeSet("ui-font-size", (e.target as HTMLSelectElement).value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: t("settings.ui.fontSizeUpdated"),
      duration: TOAST_DURATION_MS,
      type: "success",
    });
  });

  // 创作者字体变更
  root.getElementById("set-display-font")?.addEventListener("change", (e) => {
    safeSet("ui-display-font", (e.target as HTMLSelectElement).value);
    applyUIPref();
    bus.emit("toast:show", {
      msg: t("settings.ui.fontUpdated"),
      duration: TOAST_DURATION_MS,
      type: "success",
    });
  });

  // 卡片密度变更
  root.getElementById("set-card-density")?.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value === "normal" ? "normal" : "compact";
    safeSet("ui-card-density", val);
    applyUIPref();
    // 广播密度变更：app-tree 订阅后重排虚拟滚动（行高随密度变化需重算），
    // 整合包侧栏/旧式卡片为纯 CSS 变量驱动，setProperty 即时生效无需重排。
    bus.emit("ui:card-density", { density: val });
    bus.emit("toast:show", {
      msg: t("settings.ui.densityUpdated"),
      duration: TOAST_DURATION_MS,
      type: "success",
    });
  });

  // 动画开关
  root.getElementById("set-animations")?.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    safeSet("ui-animations", checked ? "on" : "off");
    applyUIPref();
    bus.emit("toast:show", {
      msg: checked ? t("settings.ui.animOn") : t("settings.ui.animOff"),
      duration: TOAST_DURATION_MS,
      type: "success",
    });
  });

  // 默认页面变更已收编至 default-page.ts:initDefaultPagePrefs（与记忆开关联动，单源）
}
