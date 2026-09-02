// ===== 3D 预览声明式 Schema 构建器（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// schemaBuilders 五个构建器：camera / lighting / shadow / postproc / settings。
// cap 缺席时渲染单行提示行，不空白。
//
// [doc:adr-125 + adr-126-p4-a] settings 面板重构（P1 状态层 + P2 单渲染器 + 自动 cap 聚合）：
//   - 横切设置项（视锥裁剪 / 帧率 / 分辨率）改为纯数据 MenuControlDef，读写走
//     state/preview-state.ts 的统一路径（[adr-126-p4-a] 升格自 settings-state.ts）
//   - Bloom / PMREM / 线框三个开关不再手写——它们本就是 postprocessing / sky /
//     wireframe 三个 cap 自报控件（pp-enabled / sky-env / wireframe-toggle）的
//     重复真值来源，改由 collectSettingsCapControls() 自动聚合
//   - 新增 cap 想进设置面板：在自己文件里给控件加 settingsOrder 即可，本文件零改动

import type { PreviewMenuNode } from "./node-types.ts";
import { buildCameraControls } from "../adapters/camera-controls.ts";
import { t, type LocaleKey } from "../../core/i18n/t.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { MenuControlDef } from "../caps/scene-capability.ts";
import { getStateValue, setStateValue } from "../state/preview-state.ts";
import { getPerfPreset, setPerfPreset, type PerfLevel } from "../state/perf-presets.ts";
import type { SlideMenuHandle } from "../../ui/ui-slide-menu.ts";
import type { PreviewMenuCtx } from "./core.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名。
 *  key 有意接受 string（labelKey/group 数据字段 + 原文兜底），内部经 LocaleKey 收窄。 */
const tr = (key: string, fallback: string): string => {
  const v = t(key as LocaleKey);
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
    return [{ id: "lighting-empty", kind: "sectionTitle", labelKey: "preview.noLightCap", fallback: "进入 3D 后再打开灯光面板" }];
  }
  return [{ id: "lighting", kind: "controls", controls: () => lightCap.getMenuControls() }];
}

/** 阴影面板 schema：从 shadow cap 自报控件渲染 */
export function buildShadowSchema(_ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const fromReg = sceneCapabilityRegistry.getById("shadow") as import("../caps/shadow-capability.ts").ShadowCapability | null;
  if (!fromReg) {
    return [{ id: "shadow-empty", kind: "sectionTitle", labelKey: "preview.noShadowCap", fallback: "进入 3D 后再打开阴影面板" }];
  }
  return [{ id: "shadow", kind: "controls", controls: () => fromReg.getMenuControls() }];
}

/** 后处理面板 schema：从 postprocessing cap 自报控件渲染 */
export function buildPostprocessingSchema(_ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const fromReg = sceneCapabilityRegistry.getById("postprocessing") as import("../caps/postprocessing-capability.ts").PostprocessingCapability | null;
  if (!fromReg) {
    return [{ id: "postproc-empty", kind: "sectionTitle", labelKey: "preview.noPostprocCap", fallback: "进入 3D 后再打开后处理面板" }];
  }
  return [{ id: "postproc", kind: "controls", controls: () => fromReg.getMenuControls() }];
}

/** 设置面板 schema：性能（档位 + 横切数据节点）+ 画质（自动 cap 聚合）+ 脚注 */
export function buildSettingsSchema(ctx: PreviewMenuCtx, menu?: SlideMenuHandle): PreviewMenuNode[] {
  return [
    bsBuildSectionTitle("settings-perf-header", "preview.settingsPerf", "性能"),
    // 性能档位：一键套用低/中/高（数据表驱动）；切档后 menu.refresh() 刷新兄弟控件显示
    bsBuildPerfPresetRow(menu),
    // 传函数引用而非求值结果：每次 DOM 渲染时重取，cap 后创建/再渲染也能看见
    bsBuildControlsRow("settings-perf", buildCrossCuttingControls),
    bsBuildSectionTitle("settings-quality-header", "preview.settingsQuality", "画质"),
    bsBuildControlsRow("settings-quality", collectSettingsCapControls),
    bsBuildNote(),
  ];
}

// ── 设置面板：横切数据节点（无 cap 归属，统一走 settingsState 路径）──

/** 帧率上限选项（值 → i18n 键 → 回退） */
const FPS_OPTIONS: ReadonlyArray<{ value: string; labelKey: string; fallback: string }> = [
  { value: "30", labelKey: "preview.settingsFps30", fallback: "30 fps" },
  { value: "60", labelKey: "preview.settingsFps60", fallback: "60 fps" },
  { value: "120", labelKey: "preview.settingsFps120", fallback: "120 fps" },
  { value: "0", labelKey: "preview.settingsFpsUncapped", fallback: "不限" },
];

/**
 * 横切设置控件（ADR-125 P1）：三项各自原为 20-30 行手写 DOM 闭包 + 独立读写通道，
 * 现统一为纯数据节点，读写经 `settingsState` 的 `render.*` 路径。
 */
