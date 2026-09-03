// ===== 3D 菜单声明式测试：拿真实菜单数组去测（对齐 MikuMikuAR 范式）=====
// CORE_MENU_ITEMS + ysm/mmd 适配器真实注入项 = 完整菜单数组（唯一事实来源）。
// 测试遍历本表断言：结构完整性（id/legacyTestId 唯一、必填字段、i18n 键、组归属）、
// dock 行全量渲染、安全面板逐个打开——加菜单项只改 menu 表，测试自动覆盖。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { MMD } from "@moeru/three-mmd";
import { zhCN } from "../../core/i18n/locales/zh-CN.ts";
import {
  CORE_MENU_ITEMS,
  PREVIEW_MENU_GROUPS,
} from "./defs.ts";
import type { PreviewMenuNode } from "./node-types.ts";
import { ysmMenuItems, type YsmMenuItemsOpts } from "../adapters/ysm-adapter.ts";
import { mmdMenuItems, type MmdMenuItemsOpts } from "../adapters/mmd-adapter.ts";
import { vrmMenuItems, type VrmMenuItemsOpts } from "../adapters/vrm-adapter.ts";
import { mountPreviewRootMenu, type PreviewMenuCtx } from "./core.ts";
import type { SceneCapability } from "../caps/scene-capability.ts";
import type { YsmModel, YsmContentHandle } from "../adapters/content-bridges.ts";
import type { Spec3D } from "../model3d.ts";
import { makeMenuCtx } from "../adapters/menu-test-fixtures.ts";
import type { BoneTree } from "../bone-tools.ts";
import {
  expectContainsAtLeast,
  expectNotContains,
  deriveTestIds,
  extractIds,
} from "../../test-utils/index.ts";

// ── 假依赖工厂（结构/行渲染/轻面板用；重面板 fill3DPanel/截图/骨骼 不执行）──

/** ysm 假依赖：仅喂结构断言与 dock 行渲染 */
function fakeYsmOpts(): YsmMenuItemsOpts {
  return {
    controlsCtx: {
      model: {} as unknown as YsmModel,
      texIdx: 0,
      texArr: [],
      spec: {} as unknown as Spec3D,
      handle: {} as unknown as YsmContentHandle,
    },
    bonePanel: fakeBonePanel(),
    // [doc:adr-126-p4-b-2] ysmShotNodes 经 panels 注入（R1 禁 utils→views 运行时依赖）
    panels: {
      shotNodes: () => [{ id: "ysm-shot-current", kind: "button" as const, labelKey: "x", fallback: "x" }],
    },
  };
}

/** mmd 假依赖：model/material/play 面板可真实渲染（轻量 DOM） */
function fakeMmdOpts(overrides: Partial<MmdMenuItemsOpts> = {}): MmdMenuItemsOpts {
  const mmd = {
    pmx: { bones: [], materials: [], morphs: [] },
  } as unknown as MMD;
  const mesh = {
    morphTargetDictionary: {},
    morphTargetInfluences: [],
  } as unknown as THREE.SkinnedMesh;
  return {
    navCtx: { mmd, mesh, modelName: "测试.pmx" },
    screenshot: null,
    material: {
      list: () => [{ index: 0, name: "mat0" }],
      getDetail: () => null,
      setVisible: vi.fn(),
      setOpacity: vi.fn(),
    },
    play: {
      clips: [{ label: "动作A" }, { label: "动作B" }],
      isPlaying: () => false,
      toggle: vi.fn(),
      currentIndex: () => 0,
      select: vi.fn(),
      animDir: null,
    },
    bonePanel: null,
    panels: {
      playNodes: () => [
        { id: "play-toggle", kind: "toggle" as const, labelKey: "x", fallback: "播放", control: { get: () => false, set: () => {} } },
        { id: "play-select", kind: "select" as const, labelKey: "x", fallback: "动作", control: { options: [], get: () => "0", set: () => {} } },
      ],
      // [doc:adr-126-p4-b-1] 声明式节点工厂经 panels 注入（R1 禁 utils→views 运行时依赖）
      modelInfoNodes: () => [{ id: "mmd-model-name", kind: "field", labelKey: "x", value: "测试.pmx" }],
      shotNodes: () => [],
    },
    ...overrides,
  };
}

function fakeBonePanel() {
  return {
    tree: null as unknown as BoneTree,
    viewContainer: null,
    camera: null,
    scene: null,
    cleanupRef: { current: null as (() => void) | null },
  };
}

