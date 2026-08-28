// ===== 3D 预览声明式 Schema 构建器（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// schemaBuilders 五个构建器：camera / lighting / shadow / postproc / settings。
// bs* 系列为 settings 面板节点工厂；cap 缺席时渲染单行提示行，不空白。

import type { PreviewMenuNode } from "./preview-menu-node-types.ts";
import { renderCapControls } from "./preview-menu-cap-controls.ts";
import { buildCameraControls } from "./camera-controls.ts";
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
import { safeSet } from "../../../utils/dom/storage.ts";
import { t } from "../../../core/i18n/t.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { isFrustumCullEnabled, setFrustumCullEnabled } from "../frustum-cull.ts";
import type { WireframeCapability } from "../caps/wireframe-capability.ts";
import {
  getMaxFps,
  invalidateMaxFpsCache,
  MAX_FPS_KEY,
  getMaxPixelRatio,
  MAX_PIXEL_RATIO_KEY,
} from "../render-budget.ts";
import type { PreviewMenuCtx } from "./preview-menu.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名 */
const tr = (key: string, fallback: string): string => {
  const v = t(key);
  return v === key ? fallback : v;
};

// ── 声明式 Schema 构建器（供 schemaBuilders 映射调用）──

/** 相机面板 schema：wrap buildCameraControls 为声明式节点 */
export function buildCameraSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  return [{
    id: "camera",
    kind: "custom",
    labelKey: "preview.cameraView",
    fallback: "视图",
    icon: "🎥",
    renderCustom: (list: HTMLElement): void => {
      buildCameraControls(list, ctx.getCamBridge());
    },
  }];
}

/** 灯光面板 schema：从 light cap 自报控件渲染 */
export function buildLightingSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const lightFromReg = sceneCapabilityRegistry.getById("light") as import("../caps/light-capability.ts").LightCapability | null;
  const lightCap = lightFromReg ?? (() => {
    const fromCtx = ctx.getCap("light");
    if (fromCtx && "getMenuControls" in fromCtx) return fromCtx as unknown as import("../caps/light-capability.ts").LightCapability;
    return null;
  })();
  if (!lightCap) {
    return [{ id: "lighting-empty", kind: "custom", renderCustom: (list) => {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      row.textContent = tr("preview.noLightCap", "进入 3D 后再打开灯光面板");
      list.appendChild(row);
    }}];
  }
  return [{ id: "lighting", kind: "custom", renderCustom: (list) => {
    renderCapControls(list, lightCap.getMenuControls());
  }}];
}

/** 阴影面板 schema：从 shadow cap 自报控件渲染 */
export function buildShadowSchema(_ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const fromReg = sceneCapabilityRegistry.getById("shadow") as import("../caps/shadow-capability.ts").ShadowCapability | null;
  if (!fromReg) {
    return [{ id: "shadow-empty", kind: "custom", renderCustom: (list) => {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      row.textContent = tr("preview.noShadowCap", "进入 3D 后再打开阴影面板");
      list.appendChild(row);
    }}];
  }
  return [{ id: "shadow", kind: "custom", renderCustom: (list) => {
    renderCapControls(list, fromReg.getMenuControls());
  }}];
}

/** 后处理面板 schema：从 postprocessing cap 自报控件渲染 */
export function buildPostprocessingSchema(_ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const fromReg = sceneCapabilityRegistry.getById("postprocessing") as import("../caps/postprocessing-capability.ts").PostprocessingCapability | null;
  if (!fromReg) {
    return [{ id: "postproc-empty", kind: "custom", renderCustom: (list) => {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      row.textContent = tr("preview.noPostprocCap", "进入 3D 后再打开后处理面板");
      list.appendChild(row);
    }}];
  }
  return [{ id: "postproc", kind: "custom", renderCustom: (list) => {
    renderCapControls(list, fromReg.getMenuControls());
  }}];
}

