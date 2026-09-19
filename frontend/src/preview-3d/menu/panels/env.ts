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
import type {
  EnvPlacement,
  EnvSectionId,
  SceneCapability,
} from "@/preview-3d/caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import { renderMenu } from "@/preview-3d/menu/render/render.ts";
import type {
  PreviewActionMenuCtx,
  PreviewMenuCtx,
  PreviewMenuNode,
} from "@/preview-3d/menu/schema/node-types.ts";
import type { SlideMenuHandle, SlideMenuView } from "@/preview-3d/menu/shell/slide-menu.ts";
import { ATMOSPHERE_PRESETS } from "@/preview-3d/state/atmosphere-presets.ts";
import { setEnvState } from "@/preview-3d/state/env-state.ts";

/**
 * 环境面板卡壳描述符（ADR-268）：只定义「有哪几张卡、卡的标题与展示序」——这是
 * UI 分组语义，归菜单域。**成员与成员在卡内的序不再在此登记**：由各 env cap 经
 * `getEnvPlacement()` 自报（对齐设置面板节点级 `settingsOrder` 的插件范式）。
 * 新增环境 cap = 只改该 cap 一个文件，本文件零改动；新增/调整卡壳才动此处。
 */
const ENV_SECTION_DESCRIPTORS: ReadonlyArray<{
  section: EnvSectionId;
  id: string;
  labelKey: string;
}> = [
  { section: "basic", id: "env-card-basic", labelKey: "preview.envSectionBasic" },
  {
    section: "atmosphere",
    id: "env-card-atmosphere",
    labelKey: "preview.envSectionAtmosphere",
  },
];

/** 注册表遍历结果：一个入选环境面板的 cap 及其自报归属 */
type EnvEntry = { cap: SceneCapability; placement: EnvPlacement };

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
  // 清除本 menu 的预设回退缓存——cap 真值源在 environment cap 的 params.preset，
  // 本缓存仅作无 cap 时的回退；per-mount 隔离下随会话卸载清除，新会话同句柄回默认
  _lastEnvPresetByMenu.delete(menu);
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
/**
 * 遍历注册表收集环境面板成员（ADR-268 插件式发现）：凡实现 `getEnvPlacement()` 的 cap
 * 即入选，无需在此登记 id。非环境 cap（light/shadow/postproc/renderMode 等）不实现该方法
 * → 天然被排除。成员唯一来源即各 env cap 的自报，无兜底合成路径；空注册表返回 []，
 * buildEnvSchema 据此落「无环境」空态。
 */
function collectEnvEntries(): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const cap of sceneCapabilityRegistry.getAll()) {
    const placement = cap.getEnvPlacement?.();
    if (placement) entries.push({ cap, placement });
  }
  return entries;
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

/**
 * 预设 select 回退缓存（per-mount，按 menu 句柄隔离）：cap 真值源在 environment cap
 * 的 params.preset（select.get 优先读它）；本缓存仅在该 cap 缺席/custom 时作快预设回退。
 * 旧实现用模块级单值，多挂载/新会话共用模块时 A 实例选中的预设会串到 B 实例（跨会话污染）
 * ——收口为 WeakMap 后各 menu 独立，menu 句柄回收即随键消散。
 */
const DEFAULT_ENV_PRESET: Exclude<EnvPresetId, "custom"> = "studio";
const _lastEnvPresetByMenu = new WeakMap<SlideMenuHandle, Exclude<EnvPresetId, "custom">>();
function getLastEnvPreset(menu: SlideMenuHandle | undefined): Exclude<EnvPresetId, "custom"> {
  return (menu && _lastEnvPresetByMenu.get(menu)) || DEFAULT_ENV_PRESET;
}

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
 * cap 参数子视图渲染依赖桩（模块级，不引用 per-call 闭包态）：子视图内容全为控件
 * 节点/folder/controls——renderMenu 分派对 `panel`/`action`/`custom` 才触达 makeRow/
 * makePanelView，此路恒不达，故二者仅作「不该发生」的不变量占位（makePanelView 抛错
 * 即断言「子视图混入了导航节点」）；menu.refresh 承 refreshOnChange 语义（cap 控件经
 * onChange 闭包自刷新，此处少用）；actionCtx 供子视图内 button/row action 消费。
 * 旧实现在 envCapSubview 内每次下钻点击现造——上提为常量消除重复构造与噪音强转。
 */