function fakeVrmOpts(): VrmMenuItemsOpts {
  return {
    screenshot: null,
    modelInfo: { modelName: "测试.vrm", boneCount: 2, materialCount: 3 },
    modelPath: "a/test.vrm",
    bonePanel: fakeBonePanel(),
    material: {
      list: () => [{ index: 0, name: "Body" }],
      getDetail: () => ({ index: 0, name: "Body", visible: true, opacity: 1, transparent: false, type: "mtoon" }),
      setVisible: vi.fn(),
      setOpacity: vi.fn(),
    },
    panels: {
      // [doc:adr-126-p4-b-1] vrm model/shot 走 children 声明式（P5 收尾）：假工厂返回
      // 非空节点，契约测试「panel 必有渲染通道」要求 children 非空
      modelInfoNodes: () => [
        { id: "vrm-fake-info", icon: "🧪", kind: "field" as const, labelKey: "preview.nameLabel", fallback: "名称", value: "测试.vrm" },
      ],
      shotNodes: () => [
        { id: "vrm-fake-shot", icon: "📷", kind: "button" as const, labelKey: "preview.screenshot", fallback: "截图" },
      ],
    },
  };
}

/** 环境能力假 cap（environment 面板 env.skyGroundCap 谓词放行 + 渲染用） */
const fakeCap = {
  getTimeOfDay: () => 9,
  setTime: vi.fn(),
  getCloudCoverage: () => 0,
  setCloudCoverage: vi.fn(),
  isEnvironmentEnabled: () => true,
  setEnvironmentEnabled: vi.fn(),
  getVisible: () => true,
  setVisible: vi.fn(),
  getMenuControls: () => [
    { id: "sky-time", kind: "slider" as const, labelKey: "preview.timeOfDay", fallback: "时间", slider: { min: 0, max: 24, step: 0.5 }, getValue: () => 9, setValue: vi.fn() },
    { id: "sky-cloud", kind: "slider" as const, labelKey: "preview.cloudCoverage", fallback: "云量", slider: { min: 0, max: 1, step: 0.05 }, getValue: () => 0, setValue: vi.fn() },
    { id: "sky-env", kind: "toggle" as const, labelKey: "preview.environmentMapping", fallback: "环境贴图", getValue: () => true, setValue: vi.fn() },
    { id: "ground-visible", kind: "toggle" as const, labelKey: "preview.ground", fallback: "地面", getValue: () => true, setValue: vi.fn() },
  ],
} as unknown as SceneCapability;

function makeCtx(overrides: Partial<PreviewMenuCtx> = {}): PreviewMenuCtx {
  // 共享夹具薄包装：本文件测能力驱动 dock，默认注入 sky/ground fakeCap
  return makeMenuCtx({ getCap: (id) => (id === "sky" || id === "ground" ? fakeCap : null), ...overrides });
}

function mountWith(items: PreviewMenuNode[], ctxOverrides: Partial<PreviewMenuCtx> = {}) {
  const overlay = document.createElement("div");
  document.body.appendChild(overlay);
  const handle = mountPreviewRootMenu(overlay, makeCtx(ctxOverrides));
  handle.setAdapterItems(items);
  return { overlay, handle };
}

// ── 结构断言 ──