/** 设置面板 schema：性能/画质开关声明式节点 */
export function buildSettingsSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const nodes: PreviewMenuNode[] = [];
  // ⚡ 性能分组
  nodes.push(bsBuildSectionTitle("settings-perf-header", "preview.settingsPerf", "性能"));
  nodes.push(bsBuildFrustumCullToggle());
  nodes.push(bsBuildFpsSelect());
  // 🎨 画质分组
  nodes.push(bsBuildSectionTitle("settings-quality-header", "preview.settingsQuality", "画质"));
  nodes.push(bsBuildPixelRatioSlider());
  const wfCap = sceneCapabilityRegistry.getById("wireframe") as WireframeCapability | undefined;
  if (wfCap) nodes.push(bsBuildWireframeToggle(wfCap));
  const ppCap = sceneCapabilityRegistry.getById("postprocessing") as
    | (import("../caps/postprocessing-capability.ts").PostprocessingCapability & {
        setEnabled(v: boolean): void;
        isEnabled(): boolean;
      })
    | undefined;
  if (ppCap) nodes.push(bsBuildBloomToggle(ppCap));
  const skyCap = sceneCapabilityRegistry.getById("sky") as
    | (import("../caps/sky-capability.ts").SkyCapability & {
        setEnvironmentEnabled(v: boolean): void;
        isEnvironmentEnabled(): boolean;
      })
    | undefined;
  if (skyCap) nodes.push(bsBuildPmremToggle(skyCap));
  nodes.push(bsBuildNote());
  return nodes;
}

function bsBuildSectionTitle(id: string, labelKey: string, fallback: string): PreviewMenuNode {
  return { id, kind: "sectionTitle", labelKey, fallback };
}

function bsMakeSlideRow(): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "slide-item";
  row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
  return row;
}

function bsMakeSlideLabel(textKey: string, textFallback: string, extraStyle?: string): HTMLSpanElement {
  const label = document.createElement("span");
  label.className = "slide-label";
  label.textContent = tr(textKey, textFallback);
  label.style.cssText = extraStyle ?? "font-size:12px";
  return label;
}

function bsBuildFrustumCullToggle(): PreviewMenuNode {
  return {
    id: "settings-frustum-cull",
    kind: "custom",
    labelKey: "preview.settingsFrustumCull",
    fallback: "视锥裁剪",
    renderCustom: (list: HTMLElement): void => {
      const row = bsMakeSlideRow();
      const labelBox = document.createElement("div");
      labelBox.style.cssText = "flex:1;display:flex;align-items:center;gap:8px;min-width:0";
      const label = bsMakeSlideLabel("preview.settingsFrustumCull", "视锥裁剪");
      const hint = document.createElement("span");
      hint.style.cssText = "font-size:11px;color:rgba(255,255,255,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      hint.textContent = tr("preview.settingsFrustumCullHint", "镜头外模型跳过渲染，省 GPU");
      labelBox.append(label, hint);
      const toggle = createHeaderToggle({
        value: isFrustumCullEnabled(),
        onChange: (v: boolean): void => setFrustumCullEnabled(v),
        bind: (): boolean => isFrustumCullEnabled(),
      });
      row.append(labelBox, toggle);
      list.appendChild(row);
    },
  };
}

function bsBuildFpsSelect(): PreviewMenuNode {
  return {
    id: "settings-fps",
    kind: "custom",
    labelKey: "preview.settingsMaxFps",
    fallback: "帧率上限",
    renderCustom: (list: HTMLElement): void => {
      const row = bsMakeSlideRow();
      const label = bsMakeSlideLabel("preview.settingsMaxFps", "帧率上限", "flex:1;font-size:12px");
      const sel = document.createElement("select");
      sel.className = "setting-select";
      sel.style.cssText = "font-size:11px;padding:2px 4px";
      const FPS_OPTIONS: Array<{ value: string; labelKey: string; fallback: string }> = [
        { value: "30", labelKey: "preview.settingsFps30", fallback: "30 fps" },
        { value: "60", labelKey: "preview.settingsFps60", fallback: "60 fps" },
        { value: "120", labelKey: "preview.settingsFps120", fallback: "120 fps" },
        { value: "0", labelKey: "preview.settingsFpsUncapped", fallback: "不限" },
      ];
      for (const opt of FPS_OPTIONS) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = tr(opt.labelKey, opt.fallback);
        sel.appendChild(o);
      }
      sel.value = String(getMaxFps());
      sel.onchange = (): void => {
        safeSet(MAX_FPS_KEY, sel.value);
        invalidateMaxFpsCache();
      };
      row.append(label, sel);
      list.appendChild(row);
    },
  };
}

