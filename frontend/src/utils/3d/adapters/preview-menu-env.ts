// ===== 环境菜单声明式 Schema（ADR-076 + ADR-106）=====
import { sceneCapabilityRegistry } from '../caps/scene-capability-registry.ts';
import type { SceneCapability, MenuControlDef } from '../caps/scene-capability.ts';
import type { SkyCapability } from '../caps/sky-capability.ts';
import type { FogCapability } from '../caps/fog-capability.ts';
import type { EnvironmentCapability } from '../caps/environment-capability.ts';
import { createHeaderToggle } from '../../../ui/ui-header-toggle.ts';
import type { SlideMenuHandle } from '../../../ui/ui-slide-menu.ts';
import { renderCapControls } from './preview-menu-cap-controls.ts';
import type { PreviewMenuCtx } from './preview-menu.ts';
import { t } from '../../../core/i18n/t.ts';
import { ENV_PRESET_LINKAGE, type EnvPresetId } from '../caps/environment-capability.ts';
import type { PreviewMenuNode } from './preview-menu-node-types.ts';

const ENV_IDS = new Set(["sky", "ground", "water", "environment", "fog", "reflector"]);
const ORDERED_IDS = ["sky", "ground", "water", "environment", "fog", "reflector"] as const;
const PRESET_ORDER = [
  { id: "studio", icon: "\u2600\uFE0F", labelKey: "preview.presetQuickStudio" },
  { id: "sunset", icon: "\uD83C\uDF05", labelKey: "preview.presetQuickSunset" },
  { id: "night", icon: "\uD83C\uDF19", labelKey: "preview.presetQuickNight" },
  { id: "forest", icon: "\uD83C\uDF33", labelKey: "preview.presetQuickForest" },
  { id: "sky", icon: "\uD83C\uDF24\uFE0F", labelKey: "preview.presetQuickSky" },
];
function tr(key: string, fallback: string): string { const v = t(key); return v === key ? fallback : v; }
function resolveCaps(ctx: PreviewMenuCtx): SceneCapability[] {
  let allCaps = sceneCapabilityRegistry.getAll().filter((cap) => ENV_IDS.has(cap.id));
  if (allCaps.length === 0) {
    const fb: SceneCapability[] = [];
    const skyCap = ctx.getCap("sky");
    const groundCap = ctx.getCap("ground");
    if (skyCap && "getMenuControls" in skyCap) fb.push(Object.assign({ id: "sky" }, skyCap) as SceneCapability);
    if (groundCap && "getMenuControls" in groundCap) fb.push(Object.assign({ id: "ground" }, groundCap) as SceneCapability);
    const waterCapFb = ctx.getCap("water");
    if (waterCapFb && "getMenuControls" in waterCapFb) fb.push(Object.assign({ id: "water" }, waterCapFb) as SceneCapability);
    allCaps = fb;
  }
  return allCaps;
}
function orderedCaps(allCaps: SceneCapability[]): SceneCapability[] {
  return ORDERED_IDS.map((id) => allCaps.find((c) => c.id === id)).filter((c): c is SceneCapability => Boolean(c));
}
/** 按 group 字段把控件分组成「平级入口」：保序；base 组（无 group 的控件）用 cap 名作标题。
 * 用于环境子视图——带分区的 cap（ground 的 地面/水面/表面材质、reflector 的参数）进入后先列分区入口，
 * 各自下钻，消除「地面」入口内水面/材质混排的迷感。单组（无 group）cap 仍走原平铺。 */