describe("真实菜单表结构（遍历 ysm/mmd/vrm 真实注入项）", () => {
  const ysmItems = ysmMenuItems(fakeYsmOpts());
  const mmdItems = mmdMenuItems(fakeMmdOpts({ bonePanel: fakeBonePanel() }));
  const vrmItems = vrmMenuItems(fakeVrmOpts());
  const allItems = [...CORE_MENU_ITEMS, ...ysmItems, ...mmdItems, ...vrmItems];

  it("id 唯一：core 内部 + 各适配器内部 + core∩适配器无交集（适配器按次挂载互斥）", () => {
    const uniq = (arr: string[]) => new Set(arr).size === arr.length;
    expect(uniq(CORE_MENU_ITEMS.map((d) => d.id))).toBe(true);
    expect(uniq(ysmItems.map((d) => d.id))).toBe(true);
    expect(uniq(mmdItems.map((d) => d.id))).toBe(true);
    expect(uniq(vrmItems.map((d) => d.id))).toBe(true);
    const coreIds = new Set(CORE_MENU_ITEMS.map((d) => d.id));
    [...ysmItems, ...mmdItems, ...vrmItems].forEach((d) => {
      expect(coreIds.has(d.id), `core 与适配器 id 冲突: ${d.id}`).toBe(false);
    });
  });

  it("legacyTestId 全局唯一（e2e 兼容锚点不撞车）", () => {
    const legacies = allItems.map((d) => d.legacyTestId).filter(Boolean);
    expect(new Set(legacies).size).toBe(legacies.length);
  });

  it("非 divider 项必有 icon/fallback/labelKey，kind/dockGroup 合法", () => {
    const groupIds = PREVIEW_MENU_GROUPS.map((g) => g.id);
    allItems.forEach((d) => {
      if (d.kind === "divider") return;
      expect(d.icon!.length, `${d.id}.icon`).toBeGreaterThan(0);
      expect(d.fallback!.length, `${d.id}.fallback`).toBeGreaterThan(0);
      expect(d.labelKey!.length, `${d.id}.labelKey`).toBeGreaterThan(0);
      expect(["panel", "action", "divider"]).toContain(d.kind);
      if (d.dockGroup) expect(groupIds, `${d.id}.dockGroup`).toContain(d.dockGroup);
    });
  });

  it("适配器注入项 panel 必有 render（renderCustom / children / schemaId 三选一）；action 必有 run（core 项走 fillers 映射，行为测试覆盖）", () => {
    [...ysmItems, ...mmdItems, ...vrmItems].forEach((d) => {
      // [doc:adr-126-p4-b-1 + p5-a] panel 内容三通道：renderCustom（命令式逃生舱）/
      // children（声明式节点）/ schemaId（受控 schema-registry 驱动）
      if (d.kind === "panel") {
        expect(
          typeof d.renderCustom === "function" || (d.children?.length ?? 0) > 0 || typeof d.schemaId === "string",
          `${d.id} 缺渲染通道（renderCustom / children / schemaId）`,
        ).toBe(true);
        // [doc:adr-126-p5-收口] 受控拦截：带 schemaId 的 panel 不得同时带 renderCustom——
        // 否则 schema 注册了也被逃生舱抢跑（渲染优先级链 schema 优先，双通道是歧义）
        if (typeof d.schemaId === "string") {
          expect(typeof d.renderCustom, `${d.id} 带 schemaId 不得同时带 renderCustom`).not.toBe("function");
        }
      }
      if (d.kind === "action") expect(typeof d.action, `${d.id}.action`).toBe("function");
    });
  });

  it("labelKey 全部有翻译（zh-CN 有键；三语一致性由 locales-consistency.test 保证）", () => {
    allItems.forEach((d) => {
      expect(d.labelKey! in zhCN, `${d.id} labelKey=${d.labelKey} 缺 zh-CN 翻译`).toBe(true);
    });
  });

  it("ysm 必需项齐全且归属按域分（model: 统计/截图；motion: 骨骼/播放——骨骼是动作驱动目标）", () => {
    expectContainsAtLeast(extractIds(ysmItems), ["bones", "model", "shot"], "ysm 必需项");
    // 统计/截图归模型组（dock 🧍 可达）
    ["model", "shot"].forEach((id) => {
      const item = ysmItems.find((d) => d.id === id)!;
      expect(item.dockGroup, `${id}.dockGroup`).toBe("model");
    });
    // 骨骼归动作组（骨骼驱动动作/被动作驱动）
    const bones = ysmItems.find((d) => d.id === "bones")!;
    expect(bones.dockGroup, "bones.dockGroup").toBe("motion");
  });

  it("vrm 必需项齐全且归属按域分（model: 统计/截图/材质；motion: 骨骼——骨骼是动作驱动目标）", () => {
    expectContainsAtLeast(extractIds(vrmItems), ["bones", "material", "model", "shot"], "vrm 必需项");
    // 统计/截图/材质归模型组（dock 🧍 可达）
    ["model", "shot", "material"].forEach((id) => {
      const item = vrmItems.find((d) => d.id === id)!;
      expect(item.dockGroup, `${id}.dockGroup`).toBe("model");
    });
    // 骨骼归动作组（骨骼驱动动作/被动作驱动）
    const bones = vrmItems.find((d) => d.id === "bones")!;
    expect(bones.dockGroup, "bones.dockGroup").toBe("motion");
  });

  it("mmd model/material/play 恒定；shot 条件注入（screenshot 能力）；bones 条件注入", () => {
    // [doc:adr-126-p4-b-1] shot 面板改为条件注入：screenshot 能力缺失（null）→ 无 shot 项
    const withAll = mmdMenuItems(fakeMmdOpts({ bonePanel: fakeBonePanel(), screenshot: () => Promise.resolve(null) }));
    expectContainsAtLeast(extractIds(withAll), ["bones", "material", "model", "play", "shot"], "mmd 全注入");
    // play 始终注入（支持用户配置自定义动作库，空态引导选择）
    const slim = mmdMenuItems(fakeMmdOpts({ play: { clips: [], isPlaying: () => false, toggle: vi.fn(), currentIndex: () => 0, select: vi.fn(), animDir: null }, screenshot: () => Promise.resolve(null) }));
    expectContainsAtLeast(extractIds(slim), ["play", "material", "model", "shot"], "mmd play 始终存在（空态）");
    // 无 pmx.bones → 无 bones
    expectNotContains(extractIds(slim), ["bones"], "mmd 无 bones 时不注入");
    // 无 screenshot 能力 → 无 shot 项（[doc:adr-126-p4-b-1] 条件注入契约）
    const noShot = mmdMenuItems(fakeMmdOpts({ screenshot: null }));
    expectNotContains(extractIds(noShot), ["shot"], "mmd 无 screenshot 时不注入 shot");
  });

  it("legacyTestId 锚点齐全（既有 e2e 选择器兼容契约）", () => {
    const legacies = allItems.map((d) => d.legacyTestId).filter(Boolean);
    [
      "ysm-model-entry",
      "ysm-shot-entry",
      "ysm-bones-entry",
      "mmd-model-entry",
      "mmd-material-entry",
      "mmd-play-entry",
      "mmd-bones-entry",
      "vrm-material-entry",
      "vrm-bones-entry",
      "ysm-roles-entry",
      "env-menu-btn",
    ].forEach((anchor) => expect(legacies, `缺锚点 ${anchor}`).toContain(anchor));
  });
});

