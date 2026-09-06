// ===== 环境菜单声明式 Schema（ADR-076 + ADR-106）=====
// 2026 收口：环境面板对齐 scene 组根视图 / roles / MikuMikuAR env 一级菜单——
// 「行 + navigate 下钻」形态（推翻 ADR-193 第三刀 folder 手风琴拍板）：
//   - 一级：氛围预设 select + 每 cap 一行（icon + label + 可选 headerToggle 能力开关）
//   - 二级：点行 → actionCtx.navigate 下钻到该 cap 参数页（ADR-195 刀1 起经
//     cap-to-node 桥接转 PreviewMenuNode[] 走 renderMenu，group 折叠由节点 folder 承载）
// 行渲染复用 render.ts 唯一 row 生成器（slide-item + radio/badge/headerToggle 槽位），
// 与 roles 同构，消除「env 手风琴 vs 其余面板行列表」的形态割裂。

import { tr } from "../../core/i18n/tr.ts";
import type { SlideMenuHandle, SlideMenuView } from "../../ui/ui-slide-menu.ts";
import { ENV_PRESET_LINKAGE, type EnvPresetId } from "../caps/environment-capability.ts";
import type { SceneCapability } from "../caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { SkyCapability } from "../caps/sky-capability.ts";
import { capControlsToNodes } from "./cap-to-node.ts";
import type { PreviewActionMenuCtx, PreviewMenuCtx, PreviewMenuNode } from "./node-types.ts";
import { renderMenu } from "./render.ts";

const ENV_IDS = new Set(["sky", "ground", "water", "environment", "fog", "reflector"]);
const ORDERED_IDS = ["sky", "ground", "water", "environment", "fog", "reflector"] as const;

// ── 环境面板局部刷新：订阅 cap 参数变更触发 menu.refresh()（重渲染栈顶 = 当前子视图）──
let _envCapUnsubs: Array<() => void> = [];
function rebuildEnvSubs(caps: SceneCapability[], menu: SlideMenuHandle): void {
  for (const u of _envCapUnsubs) u();
  _envCapUnsubs = [];
  for (const c of caps) {
    if (c.subscribe) _envCapUnsubs.push(c.subscribe(() => menu.refresh()));
  }
}
/** 会话结束/面板卸载时清理订阅，避免 cap 单例持有过期 menu 引用（每次重跑也会重建，此处为显式出口） */
export function disposeEnvSubscriptions(): void {
  for (const u of _envCapUnsubs) u();
  _envCapUnsubs = [];
  // code_review bc639ae0 #6/#7/#8：重置预设 select 模块缓存——cap 真值源在
  // environment cap 的 params.preset，本变量仅作无 cap 时的回退，跨会话残留
  // 会让新会话 select 显示上一会话的选中态
  _lastEnvPreset = "studio";
}
const PRESET_ORDER = [
  { id: "studio", icon: "\u2600\uFE0F", labelKey: "preview.presetQuickStudio" },
  { id: "sunset", icon: "\uD83C\uDF05", labelKey: "preview.presetQuickSunset" },
  { id: "night", icon: "\uD83C\uDF19", labelKey: "preview.presetQuickNight" },
  { id: "forest", icon: "\uD83C\uDF33", labelKey: "preview.presetQuickForest" },
  { id: "sky", icon: "\uD83C\uDF24\uFE0F", labelKey: "preview.presetQuickSky" },
];
function resolveCaps(ctx: PreviewMenuCtx): SceneCapability[] {
  let allCaps = sceneCapabilityRegistry.getAll().filter((cap) => ENV_IDS.has(cap.id));
  if (allCaps.length === 0) {
    const fb: SceneCapability[] = [];
    const skyCap = ctx.getCap("sky");
    const groundCap = ctx.getCap("ground");
    if (skyCap && "getMenuControls" in skyCap)
      fb.push(Object.assign({ id: "sky" }, skyCap) as SceneCapability);
    if (groundCap && "getMenuControls" in groundCap)
      fb.push(Object.assign({ id: "ground" }, groundCap) as SceneCapability);
    const waterCapFb = ctx.getCap("water");
    if (waterCapFb && "getMenuControls" in waterCapFb)
      fb.push(Object.assign({ id: "water" }, waterCapFb) as SceneCapability);
    allCaps = fb;
  }
  return allCaps;
}
function orderedCaps(allCaps: SceneCapability[]): SceneCapability[] {
  return ORDERED_IDS.map((id) => allCaps.find((c) => c.id === id)).filter(
    (c): c is SceneCapability => Boolean(c),
  );
}
function applyPreset(
  ctx: PreviewMenuCtx,
  presetId: Exclude<EnvPresetId, "custom">,
  menu?: SlideMenuHandle,
): void {
  const link = ENV_PRESET_LINKAGE[presetId];
  if (!link) return;
  if (link.sky) {
    const skyCap = sceneCapabilityRegistry.getById("sky");
    if (skyCap) {
      skyCap.setTime?.(link.sky.time);
      skyCap.setCloudCoverage?.(link.sky.cloud, true);
    } else {
      const fc = ctx.getCap("sky") as
        | (SkyCapability & {
            setTime?(h: number): void;
            setCloudCoverage?(v: number, regen?: boolean): void;
          })
        | null;
      fc?.setTime?.(link.sky.time);
      fc?.setCloudCoverage?.(link.sky.cloud, true);
    }
  }
  if (link.fog) {
    const fogCap = sceneCapabilityRegistry.getById("fog");
    if (fogCap) {
      fogCap.setEnabled(link.fog.enabled);
      if (link.fog.mode) fogCap.setMode(link.fog.mode);
      if (link.fog.density !== undefined) fogCap.setDensity(link.fog.density);
      if (link.fog.near !== undefined || link.fog.far !== undefined)
        fogCap.setLinearRange(link.fog.near, link.fog.far);
    }
  }
  const envCap = sceneCapabilityRegistry.getById("environment");
  if (envCap) {
    envCap.setPresetId(presetId);
    if (link.envIntensity !== undefined) envCap.setIntensity(link.envIntensity);
  }
  menu?.refresh();
}

