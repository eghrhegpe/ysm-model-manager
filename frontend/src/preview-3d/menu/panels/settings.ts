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

import type { LocaleKey } from "@/core/i18n/t.ts";
import { tOf } from "@/core/i18n/t.ts";
import type { SceneCapability } from "@/preview-3d/caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import { TD_CAM_SPEED, TD_PIXEL_RATIO, TD_ROT_MODE } from "@/preview-3d/infra/settings-schema.ts";
import type {
  NodeFor,
  PreviewMenuCtx,
  PreviewMenuNode,
} from "@/preview-3d/menu/schema/node-types.ts";
import type { SlideMenuHandle } from "@/preview-3d/menu/shell/slide-menu.ts";
import { getPerfPreset, type PerfLevel, setPerfPreset } from "@/preview-3d/state/perf-presets.ts";
import { getStateValue, setStateValue } from "@/preview-3d/state/preview-state.ts";
import { safeSet } from "@/utils/base/primitives/storage.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名。
 *  key 有意接受 string（labelKey/group 数据字段 + 原文兜底），内部经 LocaleKey 收窄。 */
// ── 声明式 Schema 构建器（供 schemaBuilders 映射调用）──

/** 相机面板 schema（ADR-193 第一刀：renderCustom 逃生舱退役）：
 *  旋转模式 select / 速度 slider / 重置 button 三声明式节点，control 闭包经
 *  ctx.getCamBridge() 惰性取桥（禁构建期捕获，对齐 ADR-125 P3「禁止构建期求值」口径）。
 *  持久化键 / 值域 / 枚举全部消费 `infra/settings-schema.ts`（ADR-303：与主设置页同源，
 *  曾三处各写一份裸字面量——改一处漏一处即「拖了没反应且无报错」）。 */
export function buildCameraSchema(ctx: PreviewMenuCtx): PreviewMenuNode[] {
  return [
    {
      id: "camera-orbit",
      kind: "select",
      labelKey: "preview.cameraRotation",
      control: {
        options: [
          { value: TD_ROT_MODE.orbit, label: "环绕", labelKey: "preview.cameraRotationOrbit" },
          { value: TD_ROT_MODE.free, label: "自身", labelKey: "preview.cameraRotationFree" },
        ],
        get: () => (ctx.getCamBridge().getOrbit() ? TD_ROT_MODE.orbit : TD_ROT_MODE.free),
        set: (v) => {
          const orbit = v === TD_ROT_MODE.orbit;
          ctx.getCamBridge().setOrbit(orbit);
          safeSet(TD_ROT_MODE.key, orbit ? TD_ROT_MODE.orbit : TD_ROT_MODE.free);
        },
      },
    },
    {
      id: "camera-speed",
      kind: "slider",
      labelKey: "preview.cameraSpeed",
      control: {
        min: TD_CAM_SPEED.min,
        max: TD_CAM_SPEED.max,
        step: TD_CAM_SPEED.step,
        get: () => ctx.getCamBridge().getSpeed(),
        set: (n) => {
          ctx.getCamBridge().setSpeed(Number(n));
          safeSet(TD_CAM_SPEED.key, String(n));
        },
      },
    },
    {
      id: "camera-reset",
      kind: "button",
      labelKey: "preview.resetView",
      action: () => ctx.getCamBridge().reset(),
    },
  ];
}

/**
 * cap 面板节点：取完整节点树，剔除能力总开关节点（getMasterNodeId）。
 * 与 env 面板 envCapSubNodes 同一「简单数组 filter」范式——能力总开关已升一级
 * （场景组根视图 / env 面板行）headerToggle，二级面板渲染时 filter 掉主节点防双份。
 * 长治久安：删二级开关 = 删 getMasterNodeId 声明，纯数据驱动，无旁路硬编码。
 */
function capPanelNodes(cap: SceneCapability): PreviewMenuNode[] {
  const all = cap.getMenuNodes?.() ?? [];
  const masterId = cap.getMasterNodeId?.();
  if (!masterId) return all;
  return all.filter((n) => n.id !== masterId);
}

/** 灯光面板 schema：从 light cap 自报控件渲染。
 *  [锐评根治 2026-10] 去双 cast 后门：capPanelNodes 只依赖 SceneCapability 通用接口
 *  （getMenuNodes/getMasterNodeId 均为其可选成员），原兜底通道把 ctx.getCap 结果
 *  `as unknown as LightCapability` 收窄属多余——registry 缺席时按通用接口降级渲染，
 *  不再谎称具体类型（消费方 shadow/postproc 面板同款单通道口径）。
 *  [ADR-293] 接受 menu 句柄并把 cap.subscribe 接入面板重绑（见 rebindSceneCapSubs）。 */