function partitionCapControlsByGroup(
  cap: SceneCapability,
  ctrls: MenuControlDef[],
): { key: string | null; label: string; ctrls: MenuControlDef[] }[] {
  const groups = new Map<string | null, MenuControlDef[]>();
  for (const c of ctrls) {
    if (c.visible && !c.visible()) continue; // 条件隐藏控件不计入分组（空组由调用方 .filter 丢弃）
    const k = c.group ?? null;
    const arr = groups.get(k);
    if (arr) arr.push(c);
    else groups.set(k, [c]);
  }
  return [...groups.entries()].map(([k, cs]) => ({
    key: k,
    label: k ? tr(k, k) : tr(cap.labelKey, cap.id),
    ctrls: cs,
  }));
}
function applyPreset(ctx: PreviewMenuCtx, presetId: Exclude<EnvPresetId, "custom">, menu?: SlideMenuHandle): void {
  const link = ENV_PRESET_LINKAGE[presetId];
  if (!link) return;
  if (link.sky) {
    const skyCap = sceneCapabilityRegistry.getById("sky") as (SkyCapability & { setTime?(h: number): void; setCloudCoverage?(v: number, regen?: boolean): void }) | null;
    if (skyCap) { skyCap.setTime?.(link.sky.time); skyCap.setCloudCoverage?.(link.sky.cloud, true); }
    else { const fc = ctx.getCap("sky") as (SkyCapability & { setTime?(h: number): void; setCloudCoverage?(v: number, regen?: boolean): void }) | null; fc?.setTime?.(link.sky.time); fc?.setCloudCoverage?.(link.sky.cloud, true); }
  }
  if (link.fog) {
    const fogCap = sceneCapabilityRegistry.getById("fog") as FogCapability | null;
    if (fogCap) { fogCap.setEnabled(link.fog.enabled); if (link.fog.mode) fogCap.setMode(link.fog.mode); if (link.fog.density !== undefined) fogCap.setDensity(link.fog.density); if (link.fog.near !== undefined || link.fog.far !== undefined) fogCap.setLinearRange(link.fog.near, link.fog.far); }
  }
  const envCap = sceneCapabilityRegistry.getById("environment") as EnvironmentCapability | null;
  if (envCap) { envCap.setPresetId(presetId); if (link.envIntensity !== undefined) envCap.setIntensity(link.envIntensity); }
  menu?.refresh();
}
export function buildEnvSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const caps = orderedCaps(resolveCaps(ctx));
  if (caps.length === 0) {
    return [{ id: "env-empty", kind: "custom", renderCustom: (list: HTMLElement) => {
      const r = document.createElement("div");
      r.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      r.textContent = tr("preview.noEnvironment", "进入 3D 后再打开环境面板");
      list.appendChild(r);
    }}];
  }
  const presetNode: PreviewMenuNode = {
    id: "env-presets",
    kind: "custom",
    renderCustom: (list: HTMLElement) => {
      const pb = document.createElement("div");
      pb.style.cssText = "display:flex;gap:4px;padding:6px 10px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.08)";
      PRESET_ORDER.forEach((p) => {
        const btn = document.createElement("button");
        btn.dataset.testid = "env-preset-" + p.id;
        btn.style.cssText = "flex:1;min-width:48px;padding:4px 6px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:transparent;color:rgba(255,255,255,0.85);cursor:pointer;font-size:12px;display:flex;flex-direction:column;align-items:center;gap:2px";
        const ic = document.createElement("span"); ic.textContent = p.icon; ic.style.cssText = "font-size:14px";
        const lb = document.createElement("span"); lb.textContent = tr(p.labelKey, p.id);
        btn.append(ic, lb);
        pb.appendChild(btn);
      });
      list.appendChild(pb);
    },
  };
  const capNodes = caps.flatMap((cap) => {
    const controls = cap.getMenuControls();
    if (controls.length === 0) return [];
    const pi = controls.findIndex((cc) => cc.kind !== "divider");
    if (pi === -1) return [];
    return [{
      id: "env:" + cap.id,
      kind: "custom" as const,
      labelKey: cap.labelKey,
      fallback: cap.id,
      icon: cap.icon,
      renderCustom: (list: HTMLElement) => {
        const p = controls[pi];
        const row = document.createElement("div");
        row.className = "slide-item";
        row.dataset.testid = "cap-row-" + cap.id;
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
        if (p.kind === "toggle") {
          const lb = document.createElement("span");
          lb.className = "slide-label";
          lb.textContent = tr(p.labelKey, p.fallback);
          lb.style.cssText = "flex:1;font-size:13px";
          const tg = createHeaderToggle({ value: p.getValue() as boolean, onChange: (v: boolean) => p.setValue(v), bind: (): boolean => p.getValue() as boolean });
          tg.addEventListener("click", (e: MouseEvent) => e.stopPropagation());
          row.append(lb, tg);
        } else if (p.kind === "slider") {
          const hd = document.createElement("div");
          hd.style.cssText = "display:flex;flex-direction:column;gap:2px;flex:1;min-width:0";
          const nr = document.createElement("div");
          nr.style.cssText = "display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.85)";
          const nm = document.createElement("span"); nm.className = "slide-label"; nm.textContent = tr(p.labelKey, p.fallback);
          const vl = document.createElement("span");
          const nv = p.getValue() as number;
          vl.textContent = p.slider?.unit === "h" ? String(Math.floor(nv)).padStart(2,"0")+":"+String(Math.round((nv%1)*60)).padStart(2,"0") : p.slider?.unit === "%" ? Math.round(nv*100)+"%" : p.slider?.unit ? nv+p.slider.unit : nv.toFixed(2);
          nr.append(nm, vl);
          const sl = document.createElement("input");
          sl.type = "range"; sl.min = String(p.slider?.min??0); sl.max = String(p.slider?.max??1); sl.step = String(p.slider?.step??0.01); sl.value = String(nv);
          sl.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
          sl.oninput = (): void => { const v = Number(sl.value); p.setValue(v); vl.textContent = p.slider?.unit === "h" ? String(Math.floor(v)).padStart(2,"0")+":"+String(Math.round((v%1)*60)).padStart(2,"0") : p.slider?.unit === "%" ? Math.round(v*100)+"%" : p.slider?.unit ? v+p.slider.unit : v.toFixed(2); };
          ["click","mousedown","touchstart"].forEach((ev) => sl.addEventListener(ev, (e: Event) => e.stopPropagation()));
          hd.append(nr, sl);
          row.appendChild(hd);
        } else {
          const lb = document.createElement("span");
          lb.className = "slide-label"; lb.textContent = tr(cap.labelKey, cap.id); lb.style.cssText = "flex:1;font-size:13px"; row.appendChild(lb);
        }
        list.appendChild(row);
      },
    }];
  });
  return [presetNode, ...capNodes];
}
/** 环境面板（ADR-075 + 统一注册表）：只渲染环境类能力（sky/ground/environment/fog/reflector）
 *  独立面板排除项：light → lighting；shadow → shadow；postprocessing → postproc；避免同一能力控件双面板重复。
 *
 *  两级菜单（2026-08-20 改造）：
 *  - 第一层（环境根视图）：每个 cap 渲染一行摘要 = 主控件 + 名称 + ›
 *    · environment/fog/reflector：第一个控件是 *-enabled toggle → 第一层放该 toggle
 *    · sky：无 enabled toggle，第一个控件是 sky-time slider → 第一层直接放该 slider
 *    · ground：仅一个 visible toggle、无数值 → 纯 toggle 行，无 ›
 *  - › 点击 → menu.navigate(subView)，subView 渲染该 cap 的完整 getMenuControls()
 *  - 无 menu 句柄（旧调用路径）→ 回退到平铺渲染，保持向后兼容 */