export function buildCrossCuttingControls(): MenuControlDef[] {
  return [
    {
      id: "settings-frustum-cull",
      kind: "toggle",
      labelKey: "preview.settingsFrustumCull",
      fallback: "视锥裁剪",
      hintKey: "preview.settingsFrustumCullHint",
      getValue: () => getStateValue("render.frustumCull") as boolean,
      setValue: (v) => setStateValue("render.frustumCull", v),
    },
    {
      id: "settings-fps",
      kind: "select",
      labelKey: "preview.settingsMaxFps",
      fallback: "帧率上限",
      select: FPS_OPTIONS.map((o) => ({
        value: o.value,
        label: tr(o.labelKey, o.fallback),
      })),
      getValue: () => String(getStateValue("render.maxFps")),
      setValue: (v) => setStateValue("render.maxFps", v),
    },
    {
      id: "settings-pixel-ratio",
      kind: "slider",
      labelKey: "preview.settingsMaxPixelRatio",
      fallback: "渲染分辨率上限",
      getValue: () => getStateValue("render.maxPixelRatio") as number,
      // 拖动是高频写入：跳过通知，避免每 0.25 步进触发面板重算
      setValue: (v) => setStateValue("render.maxPixelRatio", v, { notify: false }),
      // 松手提交是离散操作：广播一次，供 subscribe 驱动的面板重算/谓词响应
      slider: { min: 0.5, max: 2, step: 0.25, unit: "x", onCommit: (v) => setStateValue("render.maxPixelRatio", v) },
    },
  ];
}

// ── 设置面板：自动 cap 聚合（ADR-125 P2）──

/**
 * 遍历全部已创建 cap，收集声明了 `settingsOrder` 的控件，升序并入设置面板。
 *
 * 设计要点：
 *  - **settings 侧零接线**：新 cap 想进设置面板，只在自己文件里给控件加
 *    `settingsOrder`，本函数自动发现（`f0fa3e23` 那类「cap 已自报、面板却手写」
 *    的重复真值来源从此不可能发生）
 *  - **每次调用重取**：不在模块加载期缓存 cap 实例，规避 ADR-125 P3 明令禁止的
 *    「声明期求值 → cap 后创建则永不可见」（即 `05fe24b7` 所修同类病）
 *  - **抹平 group**：设置面板是扁平视图，剥掉 cap 自身的折叠分组壳，
 *    避免「高级」等 section 混进设置页
 *  - 未声明 settingsOrder 的控件不进设置面板（否则 pp 的 20 个高级控件会淹没它）
 */
export function collectSettingsCapControls(): MenuControlDef[] {
  const out: MenuControlDef[] = [];
  for (const cap of sceneCapabilityRegistry.getAll()) {
    for (const c of cap.getMenuControls()) {
      if (c.settingsOrder === undefined) continue;
      out.push(c);
    }
  }
  out.sort((a, b) => (a.settingsOrder ?? 0) - (b.settingsOrder ?? 0));
  return out.map((c) => ({ ...c, group: undefined }));
}

/** 设置面板全部控件（横切 + 聚合）；导出供契约测试断言 id 与顺序，无需 DOM */
export function buildSettingsControls(): MenuControlDef[] {
  return [...buildCrossCuttingControls(), ...collectSettingsCapControls()];
}

// ── 通用节点工厂 ──

/** 性能档位 select（低/中/高/自定义）：切档 = 数据表套用（perf-presets.ts）+ 面板刷新。
 *  自定义 = 不套用，保持用户手调。档位表是纯数据，新增档位/参数零代码接线。
 *  声明式 select 节点（control.get/set 闭包 + onChange 刷新），不再手写 DOM 壳。 */
function bsBuildPerfPresetRow(menu?: SlideMenuHandle): PreviewMenuNode {
  const LEVELS: Array<{ value: PerfLevel; labelKey: string; fallback: string }> = [
    { value: "low", labelKey: "preview.settingsPerfLow", fallback: "低" },
    { value: "medium", labelKey: "preview.settingsPerfMedium", fallback: "中" },
    { value: "high", labelKey: "preview.settingsPerfHigh", fallback: "高" },
    { value: "custom", labelKey: "preview.settingsPerfCustom", fallback: "自定义" },
  ];
  return {
    id: "settings-perf-preset",
    kind: "select",
    control: {
      options: LEVELS.map((lv) => ({ value: lv.value, label: tr(lv.labelKey, lv.fallback) })),
      get: (): unknown => getPerfPreset(),
      set: (v): void => {
        setPerfPreset(v as PerfLevel);
        // 切档后兄弟控件（fps/分辨率/Bloom）显示值已变——重渲染当前面板
        menu?.refresh();
      },
    },
  };
}

function bsBuildSectionTitle(id: string, labelKey: string, fallback: string): PreviewMenuNode {
  return { id, kind: "sectionTitle", labelKey, fallback };
}

/**
 * 把一组 MenuControlDef 包成声明式 controls 节点，交给唯一控件渲染器 renderCapControls。
 *
 * `controls` 传**函数引用**时每次渲染求值（惰性）——规避 ADR-125 P3 明令禁止的
 * 「构建期求值 → cap 后创建则永不可见」（即 05fe24b7 所修同类病）：
 * 节点只持有 supplier，cap 何时创建、面板何时重渲染，都取最新全量。
 */
function bsBuildControlsRow(
  id: string,
  controls: MenuControlDef[] | (() => MenuControlDef[]),
): PreviewMenuNode {
  return { id, kind: "controls", controls };
}

function bsBuildNote(): PreviewMenuNode {
  return {
    id: "settings-note",
    kind: "sectionTitle",
    labelKey: "preview.settingsNote",
    fallback: "分辨率上限需重新进入 3D 预览生效；其余开关即时生效。",
  };
}