/** 预设 select 当前值（模块级：预设无状态层路径，applyPreset 写入；旧 UI 按钮本就无选中态显示） */
let _lastEnvPreset: Exclude<EnvPresetId, "custom"> = "studio";

/** 剔除 cap 能力总开关后的子视图控件（getMasterToggle 已升一级行 headerToggle 时） */
function envCapRestControls(cap: SceneCapability): ReturnType<SceneCapability["getMenuControls"]> {
  const masterId = cap.getMasterToggle?.()?.id ?? null;
  return masterId ? cap.getMenuControls().filter((c) => c.id !== masterId) : cap.getMenuControls();
}

/**
 * cap 参数子视图节点（ADR-195 刀2 双轨：已迁移 cap 直产 getMenuNodes()，未迁移经
 * capControlsToNodes 桥接 getMenuControls()）。
 *  - 已迁移：取完整节点树，剔除能力总开关节点（getMasterToggle 已升一级行 headerToggle，
 *    防子视图双份开关）——按 master id 匹配顶层节点剔。
 *  - 未迁移：旧路径 envCapRestControls（MenuControlDef 剔 master）→ capControlsToNodes。
 * group→folder 折叠、复杂控件 controls 通道均由产方/桥接统一表达，renderMenu 单一调度。
 */
function envCapSubNodes(cap: SceneCapability): PreviewMenuNode[] {
  if (cap.getMenuNodes) {
    const masterId = cap.getMasterToggle?.()?.id ?? null;
    const all = cap.getMenuNodes();
    if (!masterId) return all;
    return all.filter((n) => n.id !== masterId);
  }
  return capControlsToNodes(envCapRestControls(cap));
}

/**
 * cap 参数子视图（navigate 落点）：把该 cap 参数节点树经 renderMenu 渲染——
 * 内容进入节点 schema 通道（刀1 桥接或刀2 直产统一出口）。
 * visibleWhen 过滤由 renderMenu 内部经 previewSnapshot() 求值（铁律收口）。
 */
