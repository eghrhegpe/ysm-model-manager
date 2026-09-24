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
import { renderCapSelect, renderCapSlider } from "@/preview-3d/menu/render/cap-controls.ts";
import { nodeControlToView } from "@/preview-3d/menu/render/render.ts";
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

/** 设置面板 schema：性能（档位 + 横切数据节点）+ 画质（cap 归属小节自动聚合）+ 脚注。
 *  每次面板渲染重构建（core.ts schemaBuilder），collectSettingsCapSections 内部实时遍历
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
    // [2026-10 菜单收口] cap 归属小节：每个有 settingsOrder 控件的 cap = 小节标题 +
    // 该 cap 控件——原扁平聚合剥掉 folder 壳后控件失去 cap 归属语境，用户/面板侧
    // 都说不清「画质组里有什么、哪个开关属于哪个能力」；分小节由 registry 遍历派生，
    // 零接线性质保留（新 cap 仍只加 settingsOrder，小节自动出现）
    ...collectSettingsCapSections(),
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

// ── 设置面板：自动 cap 聚合（ADR-125 P2，2026-10 cap 归属分小节）──

/**
 * 单 cap 内收集声明了 `settingsOrder` 的控件节点：从 getMenuNodes 节点树递归展平
 * （folder 壳不收、其 children 递归展平——真实 cap 的 settingsOrder 节点多为平铺
 * 顶层，递归兜底 folder 内声明），cap 内按 settingsOrder 升序。
 * 纯收集，不插小节标题——分小节是 section 层职责（collectSettingsCapSections）。
 */
function collectCapSettingsControls(cap: SceneCapability): PreviewMenuNode[] {
  if (!cap.getMenuNodes) return [];
  const out: PreviewMenuNode[] = [];
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
  return out.sort((a, b) => (a.settingsOrder ?? 0) - (b.settingsOrder ?? 0));
}

/**
 * 画质段 cap 归属小节：每个有 settingsOrder 控件的 cap = 一小节
 * （`settings-cap-<capid>` section 标题，labelKey = cap 自报名 + 该 cap 控件升序）。
 * registry 实例化顺序 = 小节顺序（与 createAll 实例序同源，非全局 settingsOrder 交错）。
 *
 * 2026-10 菜单收口根治点：原扁平聚合（folder 壳被剥、控件裸摊）丢失 cap 归属语境——
 * 用户/面板侧说不清「画质组里有什么、哪个开关属于哪个能力」。小节仍由 registry 遍历
 * **自动派生**，零接线性质保留（新 cap 想进设置面板只加 `settingsOrder`，小节自动
 * 出现，本文件与 cap 侧皆零改动）；未声明 settingsOrder 控件的 cap 不出小节
 * （否则 pp 的 20 个高级控件会淹没它）。
 *
 * 其余设计要点（沿用）：
 *  - **每次调用重取**：不在模块加载期缓存 cap 实例，规避 ADR-125 P3「声明期求值」
 *  - [ADR-195 刀 2.5 全节点化] 返回 PreviewMenuNode[]，渲染侧 renderMenu 直渲染
 */
export function collectSettingsCapSections(): PreviewMenuNode[] {
  const out: PreviewMenuNode[] = [];
  for (const cap of sceneCapabilityRegistry.getAll()) {
    const capControls = collectCapSettingsControls(cap);
    if (capControls.length === 0) continue;
    out.push(bsBuildSectionTitle(`settings-cap-${cap.id}`, cap.labelKey));
    out.push(...capControls);
  }
  return out;
}

/** 画质段控件扁平列表（= collectSettingsCapSections 去掉小节标题；cap 归属顺序 ×
 *  cap 内升序）。导出供契约测试断言 id 与顺序，无需 DOM。 */
export function collectSettingsCapControls(): PreviewMenuNode[] {
  return collectSettingsCapSections().filter((n) => n.kind !== "sectionTitle");
}

/** 设置面板全部控件节点（横切 + 聚合）；导出供契约测试断言 id 与顺序，无需 DOM。
 *  [ADR-195 刀 2.5] 统一 PreviewMenuNode[]：横切节点（buildCrossCuttingNodes 直产）
 *  与聚合节点同流。⚠️ 本函数是**控件扁平视图**——schema 层（buildSettingsSchema）
 *  另经 collectSettingsCapSections 插入 cap 归属小节标题，两者不冲突。 */
export function buildSettingsControls(): PreviewMenuNode[] {
  return [...buildCrossCuttingNodes(), ...collectSettingsCapControls()];
}

// ── 通用节点工厂 ──

/** [2026-10 菜单收口] 切档后的定点刷新：档位表只改两条状态层路径
 *  （render.maxFps / render.maxPixelRatio），故只重渲受影响的两个兄弟控件行
 *  （fps select / 分辨率 slider），不再 menu.refresh() 全板重建——
 *  ① 全板重建牵动订阅重绑闸（ADR-293 P0 的 501 次自激教训就出在 refresh 路径上）；
 *  ② 用户刚操作完的档位 select DOM 被销毁 → 焦点/滚动位丢失（键盘 a11y 回归）。
 *  行经初绘渲染器（renderCapSelect/renderCapSlider）原位重渲——值渲染逻辑单一事实源，
 *  不写旁路回填；当前栈顶非设置面板（行查无）时天然 no-op。 */
function refreshPresetSiblings(menu?: SlideMenuHandle): void {
  if (!menu) return;
  const list = menu.list;
  for (const node of buildCrossCuttingNodes()) {
    if (node.id !== "settings-fps" && node.id !== "settings-pixel-ratio") continue;
    const old = list.querySelector<HTMLElement>(`[data-testid="cap-${node.id}"]`);
    // 「行在 list 里」而非 isConnected（detached 测试树同样合法；菜单 dispose 后
    // 行无 parent 天然跳过）
    if (!old?.parentElement) continue;
    const fresh = document.createElement("div");
    const view = nodeControlToView(node, menu);
    if (node.kind === "slider") renderCapSlider(fresh, view);
    else if (node.kind === "select") renderCapSelect(fresh, view);
    else continue;
    old.replaceWith(fresh.firstElementChild as HTMLElement);
  }
}

/** 性能档位 select（低/中/高/自定义）：切档 = 数据表套用（perf-presets.ts）+ 兄弟控件
 *  定点刷新（refreshPresetSiblings）。自定义 = 不套用，保持用户手调（值不变，重渲幂等）。
 *  档位表是纯数据，新增档位/参数零代码接线。声明式 select 节点（control.get/set 闭包），
 *  不再手写 DOM 壳。 */
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
        // [2026-10 菜单收口] 切档后只定点重渲受影响的兄弟行（fps select / 分辨率 slider），
        // 不再全板 menu.refresh()（订阅重绑闸 + 焦点/滚动位丢失，ADR-293 P0 教训所在路径）
        refreshPresetSiblings(menu);
      },
    },
  };
}

function bsBuildSectionTitle(id: string, labelKey: LocaleKey): NodeFor<"sectionTitle"> {
  return { id, kind: "sectionTitle", labelKey };
}

/** 脚注（[2026-10 菜单收口] 独立 `note` kind：小号弱色无分隔线，不再穿 sectionTitle 衣服——
 *  脚注不是分节标题，语义错位会让渲染器/样式无从区分「该给多大视觉权重」） */
function bsBuildNote(): NodeFor<"note"> {
  return {
    id: "settings-note",
    kind: "note",
    labelKey: "preview.settingsNote",
  };
}