function bsBuildPixelRatioSlider(): PreviewMenuNode {
  return {
    id: "settings-pixel-ratio",
    kind: "custom",
    labelKey: "preview.settingsMaxPixelRatio",
    fallback: "渲染分辨率上限",
    renderCustom: (list: HTMLElement): void => {
      const resCap = getMaxPixelRatio();
      const row = document.createElement("div");
      row.className = "slide-item";
      row.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:6px 10px";
      const head = document.createElement("div");
      head.style.cssText = "display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.7)";
      const name = bsMakeSlideLabel("preview.settingsMaxPixelRatio", "渲染分辨率上限");
      const val = document.createElement("span");
      val.textContent = `${resCap.toFixed(2)}x`;
      head.append(name, val);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0.5";
      slider.max = "2";
      slider.step = "0.25";
      slider.value = String(resCap);
      slider.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
      slider.oninput = (): void => {
        const v = Number(slider.value);
        safeSet(MAX_PIXEL_RATIO_KEY, String(v));
        val.textContent = `${v.toFixed(2)}x`;
      };
      row.append(head, slider);
      list.appendChild(row);
    },
  };
}

function bsBuildBloomToggle(
  ppCap: import("../caps/postprocessing-capability.ts").PostprocessingCapability & {
    setEnabled(v: boolean): void;
    isEnabled(): boolean;
  }
): PreviewMenuNode {
  return {
    id: "settings-bloom",
    kind: "custom",
    labelKey: "preview.settingsBloom",
    fallback: "Bloom 辉光",
    renderCustom: (list: HTMLElement): void => {
      const row = bsMakeSlideRow();
      const label = bsMakeSlideLabel("preview.settingsBloom", "Bloom 辉光", "flex:1;font-size:12px");
      const toggle = createHeaderToggle({
        value: ppCap.isEnabled(),
        onChange: (v: boolean): void => ppCap.setEnabled(v),
        bind: (): boolean => ppCap.isEnabled(),
      });
      row.append(label, toggle);
      list.appendChild(row);
    },
  };
}

function bsBuildPmremToggle(
  skyCap: import("../caps/sky-capability.ts").SkyCapability & {
    setEnvironmentEnabled(v: boolean): void;
    isEnvironmentEnabled(): boolean;
  }
): PreviewMenuNode {
  return {
    id: "settings-pmrem",
    kind: "custom",
    labelKey: "preview.settingsPmrem",
    fallback: "PMREM 环境光",
    renderCustom: (list: HTMLElement): void => {
      const row = bsMakeSlideRow();
      const label = bsMakeSlideLabel("preview.settingsPmrem", "PMREM 环境光", "flex:1;font-size:12px");
      const toggle = createHeaderToggle({
        value: skyCap.isEnvironmentEnabled(),
        onChange: (v: boolean): void => skyCap.setEnvironmentEnabled(v),
        bind: (): boolean => skyCap.isEnvironmentEnabled(),
      });
      row.append(label, toggle);
      list.appendChild(row);
    },
  };
}

function bsBuildNote(): PreviewMenuNode {
  return {
    id: "settings-note",
    kind: "custom",
    renderCustom: (list: HTMLElement): void => {
      const note = document.createElement("div");
      note.style.cssText = "padding:8px 10px;font-size:11px;color:rgba(255,255,255,0.4);line-height:1.5";
      note.textContent = tr("preview.settingsNote", "分辨率上限需重新进入 3D 预览生效；其余开关即时生效。");
      list.appendChild(note);
    },
  };
}

function bsBuildWireframeToggle(wfCap: WireframeCapability): PreviewMenuNode {
  return {
    id: "settings-wireframe",
    kind: "custom",
    labelKey: "preview.wireframe",
    fallback: "线框模式",
    renderCustom: (list: HTMLElement): void => {
      const row = bsMakeSlideRow();
      const labelBox = document.createElement("div");
      labelBox.style.cssText = "flex:1;display:flex;align-items:center;gap:8px;min-width:0";
      const label = bsMakeSlideLabel("preview.wireframe", "线框模式");
      const hint = document.createElement("span");
      hint.style.cssText = "font-size:11px;color:rgba(255,255,255,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      hint.textContent = tr("preview.wireframeDesc", "显示模型网格拓扑结构，调试布线用");
      labelBox.append(label, hint);
      const toggle = createHeaderToggle({
        value: wfCap.isEnabled(),
        onChange: (v: boolean): void => wfCap.setEnabled(v),
        bind: (): boolean => wfCap.isEnabled(),
      });
      row.append(labelBox, toggle);
      list.appendChild(row);
    },
  };
}