function envCapSubview(cap: SceneCapability): SlideMenuView {
  // 子视图内容全为控件节点/folder/controls：不触达 makeRow/makePanelView/action 分支；
  // menu.refresh 供 refreshOnChange 语义（当前 cap 控件经 onChange 闭包自刷新，少用）。
  const subviewDeps = {
    makeRow: (): HTMLDivElement => document.createElement("div"),
    makePanelView: (): never => {
      throw new Error("cap 参数子视图不应含 panel/action/row 节点（cap-to-node 桥接层）");
    },
    menu: {
      refresh: (): void => {},
    } as unknown as SlideMenuHandle,
    actionCtx: {
      toast: (): void => {},
      closeAllOverlays: (): void => {},
    } as unknown as PreviewActionMenuCtx,
  };
  return {
    title: tr(cap.labelKey, cap.id),
    render: (list) => {
      list.replaceChildren();
      renderMenu(list, envCapSubNodes(cap), subviewDeps);
    },
  };
}

/** 一级 cap 行：icon + label + 可选 headerToggle + 整行 action 下钻参数页 */
function envCapRow(cap: SceneCapability): PreviewMenuNode {
  const master = cap.getMasterToggle?.() ?? null;
  return {
    id: `env-cap-${cap.id}`,
    kind: "row",
    labelKey: cap.labelKey,
    fallback: cap.id,
    icon: cap.icon,
    // 导航行紧凑密度（稀疏内容：icon+label+可选开关+箭头）——与 scene 组根视图行同密度，
    // 不吃 .slide-item 38px 内容行基座。token 见 menu-styles MENU_ROW_DENSITY_CSS。
    rowDensity: "compact",
    // 能力总开关放行尾（对齐 MikuMikuAR env 一级菜单 headerToggle）：开关点击
    // stopPropagation 不触发整行下钻；bind 随 refresh 同步 checked
    ...(master
      ? {
          headerToggle: {
            value: master.getValue() as boolean,
            onChange: (v: boolean) => master.setValue(v),
            bind: () => master.getValue() as boolean,
          },
        }
      : {}),
    // 整行 action：下钻到该 cap 参数页（actionCtx.navigate；render.ts row 分支注入）
    action: (ctx) => ctx.navigate?.(envCapSubview(cap)),
  };
}

/**
 * 环境面板声明式 schema。
 * 结构：氛围预设 select（跨 cap 联动）+ 每 cap 一行（一级），点行 navigate 下钻参数页。
 * 空 caps → 空态提示单节点。menu 存在时重建 cap 订阅（cap 参数变更 → menu.refresh →
 * 面板重渲染 → 本函数重跑 → 行/headerToggle 实时）。
 */
export function buildEnvSchema(ctx: PreviewMenuCtx, menu?: SlideMenuHandle): PreviewMenuNode[] {
  const caps = orderedCaps(resolveCaps(ctx));
  if (menu) rebuildEnvSubs(caps, menu);
  if (caps.length === 0) {
    return [
      {
        id: "env-empty",
        kind: "sectionTitle",
        labelKey: "preview.noEnvironment",
        fallback: "进入 3D 后再打开环境面板",
      },
    ];
  }
  return [
    {
      id: "env-preset-bar",
      kind: "select",
      labelKey: "preview.envPresetThumbnail",
      fallback: "氛围预设",
      control: {
        options: PRESET_ORDER.map((p) => ({
          value: p.id,
          label: `${p.icon} ${tr(p.labelKey, p.id)}`,
        })),
        // code_review bc639ae0 #6/#7/#8：显示值读 environment cap 实际 preset
        // （applyPreset/预设 thumb/loadState 都经 envCap.setPresetId 写 params.preset，
        // 是单一真值源）——旧实现只读 _lastEnvPreset 模块级 last-write 缓存，
        // 其它路径改 preset 后 select 显示 stale 值误导；custom（自定义 HDR）
        // 不在快预设 options 内时回退最近快预设
        get: () => {
          const envCap = sceneCapabilityRegistry.getById("environment");
          const cur = envCap?.getPresetId?.();
          return cur && cur !== "custom" ? cur : _lastEnvPreset;
        },
        set: (v) => {
          _lastEnvPreset = v as Exclude<EnvPresetId, "custom">;
          applyPreset(ctx, _lastEnvPreset, menu);
        },
      },
    },
    ...caps.map(envCapRow),
  ];
}
