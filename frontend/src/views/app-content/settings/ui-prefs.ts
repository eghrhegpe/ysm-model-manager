// ===== 设置页：界面与体验设置（ADR-040 拆分自 init.ts）=====
// 读取/应用 UI 偏好（localStorage），统一走 safeGet/safeSet——
// 隐私模式（存储禁用）下抛错会中断 initSettings（applyUIPref 是 init 同步执行的一部分）。
import { bus } from "../../../bus.ts";
import { t } from "../../../core/i18n/t.ts";
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import { TOAST_MS } from "../../../utils/dom/toast-ms.ts";

// 魔法数值收敛：偏好变更成功 toast 展示时长（ms）
const TOAST_DURATION_MS = TOAST_MS.quick;

/** 应用 UI 偏好到 CSS 变量（字号/字体/密度/动画）——启动链与设置页共用（ADR-040 拆分去重） */
export function applyUIPrefs(): void {
  const fontSize = safeGet("ui-font-size") || "normal";
  const displayFont = safeGet("ui-display-font") || "kaiti";
  const density = safeGet("ui-card-density") || "compact";
  const anim = safeGet("ui-animations") !== "off";

  // 基准字号 — 通过 --fs-scale 控制，CSS 自动缩放所有 --fs-* 和 --space-*
  // 先清除旧版直接设 --fs-* 的内联值（避免覆盖 calc()）
  [
    "--fs-base",
    "--fs-xs",
    "--fs-sm",
    "--fs-md",
    "--fs-lg",
    "--fs-tiny",
    "--fs-xl",
  ].forEach((v) => document.documentElement.style.removeProperty(v));
  // 小=-1px, 标准=0px, 大=+2px
  const scaleMap: Record<string, string> = { small: "-1px", normal: "0px", large: "2px" };
  document.documentElement.style.setProperty("--fs-scale", scaleMap[fontSize] || "0px");
  // 同步更新 --fs-base-size（保持各字号参考基准一致）
  document.documentElement.style.setProperty("--fs-base-size", "12px");

  // 创作者名字字体
  document.documentElement.style.setProperty(
    "--font-display",
    displayFont === "system" ? "var(--font-ui)" : "'STKaiti','KaiTi','楷体',serif",
  );

  // 卡片密度
  const padding = density === "compact" ? "6px 10px" : "10px 14px";
  document.documentElement.style.setProperty("--card-padding", padding);
  const cardGap = density === "compact" ? "6px" : "10px";
  document.documentElement.style.setProperty("--card-gap", cardGap);

  // 动画
  document.documentElement.classList.toggle("no-animations", !anim);
}

/** 初始化界面与体验设置：应用偏好 + 绑定字号/字体/密度/动画/默认页变更 */
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
    d.style.paddingTop = "var(" + varName + ")";
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
    const btnH = Math.round(smPx * 2 + smFontPx * 1.4) + "px";

    const szBase = root.querySelector("#sz-base");
    const szSpace = root.querySelector("#sz-space");
    const szBtn = root.querySelector("#sz-btn-h");
    if (szBase) szBase.textContent = basePx ? Math.round(basePx) + "px" : base;
    if (szSpace) szSpace.textContent = mdPx ? Math.round(mdPx) + "px" : spaceMd;
    if (szBtn) szBtn.textContent = btnH;
  };

  // 初始化 UI 控件值
  root.getElementById("set-font-size") &&
    ((root.getElementById("set-font-size") as HTMLSelectElement).value =
      safeGet("ui-font-size") || "normal");
  root.getElementById("set-display-font") &&
    ((root.getElementById("set-display-font") as HTMLSelectElement).value =
      safeGet("ui-display-font") || "kaiti");
  root.getElementById("set-card-density") &&
    ((root.getElementById("set-card-density") as HTMLSelectElement).value =
      safeGet("ui-card-density") || "compact");
  root.getElementById("set-animations") &&
    ((root.getElementById("set-animations") as HTMLInputElement).checked =
      safeGet("ui-animations") !== "off");
  // 启动默认页面：显示「实际生效」的值——有显式配置用配置，否则回退
  // resolveInitialPage 的默认结果（仓库页）。旧写法 || "instances" 会显示
  // 一个从未生效的死默认值，与真实启动页不符（死设置遗留 bug）。
  root.getElementById("set-default-page") &&
    ((root.getElementById("set-default-page") as HTMLSelectElement).value =
      safeGet("ui-default-page") || "repository");

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
    safeSet("ui-card-density", (e.target as HTMLSelectElement).value);
    applyUIPref();
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

  // 默认页面变更
  root.getElementById("set-default-page")?.addEventListener("change", (e) => {
    safeSet("ui-default-page", (e.target as HTMLSelectElement).value);
    bus.emit("toast:show", {
      msg: t("settings.ui.defaultPageSaved"),
      duration: TOAST_DURATION_MS,
      type: "success",
    });
  });
}
