// ===== 环境菜单声明式 Schema（ADR-076 + ADR-106）=====
// 2026 收口：环境面板对齐 scene 组根视图 / roles / MikuMikuAR env 一级菜单——
// 「行 + navigate 下钻」形态（推翻 ADR-193 第三刀 folder 手风琴拍板）：
//   - 一级：氛围预设 select + 每 cap 一行（icon + label + 可选 headerToggle 能力开关）
//   - 二级：点行 → actionCtx.navigate 下钻到该 cap 参数页（ADR-195 刀1 起经
//     cap-to-node 桥接转 PreviewMenuNode[] 走 renderMenu，group 折叠由节点 folder 承载）
// 行渲染复用 render.ts 唯一 row 生成器（slide-item + radio/badge/headerToggle 槽位），
// 与 roles 同构，消除「env 手风琴 vs 其余面板行列表」的形态割裂。

import { tOf } from "@/core/i18n/t.ts";
import type { EnvPresetId } from "@/preview-3d/caps/environment-capability.ts";
import type { SceneCapability } from "@/preview-3d/caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import { ATMOSPHERE_PRESETS } from "@/preview-3d/state/atmosphere-presets.ts";
import { setEnvState } from "@/preview-3d/state/env-state.ts";
import type { PreviewActionMenuCtx, PreviewMenuCtx, PreviewMenuNode } from "./node-types.ts";
import { renderMenu } from "./render.ts";
import type { SlideMenuHandle, SlideMenuView } from "./slide-menu.ts";

const ORDERED_IDS = ["sky", "ground", "water", "environment", "fog", "reflector"] as const;
const ENV_IDS = new Set<string>(ORDERED_IDS);

/**
 * 环境面板 cap 分段（卡牌外壳单一事实源）。
 *
 * 背景：envCapRow 产出的都是「点击 navigate 下钻参数页」的一级导航行
 * （天空/地面/水面/环境/雾/反射），本身不收纳参数——原先平铺一长列，语义相邻的
 * 项之间没有视觉边界。现按语义聚拢成卡：卡壳＝顶行标题 + 分隔线 + 内容区。
 *
 * 新增环境 cap 时在此登记归属；未登记的落末尾「其它」卡（不静默丢失）。
 */
const ENV_SECTIONS: ReadonlyArray<{
  id: string;
  labelKey: string;
  caps: readonly string[];
}> = [
  {
    id: "env-card-basic",
    labelKey: "preview.envSectionBasic",
    caps: ["sky", "ground", "water"],
  },
  {
    id: "env-card-atmosphere",
    labelKey: "preview.envSectionAtmosphere",
    caps: ["environment", "fog", "reflector"],
  },
];

// ── 环境面板局部刷新：订阅 cap 参数变更触发 menu.refresh()（重渲染栈顶 = 当前子视图）──
// 按 menu 句柄隔离订阅：每个 mountPreviewRootMenu 实例持有各自的订阅列表，
// 避免多挂载场景下 A 实例的 rebuildEnvSubs 误清 B 实例的订阅（模块级单例时两者等价，
// 但设计一致性对齐 coreSchemaOwners / customCleanups 的 per-mount 注入范式）。
const _envCapUnsubsByMenu = new WeakMap<SlideMenuHandle, Array<() => void>>();
function rebuildEnvSubs(caps: SceneCapability[], menu: SlideMenuHandle): void {
  const prev = _envCapUnsubsByMenu.get(menu);
  if (prev) for (const u of prev) u();
  const subs: Array<() => void> = [];
  for (const c of caps) {
    if (c.subscribe) subs.push(c.subscribe(() => menu.refresh()));
  }
  _envCapUnsubsByMenu.set(menu, subs);
}
/** 会话结束/面板卸载时清理订阅，避免 cap 单例持有过期 menu 引用（每次重跑也会重建，此处为显式出口） */
export function disposeEnvSubscriptions(menu: SlideMenuHandle): void {
  const subs = _envCapUnsubsByMenu.get(menu);
  if (subs) {
    for (const u of subs) u();
    _envCapUnsubsByMenu.delete(menu);
  }
  // 重置预设 select 模块缓存——cap 真值源在
  // environment cap 的 params.preset，本变量仅作无 cap 时的回退，跨会话残留
  // 会让新会话 select 显示上一会话的选中态
  _lastEnvPreset = "studio";
}
// 快捷环境预设：`icon` 是**文本槽**装饰，非结构槽图标——它被拼进下方 options 的 `label`
// 喂给 `<select>` 的 `<option>`，而 `renderCapSelect` 用 `o.textContent` 落位；`<option>`
// 的内容模型**只能是文本**，SVG 放进去只会显示 `<svg…>` 字面量。
// 故按 ADR-238 §1.4「文本槽内符号允许保留」豁免（与 `menu-icons.test.ts` 的豁免清单同源）。
// 若将来把该控件换成可渲染 SVG 的自定义下拉，请一并撤销豁免并改为语义名。
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
    if (skyCap) fb.push(Object.assign({ id: "sky" }, skyCap) as SceneCapability);
    if (groundCap) fb.push(Object.assign({ id: "ground" }, groundCap) as SceneCapability);
    const waterCapFb = ctx.getCap("water");
    if (waterCapFb) fb.push(Object.assign({ id: "water" }, waterCapFb) as SceneCapability);
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
  _ctx: PreviewMenuCtx,
  presetId: Exclude<EnvPresetId, "custom">,
  menu?: SlideMenuHandle,
): void {
  // ADR-196 刀4：氛围预设收口——ATMOSPHERE_PRESETS[presetId] 完整快照经 setEnvState
  // 统一派发到各 cap callback（取代 ENV_PRESET_LINKAGE 硬编码 if(link.sky) 联动）。
  // 守卫：auto-atmosphere source < manual——用户手动调过的字段不被覆盖。
  const snapshot = ATMOSPHERE_PRESETS[presetId];
  if (!snapshot) return;
  setEnvState(snapshot, { source: "auto-atmosphere" });
  // env.ts 行/select 依赖 menu.refresh 重渲染读最新 envState
  menu?.refresh();
}

