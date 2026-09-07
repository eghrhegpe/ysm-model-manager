// ===== 3D 预览声明式 Schema 构建器（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// schemaBuilders 五个构建器：camera / lighting / shadow / postproc / settings。
// cap 缺席时渲染单行提示行，不空白。
//
// [doc:adr-125 + adr-126-p4-a] settings 面板重构（P1 状态层 + P2 单渲染器 + 自动 cap 聚合）：
//   - 横切设置项（视锥裁剪 / 帧率 / 分辨率）改为纯数据控件定义，读写走
//     state/preview-state.ts 的统一路径（[adr-126-p4-a] 升格自 settings-state.ts）
//   - 线框开关不再手写——它本就是 RenderModeCapability 自报控件（rm-wireframe /
//     wireframe-toggle）的重复真值来源，改由 collectSettingsCapControls() 自动聚合。
//     Bloom/PMREM 总开关（pp-enabled/sky-env）已退场：总开关归各自面板
//     （后处理/环境）基座级，不再复制进设置页画质分组——设置页只留渲染模式类开关。
//   - 新增 cap 想进设置面板：在自己文件里给控件加 settingsOrder 即可，本文件零改动

import { tr } from "@/core/i18n/tr.ts";
import type { SlideMenuHandle } from "@/ui/ui-slide-menu.ts";
import { safeSet } from "@/utils/dom/storage.ts";
import type { PreviewControlDef } from "../caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { TD_CAMSPEED_KEY, TD_ROTMODE_KEY } from "../keymap.ts";
import { getPerfPreset, type PerfLevel, setPerfPreset } from "../state/perf-presets.ts";
import { getStateValue, setStateValue } from "../state/preview-state.ts";
import { capControlsToNodes } from "./cap-to-node.ts";
import type { PreviewMenuCtx, PreviewMenuNode } from "./node-types.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名。
 *  key 有意接受 string（labelKey/group 数据字段 + 原文兜底），内部经 LocaleKey 收窄。 */
// ── 声明式 Schema 构建器（供 schemaBuilders 映射调用）──

/** 相机面板 schema（ADR-193 第一刀：renderCustom 逃生舱退役）：
 *  旋转模式 select / 速度 slider / 重置 button 三声明式节点，control 闭包经
 *  ctx.getCamBridge() 惰性取桥（禁构建期捕获，对齐 ADR-125 P3「禁止构建期求值」口径），
 *  持久化键 td-rot-mode / td-cam-speed 与旧 buildCameraControls 逐字对齐。 */
export function buildCameraSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  return [
    {
      id: "camera-orbit",
      kind: "select",
      labelKey: "preview.cameraRotation",
      fallback: "摄像机旋转",
      control: {
        options: [
          { value: "orbit", label: "环绕" },
          { value: "free", label: "自身" },
        ],
        get: () => (ctx.getCamBridge().getOrbit() ? "orbit" : "free"),
        set: (v) => {
          const orbit = v === "orbit";
          ctx.getCamBridge().setOrbit(orbit);
          safeSet(TD_ROTMODE_KEY, orbit ? "orbit" : "free");
        },
      },
    },
    {
      id: "camera-speed",
      kind: "slider",
      labelKey: "preview.cameraSpeed",
      fallback: "摄像机速度",
      control: {
        min: 2,
        max: 200,
        step: 1,
        get: () => ctx.getCamBridge().getSpeed(),
        set: (n) => {
          ctx.getCamBridge().setSpeed(Number(n));
          safeSet(TD_CAMSPEED_KEY, String(n));
        },
      },
    },
    {
      id: "camera-reset",
      kind: "button",
      labelKey: "preview.resetView",
      fallback: "重置视角",
      action: () => ctx.getCamBridge().reset(),
    },
  ];
}

/** 灯光面板 schema：从 light cap 自报控件渲染 */
export function buildLightingSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const lightFromReg = sceneCapabilityRegistry.getById("light");
  const lightCap =
    lightFromReg ??
    (() => {
      const fromCtx = ctx.getCap("light");
      if (fromCtx && "getMenuNodes" in fromCtx)
        return fromCtx as unknown as import("../caps/light-capability.ts").LightCapability;
      return null;
    })();
  if (!lightCap) {
    return [
      {
        id: "lighting-empty",
        kind: "sectionTitle",
        labelKey: "preview.noLightCap",
        fallback: "进入 3D 后再打开灯光面板",
      },
    ];
  }
  return lightCap.getMenuNodes?.() ?? [];
}

/** 阴影面板 schema：从 shadow cap 直产节点渲染 */
export function buildShadowSchema(_ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const fromReg = sceneCapabilityRegistry.getById("shadow");
  if (!fromReg) {
    return [
      {
        id: "shadow-empty",
        kind: "sectionTitle",
        labelKey: "preview.noShadowCap",
        fallback: "进入 3D 后再打开阴影面板",
      },
    ];
  }
  return fromReg.getMenuNodes?.() ?? [];
}