export function buildLightingSchema(
  ctx: PreviewMenuCtx,
  menu?: SlideMenuHandle,
): PreviewMenuNode[] {
  const fromCtx = ctx.getCap("light");
  const lightCap: SceneCapability | undefined =
    sceneCapabilityRegistry.getById("light") ?? (fromCtx?.getMenuNodes ? fromCtx : undefined);
  if (!lightCap) {
    return [
      {
        id: "lighting-empty",
        kind: "sectionTitle",
        labelKey: "preview.noLightCap",
      },
    ];
  }
  // [ADR-293] 每次 schema 重建重绑 cap 离散变更订阅 → menu.refresh()（对齐 env.ts
  // rebuildEnvSubs 的 per-menu WeakMap 样板）：跨会话共享 cap / 程序化写灯时，
  // 打开中的灯光面板与场景同步；未实现 subscribe 的 cap 自然跳过。
  rebindSceneCapSubs(menu, lightCap);
  return capPanelNodes(lightCap);
}

/** 场景面板 cap 订阅表（[ADR-293]）：WeakMap 值存「已绑 cap + 退订句柄」——同一
 *  (menu, cap) 只绑一次。per-menu 隔离（多挂载实例互不清对方订阅），menu 句柄回收
 *  时表项随弱键自动消失。 */
const _sceneCapSubsByMenu = new WeakMap<
  SlideMenuHandle,
  { cap: SceneCapability; unsub: () => void }
>();

function rebindSceneCapSubs(menu: SlideMenuHandle | undefined, cap: SceneCapability): void {
  if (!menu) return;
  // [ADR-293 复核 P0] 幂等早退：cap 未变则不动订阅。原「每次渲染退订重订」与面板
  // refresh 的同步重入（notify → refresh → 本函数）组合成活 Set 迭代自激回路——
  // 探针实测一次 notify 触发 501 次 schema 重建冻结页面。listener-set 快照迭代已是
  // 第一道闸，此处幂等是第二道：不产生每帧无谓的闭包 churn。
  if (_sceneCapSubsByMenu.get(menu)?.cap === cap) return;
  _sceneCapSubsByMenu.get(menu)?.unsub();
  if (!cap.subscribe) {
    _sceneCapSubsByMenu.delete(menu);
    return;
  }
  _sceneCapSubsByMenu.set(menu, { cap, unsub: cap.subscribe(() => menu.refresh()) });
}

/** 会话卸载时清场景面板 cap 订阅（与 disposeEnvSubscriptions 并列入 core dispose 链，
 *  防 cap 单例持有过期 menu 引用） */
export function disposeSceneCapSubscriptions(menu: SlideMenuHandle): void {
  const bound = _sceneCapSubsByMenu.get(menu);
  if (bound) {
    bound.unsub();
    _sceneCapSubsByMenu.delete(menu);
  }
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
      },
    ];
  }
  return capPanelNodes(fromReg);
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
      },
    ];
  }
  return capPanelNodes(fromReg);
}

/** 设置面板 schema：性能（档位 + 横切数据节点）+ 画质（自动 cap 聚合）+ 脚注。
 *  每次面板渲染重构建（core.ts schemaBuilder），collectSettingsCapControls 内部实时遍历
 *  registry——「cap 后创建可见」由 schema 重建语义保证（对齐 ADR-125 P3）。 */
export function buildSettingsSchema(
  _ctx: PreviewMenuCtx,
  menu?: SlideMenuHandle,
): PreviewMenuNode[] {
  return [
    bsBuildSectionTitle("settings-perf-header", "preview.settingsPerf"),
    // 性能档位：一键套用低/中/高（数据表驱动）；切档后 menu.refresh() 刷新兄弟控件显示
    bsBuildPerfPresetRow(menu),
    // [ADR-195 刀 2.5] 横切控件直产原生节点展开（桥接层退役）
    ...buildCrossCuttingNodes(),
    bsBuildSectionTitle("settings-quality-header", "preview.settingsQuality"),
    // [ADR-195 刀 2.5] cap 聚合节点直接展开（collectSettingsCapControls 返回节点数组）
    ...collectSettingsCapControls(),
    bsBuildNote(),
  ];
}