const ENV_SUBVIEW_DEPS = {
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

/**
 * cap 参数子视图（navigate 落点）：把该 cap 参数节点树经 renderMenu 渲染——
 * 内容进入节点 schema 通道（刀1 桥接或刀2 直产统一出口）。
 * visibleWhen 过滤由 renderMenu 内部经 previewSnapshot() 求值（铁律收口）。
 */
function envCapSubview(cap: SceneCapability): SlideMenuView {
  return {
    title: tOf(cap.labelKey),
    render: (list) => {
      list.replaceChildren();
      renderMenu(list, envCapSubNodes(cap), ENV_SUBVIEW_DEPS);
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
 * cap 导航行按自报 `section` 聚拢进卡壳，卡内按 `order` 升序（ADR-268）。
 * 卡壳顺序 = ENV_SECTION_DESCRIPTORS 声明序；空段不建卡壳。
 * `EnvSectionId` 联合类型保证 cap 只可能报已定义的段，「未知段」分支仅防 JS/测试伪造，
 * 命中时落末尾「其它」卡（不静默丢失）。
 */
function buildEnvCards(entries: EnvEntry[]): PreviewMenuNode[] {
  const bySection = new Map<EnvSectionId, EnvEntry[]>();
  for (const e of entries) {
    const group = bySection.get(e.placement.section);
    if (group) group.push(e);
    else bySection.set(e.placement.section, [e]);
  }
  const known = new Set<EnvSectionId>();
  const out: PreviewMenuNode[] = [];
  for (const desc of ENV_SECTION_DESCRIPTORS) {
    known.add(desc.section);
    const group = (bySection.get(desc.section) ?? [])
      .slice()
      .sort((a, b) => a.placement.order - b.placement.order);
    if (group.length === 0) continue;
    out.push({
      id: desc.id,
      kind: "card",
      labelKey: desc.labelKey,
      // [可折叠卡] 顶行标题可点击折叠内容区（collapsible 卡统一盒式折叠视觉，
      // 与子视图分组折叠同一形态；折叠态跨 refresh 记忆）
      collapsible: true,
      children: group.map((e) => envCapRow(e.cap)),
    });
  }
  const rest = entries
    .filter((e) => !known.has(e.placement.section))
    .sort((a, b) => a.placement.order - b.placement.order);
  if (rest.length > 0) {
    out.push({
      id: "env-card-other",
      kind: "card",
      labelKey: "preview.envSectionOther",
      // [可折叠卡] 与其它卡同款可折叠（未知段 cap 归此处，折叠保语义聚拢不遮挡其余行）
      collapsible: true,
      children: rest.map((e) => envCapRow(e.cap)),
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
  const entries = collectEnvEntries();
  if (menu)
    rebuildEnvSubs(
      entries.map((e) => e.cap),
      menu,
    );
  if (entries.length === 0) {
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
        // 是单一真值源）——无该 cap 时回退本 menu 的 per-mount 快预设缓存
        // （custom 不在快预设 options 内时也回退到最近快预设）
        get: () => {
          const envCap = sceneCapabilityRegistry.getById("environment");
          const cur = envCap?.getPresetId?.();
          return cur && cur !== "custom" ? cur : getLastEnvPreset(menu);
        },
        set: (v) => {
          const preset = v as Exclude<EnvPresetId, "custom">;
          if (menu) _lastEnvPresetByMenu.set(menu, preset);
          applyPreset(ctx, preset, menu);
        },
      },
    },
    ...buildEnvCards(entries),
  ];
}