/** 后处理面板 schema：从 postprocessing cap 直产节点渲染 */
export function buildPostprocessingSchema(_ctx: PreviewMenuCtx): PreviewMenuNode[] {
  const fromReg = sceneCapabilityRegistry.getById("postprocessing");
  if (!fromReg) {
    return [
      {
        id: "postproc-empty",
        kind: "sectionTitle",
        labelKey: "preview.noPostprocCap",
        fallback: "进入 3D 后再打开后处理面板",
      },
    ];
  }
  return fromReg.getMenuNodes?.() ?? [];
}

/** 设置面板 schema：性能（档位 + 横切数据节点）+ 画质（自动 cap 聚合）+ 脚注。
 *  每次面板渲染重构建（core.ts schemaBuilder），collectSettingsCapControls 内部实时遍历
 *  registry——「cap 后创建可见」由 schema 重建语义保证（对齐 ADR-125 P3）。 */
export function buildSettingsSchema(
  _ctx: PreviewMenuCtx,
  menu?: SlideMenuHandle,
): PreviewMenuNode[] {
  return [
    bsBuildSectionTitle("settings-perf-header", "preview.settingsPerf", "性能"),
    // 性能档位：一键套用低/中/高（数据表驱动）；切档后 menu.refresh() 刷新兄弟控件显示
    bsBuildPerfPresetRow(menu),
    // [ADR-195 刀 2.5] 横切控件转节点展开（原 controls 通道退役）
    ...capControlsToNodes(buildCrossCuttingControls()),
    bsBuildSectionTitle("settings-quality-header", "preview.settingsQuality", "画质"),
    // [ADR-195 刀 2.5] cap 聚合节点直接展开（collectSettingsCapControls 返回节点数组）
    ...collectSettingsCapControls(),
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
export function buildCrossCuttingControls(): PreviewControlDef[] {
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
      slider: {
        min: 0.5,
        max: 2,
        step: 0.25,
        unit: "x",
        onCommit: (v) => setStateValue("render.maxPixelRatio", v),
      },
    },
  ];
}

// ── 设置面板：自动 cap 聚合（ADR-125 P2）──

/**
 * 遍历全部已创建 cap，收集声明了 `settingsOrder` 的控件节点，升序并入设置面板。
 *
 * [ADR-195 刀 2.5 全节点化] 返回 PreviewMenuNode[]（不再投影回控件定义）：
 *   - 全部 cap（10 个均已迁移）：从 getMenuNodes 节点树递归收集带 settingsOrder 的
 *     节点（folder 壳不收、其 children 递归展平）
 * 渲染侧由 renderMenu 直渲染节点（settings-quality 展开），不再包 controls 节点。
 *
 * 其余设计要点（沿用）：
 *  - **settings 侧零接线**：新 cap 想进设置面板，只在自己文件里给控件加
 *    `settingsOrder`，本函数自动发现
 *  - **每次调用重取**：不在模块加载期缓存 cap 实例，规避 ADR-125 P3「声明期求值」
 *  - 未声明 settingsOrder 的控件不进设置面板（否则 pp 的 20 个高级控件会淹没它）
 */
export function collectSettingsCapControls(): PreviewMenuNode[] {
  const out: PreviewMenuNode[] = [];
  for (const cap of sceneCapabilityRegistry.getAll()) {
    if (cap.getMenuNodes) {
      // 递归展平 folder：settings 扁平视图不收 folder 壳，但其 children 可能带
      // settingsOrder（fake/桥接节点同 group 控件被包 folder 时）。真实 cap 的
      // settingsOrder 节点多为平铺顶层，递归兜底 folder 内声明。
      const walk = (nodes: PreviewMenuNode[]): void => {
        for (const n of nodes) {
          if (n.kind === "folder" && n.children) {
            walk(n.children);
            continue;
          }
          if (n.settingsOrder === undefined) continue;
          out.push(n);
        }
      };
      walk(cap.getMenuNodes());
    }
  }
  out.sort((a, b) => (a.settingsOrder ?? 0) - (b.settingsOrder ?? 0));
  // 节点形态无 group 字段（folder 已剥）——无需抹平 group
  return out;
}

/** 设置面板全部控件节点（横切 + 聚合）；导出供契约测试断言 id 与顺序，无需 DOM。
 *  [ADR-195 刀 2.5] 统一 PreviewMenuNode[]：横切控件定义（PreviewControlDef）经 capControlsToNodes
 *  桥接成节点，与聚合节点同流。 */
export function buildSettingsControls(): PreviewMenuNode[] {
  return [...capControlsToNodes(buildCrossCuttingControls()), ...collectSettingsCapControls()];
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

function bsBuildNote(): PreviewMenuNode {
  return {
    id: "settings-note",
    kind: "sectionTitle",
    labelKey: "preview.settingsNote",
    fallback: "分辨率上限需重新进入 3D 预览生效；其余开关即时生效。",
  };
}