export function renderEnvLevel(list: HTMLElement, ctx: PreviewMenuCtx, menu?: SlideMenuHandle): void {
  if (!menu) {
    const caps = orderedCaps(resolveCaps(ctx));
    const ctrls: MenuControlDef[] = [];
    caps.forEach((cap, idx) => {
      if (idx > 0) ctrls.push({ id: "__divider_"+cap.id, kind: "divider" as const, labelKey: "", fallback: "", getValue: () => false, setValue: () => {} });
      ctrls.push(...cap.getMenuControls());
    });
    renderCapControls(list, ctrls);
    return;
  }
  const caps = orderedCaps(resolveCaps(ctx));
  if (caps.length === 0) {
    const r = document.createElement("div");
    r.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
    r.textContent = tr("preview.noEnvironment", "进入 3D 后再打开环境面板");
    list.appendChild(r);
    return;
  }
  const pb = document.createElement("div");
  pb.style.cssText = "display:flex;gap:4px;padding:6px 10px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.08)";
  PRESET_ORDER.forEach((p) => {
    const btn = document.createElement("button");
    btn.dataset.testid = "env-preset-"+p.id;
    btn.style.cssText = "flex:1;min-width:48px;padding:4px 6px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:transparent;color:rgba(255,255,255,0.85);cursor:pointer;font-size:12px;display:flex;flex-direction:column;align-items:center;gap:2px";
    const ic = document.createElement("span"); ic.textContent = p.icon; ic.style.cssText = "font-size:14px";
    const lb = document.createElement("span"); lb.textContent = tr(p.labelKey, p.id);
    btn.append(ic, lb);
    btn.onclick = (e: MouseEvent) => { e.stopPropagation(); applyPreset(ctx, p.id as Exclude<EnvPresetId, "custom">, menu); };
    pb.appendChild(btn);
  });
  list.appendChild(pb);
  for (const cap of caps) {
    const ctrls = cap.getMenuControls();
    if (ctrls.length === 0) continue;
    const pi = ctrls.findIndex((cc) => cc.kind !== "divider");
    if (pi === -1) continue;
    const primary = ctrls[pi];
    const hasSub = ctrls.length > 1;
    const row = document.createElement("div");
    row.className = "slide-item";
    row.dataset.testid = "cap-row-"+cap.id;
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px" + (hasSub ? ";cursor:pointer" : "");
    if (primary.kind === "toggle") {
      const lb = document.createElement("span"); lb.className = "slide-label"; lb.textContent = tr(primary.labelKey, primary.fallback); lb.style.cssText = "flex:1;font-size:13px";
      const tg = createHeaderToggle({ value: primary.getValue() as boolean, onChange: (v: boolean) => primary.setValue(v), bind: (): boolean => primary.getValue() as boolean });
      tg.addEventListener("click", (e: MouseEvent) => e.stopPropagation());
      row.append(lb, tg);
    } else if (primary.kind === "slider") {
      const hd = document.createElement("div"); hd.style.cssText = "display:flex;flex-direction:column;gap:2px;flex:1;min-width:0";
      const nr = document.createElement("div"); nr.style.cssText = "display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.85)";
      const nm = document.createElement("span"); nm.className = "slide-label"; nm.textContent = tr(primary.labelKey, primary.fallback);
      const vl = document.createElement("span"); const nv = primary.getValue() as number;
      vl.textContent = primary.slider?.unit === "h" ? String(Math.floor(nv)).padStart(2,"0")+":"+String(Math.round((nv%1)*60)).padStart(2,"0") : primary.slider?.unit === "%" ? Math.round(nv*100)+"%" : primary.slider?.unit ? nv+primary.slider.unit : nv.toFixed(2);
      nr.append(nm, vl);
      const sl = document.createElement("input"); sl.type = "range"; sl.min = String(primary.slider?.min??0); sl.max = String(primary.slider?.max??1); sl.step = String(primary.slider?.step??0.01); sl.value = String(nv); sl.style.cssText = "width:100%;cursor:pointer;accent-color:var(--accent,#7c83ff)";
      sl.oninput = (): void => { const v = Number(sl.value); primary.setValue(v); vl.textContent = primary.slider?.unit === "h" ? String(Math.floor(v)).padStart(2,"0")+":"+String(Math.round((v%1)*60)).padStart(2,"0") : primary.slider?.unit === "%" ? Math.round(v*100)+"%" : primary.slider?.unit ? v+primary.slider.unit : v.toFixed(2); };
      ["click","mousedown","touchstart"].forEach((ev) => sl.addEventListener(ev, (e: Event) => e.stopPropagation()));
      hd.append(nr, sl); row.appendChild(hd);
    } else {
      const lb = document.createElement("span"); lb.className = "slide-label"; lb.textContent = tr(cap.labelKey, cap.id); lb.style.cssText = "flex:1;font-size:13px"; row.appendChild(lb);
    }
    if (hasSub) {
      row.onclick = (): void => {
        // 根行已展示主控件（通常是启用开关），下钻子视图不再重复罗列，避免「开关套开关」
        const subCtrls = ctrls.filter((_, i) => i !== pi);
        const groups = partitionCapControlsByGroup(cap, subCtrls).filter((g) => g.ctrls.length > 0);
        if (groups.length <= 1) {
          // 无分组（或仅剩单组）：保持原平铺下钻
          menu.navigate({ title: tr(cap.labelKey, cap.id), render: (subList) => { subList.replaceChildren(); renderCapControls(subList, subCtrls); } });
          return;
        }
        // 带分组：先列分区入口（形态 / 外观 / 水池 / 波纹 …），各自下钻到该组控件
        menu.navigate({
          title: tr(cap.labelKey, cap.id),
          render: (subList) => {
            subList.replaceChildren();
            for (const g of groups) {
              const entry = document.createElement("div");
              entry.className = "slide-item";
              entry.dataset.testid = "cap-group-entry-" + (g.key ?? "base");
              entry.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer";
              const lb = document.createElement("span");
              lb.className = "slide-label";
              lb.textContent = g.label;
              lb.style.cssText = "flex:1;font-size:13px";
              const ch = document.createElement("span");
              ch.textContent = "›";
              ch.style.cssText = "margin-left:auto;font-size:18px;font-weight:700;opacity:0.5;user-select:none;padding:0 4px;pointer-events:none";
              entry.append(lb, ch);
              entry.onclick = (): void => {
                menu.navigate({
                  title: g.label,
                  render: (gsub) => {
                    gsub.replaceChildren();
                    // 剥掉 group 字段，避免 renderCapControls 再包一层同名 section
                    const flat = g.ctrls.map((c) => ({ ...c, group: undefined }));
                    renderCapControls(gsub, flat);
                  },
                });
              };
              subList.appendChild(entry);
            }
          },
        });
      };
      const ch = document.createElement("span"); ch.textContent = "›"; ch.dataset.testid = "row-chevron"; ch.style.cssText = "margin-left:auto;font-size:18px;font-weight:700;opacity:0.5;user-select:none;padding:0 4px;pointer-events:none"; row.appendChild(ch);
    }
    list.appendChild(row);
  }
}