/** 预设 select 当前值（模块级：预设无状态层路径，applyPreset 写入；旧 UI 按钮本就无选中态显示） */
let _lastEnvPreset: Exclude<EnvPresetId, "custom"> = "studio";

/** 从 cap 节点树提取 master 节点（getMasterNodeId 已升一级行 headerToggle 时） */
function capMasterNode(cap: SceneCapability): PreviewMenuNode | null {
  const masterId = cap.getMasterNodeId?.();
  if (!masterId) return null;
  const nodes = cap.getMenuNodes?.() ?? null;
  return nodes?.find((n) => n.id === masterId) ?? null;
}

/**
 * cap 参数子视图节点（ADR-195 刀2：所有 cap 直产 getMenuNodes()）。
 * 取完整节点树，剔除能力总开关节点（getMasterNodeId 已升一级行 headerToggle，
 * 防子视图双份开关）——按 master id 匹配顶层节点剔。
 * group→folder 折叠、复杂控件 controls 通道均由产方统一表达，renderMenu 单一调度。
 */
function envCapSubNodes(cap: SceneCapability): PreviewMenuNode[] {
  const masterId = cap.getMasterNodeId?.();
  const all = cap.getMenuNodes?.();
  if (!all) return [];
  if (!masterId) return all;
  return all.filter((n) => n.id !== masterId);
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
    title: tOf(cap.labelKey),
    render: (list) => {
      list.replaceChildren();
      renderMenu(list, envCapSubNodes(cap), subviewDeps);
    },
  };
}

/** 一级 cap 行：icon + label + 可选 headerToggle + 整行 action 下钻参数页 */
function envCapRow(cap: SceneCapability): PreviewMenuNode {
  const master = capMasterNode(cap);
  return {
    id: `env-cap-${cap.id}`,
    kind: "row",
    labelKey: cap.labelKey,
    label: cap.id,
    icon: cap.icon,
    rowDensity: "compact",
    ...(master?.control?.get
      ? {
          headerToggle: {
            // PreviewControlSpec 无 control.value 字段
            // （静态值在节点级 PreviewMenuNode.value）——原 (control as any).value
            // 分支不可达 + 违反禁 any 规则；master 节点恒带 control.get（toggle 契约），
            // 门控 get 即取真值源
            value: master.control.get(undefined) as boolean,
            onChange: (v: boolean) => {
              master.control?.set?.(v);
            },
          },
        }
      : {}),
    action: (ctx) => ctx.navigate?.(envCapSubview(cap)),
  };
}

/**
 * cap 导航行按 ENV_SECTIONS 聚拢成卡牌节点（kind:"card"）。
 * 空段不建卡壳（rmAppendCard 亦有一次 visibleWhen 兜底）；未登记 cap 落末尾「其它」。
 */
function buildEnvCards(caps: SceneCapability[]): PreviewMenuNode[] {
  const claimed = new Set<string>();
  const out: PreviewMenuNode[] = [];
  for (const sec of ENV_SECTIONS) {
    const rows = caps.filter((c) => sec.caps.includes(c.id));
    if (rows.length === 0) continue;
    for (const c of rows) claimed.add(c.id);
    out.push({
      id: sec.id,
      kind: "card",
      labelKey: sec.labelKey,
      // [可折叠卡] 顶行标题可点击折叠内容区（collapsible 卡统一盒式折叠视觉，
      // 与子视图分组折叠同一形态；折叠态跨 refresh 记忆）
      collapsible: true,
      children: rows.map(envCapRow),
    });
  }
  const rest = caps.filter((c) => !claimed.has(c.id));
  if (rest.length > 0) {
    out.push({
      id: "env-card-other",
      kind: "card",
      labelKey: "preview.envSectionOther",
      // [可折叠卡] 与基础/氛围卡同款可折叠（未登记 cap 归此处，折叠保语义聚拢不遮挡其余行）
      collapsible: true,
      children: rest.map(envCapRow),
    });
  }
  return out;
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
      },
    ];
  }
  return [
    {
      id: "env-preset-bar",
      kind: "select",
      labelKey: "preview.envPresetThumbnail",
      control: {
        options: PRESET_ORDER.map((p) => ({
          value: p.id,
          label: `${p.icon} ${tOf(p.labelKey)}`,
        })),
        // 显示值读 environment cap 实际 preset
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
    ...buildEnvCards(caps),
  ];
}