// ── 设置面板：横切数据节点（无 cap 归属，统一走 settingsState 路径）──

/** 帧率上限选项（值 → i18n 键 → 回退） */
const FPS_OPTIONS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: "30", labelKey: "preview.settingsFps30" },
  { value: "60", labelKey: "preview.settingsFps60" },
  { value: "120", labelKey: "preview.settingsFps120" },
  { value: "0", labelKey: "preview.settingsFpsUncapped" },
];

/**
 * 横切设置节点（ADR-125 P1）：三项各自原为 20-30 行手写 DOM 闭包 + 独立读写通道，
 * 现统一为纯数据节点，读写经 `settingsState` 的 `render.*` 路径。
 * [ADR-195 刀 1] 直产 PreviewMenuNode（简单控件原生节点 + control spec 闭包），
 * 不再经 cap-to-node 桥接层从 PreviewControlDef 投影。
 */
export function buildCrossCuttingNodes(): PreviewMenuNode[] {
  return [
    {
      id: "settings-frustum-cull",
      kind: "toggle",
      labelKey: "preview.settingsFrustumCull",
      label: "视锥裁剪",
      hintKey: "preview.settingsFrustumCullHint",
      control: {
        get: () => getStateValue("render.frustumCull") as boolean,
        set: (v) => setStateValue("render.frustumCull", v as boolean),
      },
    },
    {
      id: "settings-fps",
      kind: "select",
      labelKey: "preview.settingsMaxFps",
      label: "帧率上限",
      control: {
        options: FPS_OPTIONS.map((o) => ({
          value: o.value,
          label: tOf(o.labelKey),
        })),
        get: () => String(getStateValue("render.maxFps")),
        set: (v) => setStateValue("render.maxFps", v as string),
      },
    },
    {
      id: "settings-pixel-ratio",
      kind: "slider",
      labelKey: "preview.settingsMaxPixelRatio",
      label: "渲染分辨率上限",
      control: {
        min: TD_PIXEL_RATIO.min,
        max: TD_PIXEL_RATIO.max,
        step: TD_PIXEL_RATIO.step,
        unit: "x",
        get: () => getStateValue("render.maxPixelRatio") as number,
        // 拖动是高频写入：跳过通知，避免每 0.25 步进触发面板重算
        set: (v) => setStateValue("render.maxPixelRatio", v as number, { notify: false }),
        // 松手提交是离散操作：广播一次，供 subscribe 驱动的面板重算/谓词响应
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
 *  [ADR-195 刀 2.5] 统一 PreviewMenuNode[]：横切节点（buildCrossCuttingNodes 直产）
 *  与聚合节点同流。 */
export function buildSettingsControls(): PreviewMenuNode[] {
  return [...buildCrossCuttingNodes(), ...collectSettingsCapControls()];
}

// ── 通用节点工厂 ──

/** 性能档位 select（低/中/高/自定义）：切档 = 数据表套用（perf-presets.ts）+ 面板刷新。
 *  自定义 = 不套用，保持用户手调。档位表是纯数据，新增档位/参数零代码接线。
 *  声明式 select 节点（control.get/set 闭包 + onChange 刷新），不再手写 DOM 壳。 */
function bsBuildPerfPresetRow(menu?: SlideMenuHandle): NodeFor<"select"> {
  const LEVELS: Array<{ value: PerfLevel; labelKey: string }> = [
    { value: "low", labelKey: "preview.settingsPerfLow" },
    { value: "medium", labelKey: "preview.settingsPerfMedium" },
    { value: "high", labelKey: "preview.settingsPerfHigh" },
    { value: "custom", labelKey: "preview.settingsPerfCustom" },
  ];
  return {
    id: "settings-perf-preset",
    kind: "select",
    control: {
      options: LEVELS.map((lv) => ({
        value: lv.value,
        label: tOf(lv.labelKey),
      })),
      get: (): unknown => getPerfPreset(),
      set: (v): void => {
        setPerfPreset(v as PerfLevel);
        // 切档后兄弟控件（fps/分辨率/Bloom）显示值已变——重渲染当前面板
        menu?.refresh();
      },
    },
  };
}

function bsBuildSectionTitle(id: string, labelKey: LocaleKey): NodeFor<"sectionTitle"> {
  return { id, kind: "sectionTitle", labelKey };
}

function bsBuildNote(): NodeFor<"sectionTitle"> {
  return {
    id: "settings-note",
    kind: "sectionTitle",
    labelKey: "preview.settingsNote",
  };
}