// ── dock 行全量渲染（真实数组驱动）──

describe("dock 行全量渲染（遍历真实菜单数组驱动）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("ysm 数组：🧍 模型组按钮出现，点击直达 roles 面板（adapter model 项不在 dock 根）", () => {
    const items = ysmMenuItems(fakeYsmOpts());
    const { overlay, handle } = mountWith(items, {
      getSiblings: () => ["/m/b.ysm"],
    });
    const modelGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "model")!.id;
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${modelGroupId}"]`);
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    // Phase A：🧍 始终直达 roles 面板（角色管理）；adapter model 组项下沉角色详情，不在 dock 根
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // ysm model 组项（模型信息/截图/骨骼/材料）不再作为 dock 根行出现（下沉到角色详情）
    const adapterDock = deriveTestIds(items.filter((d) => d.dockGroup === "model"));
    adapterDock.forEach((tid) => {
      expect(overlay.querySelector(`[data-testid="${tid}"]`), tid).toBeNull();
    });
    handle.dispose();
  });

  it("mmd 数组：dock 各组从菜单表推导，点击渲染正确子项（自适应）", () => {
    const items = mmdMenuItems(fakeMmdOpts({ bonePanel: fakeBonePanel() }));
    const { overlay, handle } = mountWith(items, {
      getSiblings: () => ["/m/b.pmx"],
    });
    const modelGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "model")!.id;
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${modelGroupId}"]`);
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    // Phase A：🧍 始终直达 roles 面板（adapter model 组项下沉角色详情，不在 dock 根）
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    const adapterDockModel = deriveTestIds(items.filter((d) => d.dockGroup === "model"));
    adapterDockModel.forEach((tid) => {
      expect(overlay.querySelector(`[data-testid="${tid}"]`), tid).toBeNull();
    });

    // 多 panel 组（motion 组含 play + bones，骨骼归动作组后组内 ≥2）→ 渲染组根行 + 子菜单
    const motionGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "motion")!.id;
    const motionBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${motionGroupId}"]`);
    expect(motionBtn).not.toBeNull();
    motionBtn!.click();
    // 组内 ≥2 panel → 组根视图渲染子菜单行（play + bones 都作为 row 可达，不是直达面板内容）
    expect(overlay.querySelector('[data-testid="preview-play"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="preview-bones"]')).not.toBeNull();
    handle.dispose();
  });

  it("vrm 数组：🧍 模型组从菜单表推导，骨骼与 core roles 同行渲染（自适应）", () => {
    const items = vrmMenuItems(fakeVrmOpts());
    const { overlay, handle } = mountWith(items, {
      getSiblings: () => ["/m/b.vrm"],
    });
    const modelGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "model")!.id;
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${modelGroupId}"]`);
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    // Phase A：🧍 始终直达 roles 面板（adapter model 组项下沉角色详情，不在 dock 根）
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    const adapterDock = deriveTestIds(items.filter((d) => d.dockGroup === "model"));
    adapterDock.forEach((tid) => {
      expect(overlay.querySelector(`[data-testid="${tid}"]`), tid).toBeNull();
    });
    handle.dispose();
  });

  it("core 拆组契约：🎛️ 场景组含 lighting/shadow/postproc、🌍 环境组独立（shared 模式 + cap）", () => {
    const { overlay, handle } = mountWith([], { getSiblings: () => ["/m/b.ysm"] });
    // 场景组 root 按钮从 PREVIEW_MENU_GROUPS 推导
    const sceneGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "scene")!.id;
    const sceneBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${sceneGroupId}"]`);
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    // scene 组菜单项从 CORE_MENU_ITEMS 推导（camera/lighting/shadow/postproc 全在 scene；environment 已拆离）
    const sceneCoreItems = CORE_MENU_ITEMS.filter(
      (d) => d.dockGroup === "scene" && d.id !== "environment",
    );
    for (const eid of deriveTestIds(sceneCoreItems)) {
      expect(overlay.querySelector(`[data-testid="${eid}"]`), eid).not.toBeNull();
    }
    // camera 属 scene 组 → 出现；environment 属 env 组 → 不在 scene 渲染
    const camId = CORE_MENU_ITEMS.find((d) => d.id === "camera")!.id;
    const envId = CORE_MENU_ITEMS.find((d) => d.id === "environment")!.id;
    expect(overlay.querySelector(`[data-testid="preview-${camId}"]`)).not.toBeNull();
    expect(overlay.querySelector(`[data-testid="preview-${envId}"]`)).toBeNull();
    // 环境组独立 root 按钮存在（有 fakeCap → env.skyGroundCap 谓词放行）
    const envGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "env")!.id;
    const envBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${envGroupId}"]`);
    expect(envBtn).not.toBeNull();
    // 单 panel 组 → 快捷直达环境面板（渲染 range 控件，不渲染组根行）
    envBtn!.click();
    expect(overlay.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(2);
    handle.dispose();
  });

  it("能力驱动：无 siblings → model dock 仍显示（路径输入兜底）；selfMode + 无环境能力 → 仅 🌍 环境组空（🎛️ 场景组仍显：lighting/shadow/postproc 已去 sharedOnly）", () => {
    // roles 为模型组恒定 core 项（内嵌加载入口含路径兜底），dock-model 始终可见
    const noSib = mountWith([], {});
    const modelGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "model")!.id;
    expect(noSib.overlay.querySelector(`[data-testid="dock-${modelGroupId}"]`)).not.toBeNull();
    noSib.handle.dispose();
    // selfMode 不再过滤 lighting/shadow/postproc（已去 sharedOnly）→ 🎛️ 场景组显；
    // 无 cap → environment(env.skyGroundCap 谓词 false) 过滤 → 🌍 环境组空
    const noScene = mountWith([], { selfMode: true, getCap: () => null });
    const sceneGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "scene")!.id;
    const envGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "env")!.id;
    expect(noScene.overlay.querySelector(`[data-testid="dock-${sceneGroupId}"]`)).not.toBeNull();
    expect(noScene.overlay.querySelector(`[data-testid="dock-${envGroupId}"]`)).toBeNull();
    noScene.handle.dispose();
  });

  it("提供 siblings → 🧍 组角色面板内嵌加载入口列候选；选中条目触发 switchTo（换角色）", async () => {
    const switchTo = vi.fn();
    const { overlay, handle } = mountWith([], {
      getSiblings: () => ["/m/a.ysm", "/m/b.vrm"],
      getCurrentPath: () => "/m/a.ysm",
      switchTo,
    });
    const modelGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "model")!.id;
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${modelGroupId}"]`);
    expect(modelBtn).not.toBeNull();
    // 无适配器项 → 模型组仅 roles → 单 panel 快捷直达角色面板（内嵌加载入口）
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    const rows = overlay.querySelectorAll('[data-testid="preview-switch-item"]');
    expect(rows.length).toBe(2);
    (rows[1] as HTMLElement).click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.vrm");
    handle.dispose();
  });

  it("无 siblings → dock-model 可见（类型 tab 兜底），角色面板加载入口显示空态（路径输入保留）", () => {
    const { overlay, handle } = mountWith([], { getSiblings: () => [] });
    const modelGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "model")!.id;
    expect(overlay.querySelector(`[data-testid="dock-${modelGroupId}"]`)).not.toBeNull();
    // 点击 model 快捷直达角色面板，加载入口应显示空态文字
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${modelGroupId}"]`);
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    expect(popup.textContent).toContain("无其他模型");
    handle.dispose();
  });
});

