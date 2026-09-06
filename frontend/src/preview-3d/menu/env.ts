// ===== 环境菜单声明式 Schema（ADR-076 + ADR-106）=====

import { tr } from "../../core/i18n/tr.ts";
import type { SlideMenuHandle } from "../../ui/ui-slide-menu.ts";
import { ENV_PRESET_LINKAGE, type EnvPresetId } from "../caps/environment-capability.ts";
import type { MenuControlDef, SceneCapability } from "../caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { SkyCapability } from "../caps/sky-capability.ts";
import { type PreviewSnapshot, previewSnapshot } from "../state/preview-state.ts";
import type { PreviewMenuCtx, PreviewMenuNode } from "./node-types.ts";

const ENV_IDS = new Set(["sky", "ground", "water", "environment", "fog", "reflector"]);
const ORDERED_IDS = ["sky", "ground", "water", "environment", "fog", "reflector"] as const;

// ── 环境面板局部刷新：订阅 cap 参数变更触发 menu.refresh()（重渲染栈顶 = 当前子视图）──
// render 闭包改为每次重算（见 renderEnvLevel 下钻），故 refresh 即反映最新 visible?（模式/状态切换后分组不靠退出重进）。
let _envCapUnsubs: Array<() => void> = [];
function rebuildEnvSubs(caps: SceneCapability[], menu: SlideMenuHandle): void {
  for (const u of _envCapUnsubs) u();
  _envCapUnsubs = [];
  for (const c of caps) {
    if (c.subscribe) _envCapUnsubs.push(c.subscribe(() => menu.refresh()));
  }
}
/** 会话结束/面板卸载时清理订阅，避免 cap 单例持有过期 menu 引用（renderEnvLevel 每次重跑也会重建，此处为显式出口） */
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
/** 按 group 字段把控件分组成「平级入口」：保序；base 组（无 group 的控件）用 cap 名作标题。
 * 用于环境子视图——带分区的 cap（ground 的 地面/水面/表面材质、reflector 的参数）进入后先列分区入口，
 * 各自下钻，消除「地面」入口内水面/材质混排的迷感。单组（无 group）cap 仍走原平铺。 */
function partitionCapControlsByGroup(
  cap: SceneCapability,
  ctrls: MenuControlDef[],
  snapshot?: PreviewSnapshot,
): { key: string | null; label: string; ctrls: MenuControlDef[] }[] {
  const groups = new Map<string | null, MenuControlDef[]>();
  for (const c of ctrls) {
    // [铁律收口] B 轨唯一：状态层快照谓词 visibleWhen(s)——与 renderCapControls 同口径，
    // 避免「分区入口出现但控件实际被隐藏」的错配。A 轨 visible 闭包已整体删除（2026-09）。
    if (c.visibleWhen && snapshot && !c.visibleWhen(snapshot)) continue;
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

// ── ADR-193 第三刀：环境面板声明式化（folder 内联展开，renderEnvLevel 过程式渲染退役）──
// 交互形态拍板（2026-09-06）：cap 分组下钻由 menu.navigate 子页改为 folder 手风琴内联展开，
// 复用现有 folder 节点原语零新机制；开合态经 render.ts rmAppendFolder 的按 id 记忆跨 refresh 保持。
// 预设栏保留（ENV_PRESET_LINKAGE 是跨 cap 联动：sky+fog+envIntensity，与 environment cap
// 自报的 env-preset preset-thumb（仅切 envMap）职责不同，非重复真值）——声明式化为 select 单行。

/** 预设 select 当前值（模块级：预设无状态层路径，applyPreset 写入；旧 UI 按钮本就无选中态显示） */
let _lastEnvPreset: Exclude<EnvPresetId, "custom"> = "studio";

/** 节点 label 的 labelKey 需要 i18n 键：group key 本身就是键（partitionCapControlsByGroup 的
 *  label = tr(k, k)），base 组（无 group）回退 cap.labelKey */
function envCapFolder(cap: SceneCapability): PreviewMenuNode {
  // 惰性分区：controls 传函数引用，每次渲染重取 getMenuControls + 重分区
  //（visibleWhen B 轨实时——水模式切换后 Pool/Look 组成员随订阅 refresh 重建）
  const parts = () => partitionCapControlsByGroup(cap, cap.getMenuControls(), previewSnapshot());
  const stripGroup = (cs: MenuControlDef[]): MenuControlDef[] =>
    cs.map(({ group: _grp, ...rest }) => rest);
  const partsNow = parts();
  let children: PreviewMenuNode[];
  if (partsNow.length > 1) {
    // 多组 cap（ground 的 水面/表面材质、water 的 形态/水池/观感）：组内嵌一层 folder
    children = partsNow.map((g) => {
      const gid = `env-cap-${cap.id}-grp-${g.key ?? "base"}`;
      return {
        id: gid,
        kind: "folder",
        labelKey: g.key ?? cap.labelKey,
        fallback: g.key ?? cap.id,
        children: [
          {
            id: `${gid}-ctrls`,
            kind: "controls",
            controls: () => {
              const cur = parts().find((x) => x.key === g.key);
              return cur ? stripGroup(cur.ctrls) : [];
            },
          },
        ],
      };
    });
  } else {
    children = [
      {
        id: `env-cap-${cap.id}-ctrls`,
        kind: "controls",
        controls: () => stripGroup(cap.getMenuControls()),
      },
    ];
  }
  return {
    id: `env-cap-${cap.id}`,
    kind: "folder",
    labelKey: cap.labelKey,
    fallback: cap.id,
    icon: cap.icon,
    defaultOpen: false,
    children,
  };
}

/**
 * 环境面板声明式 schema（ADR-193 第三刀）。
 * 结构：氛围预设 select（跨 cap 联动）+ 每 cap 一个 folder（单组平铺 / 多组嵌套）。
 * 空 caps → 空态提示单节点。menu 存在时重建 cap 订阅（cap 参数变更 → menu.refresh →
 * 面板重渲染 → 本函数重跑 → 分区/可见性实时）。
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
    ...caps.map(envCapFolder),
  ];
}