// ── 安全面板渲染（逐个打开断言非空）──

describe("面板渲染（安全 panel 逐个打开）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("mmd model 面板：信息卡含模型名", () => {
    const { overlay, handle } = mountWith(mmdMenuItems(fakeMmdOpts()));
    handle.openPanel("model");
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    expect(overlay.textContent).toContain("测试.pmx");
    handle.dispose();
  });

  it("mmd play 面板：播放 toggle + 动作选择器（声明式节点）", () => {
    // [doc:adr-126-p5-收尾] play 走 playNodes 声明式 children：toggle（播放/暂停）+ select（动作）
    // 渲染由 renderMenu 单测覆盖（preview-menu-node-render.test.ts），此处断言节点结构
    const playNode = mmdMenuItems(fakeMmdOpts()).find((d) => d.id === "play");
    expect(playNode?.children?.map((c) => c.id)).toEqual(["play-toggle", "play-select"]);
    expect(playNode?.children?.some((c) => c.kind === "toggle")).toBe(true);
    expect(playNode?.children?.some((c) => c.kind === "select")).toBe(true);
    const { overlay, handle } = mountWith(mmdMenuItems(fakeMmdOpts()));
    handle.openPanel("play");
    expect(overlay.textContent).toContain("播放");
    handle.dispose();
  });

  it("mmd material 面板：材质行渲染（data-testid=mat-<i>）", () => {
    const { overlay, handle } = mountWith(mmdMenuItems(fakeMmdOpts()));
    handle.openPanel("material");
    expect(overlay.querySelector('[data-testid=preview-mat-0]')).not.toBeNull();
    handle.dispose();
  });

  it("vrm material 面板：材质行渲染（data-testid=mat-<i>）", () => {
    const { overlay, handle } = mountWith(vrmMenuItems(fakeVrmOpts()));
    handle.openPanel("material");
    expect(overlay.querySelector('[data-testid="preview-mat-0"]')).not.toBeNull();
    handle.dispose();
  });

  it("core camera 面板：视角 select + 速度滑块", () => {
    const { overlay, handle } = mountWith([]);
    handle.openPanel("camera");
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.querySelector("select")).not.toBeNull();
    expect(popup.querySelector('input[type="range"]')).not.toBeNull();
    handle.dispose();
  });

  it("core environment 面板：时间/云量滑块渲染", () => {
    const { overlay, handle } = mountWith([], { getSiblings: () => ["/m/b.ysm"] });
    handle.openPanel("environment");
    expect(overlay.querySelectorAll('input[type="range"]').length).toBeGreaterThanOrEqual(2);
    handle.dispose();
  });

  it("core roles 面板：内嵌加载入口渲染 siblings 行", () => {
    const { overlay, handle } = mountWith([], {
      getSiblings: () => ["/m/b.ysm"],
      getCurrentPath: () => "/m/b.ysm",
    });
    handle.openPanel("roles");
    expect(overlay.textContent).toContain("b.ysm");
    handle.dispose();
  });
});

// ── 错误路径：面板渲染失败兜底 ──

describe("渲染失败兜底（render 抛错不崩）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("render 抛错 → 面板显示红色错误行 + console.error（挂载不崩）", () => {
    const errSpy = vi.fn();
    const origError = console.error;
    console.error = errSpy;
    try {
      const boom = vi.fn(() => {
        throw new Error("boom");
      });
      const { overlay, handle } = mountWith([
        {
          id: "broken",
          icon: "❌",
          labelKey: "preview.modelInfo",
          fallback: "坏",
          kind: "panel",
          renderCustom: boom,
        },
      ]);
      handle.openPanel("broken");
      const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
      expect(popup.style.display).toBe("flex");
      expect(overlay.textContent).toContain("面板渲染失败");
      expect(overlay.textContent).toContain("boom");
      expect(overlay.querySelector('[style*="#ff7b7b"]')).not.toBeNull();
      expect(errSpy).toHaveBeenCalled();
      expect(boom).toHaveBeenCalled();
      handle.dispose();
    } finally {
      console.error = origError;
    }
  });
});
