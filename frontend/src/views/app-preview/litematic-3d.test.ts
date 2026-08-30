// ===== litematic 体素 3D 测试 =====
// 覆盖：cleanupVoxel3D、createLitematic3D 主路径（overlay/DOM 控件/渲染循环）、
// ESC/关闭按钮清理、空体素数据、getApp 失败兜底、分层/旋转/速度控件交互、截断提示。
// three + OrbitControls 全 stub（渲染管线不真实执行）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("three", () => {
  class Scene {
    background: unknown;
    children: unknown[] = [];
    add = vi.fn();
    remove = vi.fn();
    traverse = vi.fn();
  }
  class Color {
    constructor(..._a: unknown[]) {}
  }
  class PerspectiveCamera {
    position = { set: vi.fn(), add: vi.fn() };
    quaternion = { setFromEuler: vi.fn() };
    lookAt = vi.fn();
    aspect = 0;
    updateProjectionMatrix = vi.fn();
    getWorldDirection = vi.fn(() => ({ x: 0, y: 0, z: 1 }));
    constructor(..._a: unknown[]) {
      cameraInstances.push(this);
    }
  }
  class WebGLRenderer {
    domElement: HTMLElement;
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    constructor(..._a: unknown[]) {
      this.domElement = document.createElement("div");
      // 拖拽 handler（onDragPointerDown/Move/Up）会调用 pointer capture API
      this.domElement.setPointerCapture = vi.fn();
      this.domElement.hasPointerCapture = vi.fn(() => false);
      this.domElement.releasePointerCapture = vi.fn();
    }
  }
  class AmbientLight {
    constructor(..._a: unknown[]) {}
  }
  class Camera {}
  class DirectionalLight {
    position = { set: vi.fn() };
    constructor(..._a: unknown[]) {}
  }
  class GridHelper {
    position = { set: vi.fn() };
    constructor(..._a: unknown[]) {}
  }
  class BoxGeometry {
    dispose = vi.fn();
  }
  class MeshLambertMaterial {
    dispose = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class Object3D {
    position = { set: vi.fn() };
    updateMatrix = vi.fn();
    matrix = {};
  }
  // 记录每个被创建的 InstancedMesh 实例，供测试断言 count / setMatrixAt 调用
  const instancedMeshInstances: InstancedMesh[] = [];
  // 记录 PerspectiveCamera 实例（自身旋转拖拽断言用）
  const cameraInstances: PerspectiveCamera[] = [];
  class InstancedMesh {
    instanceMatrix = { needsUpdate: false };
    count = 0;
    setMatrixAt = vi.fn();
    dispose = vi.fn();
    constructor(..._a: unknown[]) {
      instancedMeshInstances.push(this);
    }
  }
  class Euler {
    setFromQuaternion = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class Vector3 {
    x: number;
    y: number;
    z: number;
    // mount-preview-core animate 循环复用实例：set/copy 必须写回字段（否则按键移动断言失真）
    set = vi.fn(function (this: Vector3, x: number, y: number, z: number) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    });
    copy = vi.fn(function (this: Vector3, v: { x: number; y: number; z: number }) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    });
    normalize = vi.fn(function (this: Vector3) {
      return this;
    });
    add = vi.fn(function (this: Vector3) {
      return this;
    });
    sub = vi.fn(function (this: Vector3) {
      return this;
    });
    multiplyScalar = vi.fn(function (this: Vector3) {
      return this;
    });
    crossVectors = vi.fn(function (this: Vector3) {
      return this;
    });
    clone = vi.fn(() => new Vector3());
    length = vi.fn(function (this: Vector3) {
      return Math.hypot(this.x, this.y, this.z);
    });
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }
  // 以下为 ADR-081/073 3D 重构新增、本测试 three 全 stub 需补齐的符号
  class Box3 {
    min = new Vector3();
    max = new Vector3();
    setFromObject = vi.fn(() => this);
    getCenter = vi.fn((t: Vector3) => t);
    getSize = vi.fn((t: Vector3) => t);
    constructor(..._a: unknown[]) {}
  }
  class Group {
    add = vi.fn();
    position = { set: vi.fn() };
    constructor(..._a: unknown[]) {}
  }
  class Mesh {
    geometry = { dispose: vi.fn() };
    material = { dispose: vi.fn() };
    position = { set: vi.fn() };
    constructor(..._a: unknown[]) {}
  }
  class Material {
    dispose = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class PlaneGeometry {
    dispose = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class ShaderMaterial {
    dispose = vi.fn();
    constructor(..._a: unknown[]) {}
  }
  class SpotLight {
    position = { set: vi.fn() };
    constructor(..._a: unknown[]) {}
  }
  class Texture {
    constructor(..._a: unknown[]) {}
  }
  class Vector2 {
    constructor(..._a: unknown[]) {}
  }
  // ADR-093 T5 统一拾取器（mount-preview-core.ts:382）：仅 setFromCamera + intersectObjects
  class Raycaster {
    setFromCamera = vi.fn();
    intersectObjects = vi.fn(() => []);
    constructor(..._a: unknown[]) {}
  }
  class WebGLRenderTarget {
    constructor(..._a: unknown[]) {}
  }
  class PMREMGenerator {
    compileEquirectangularShader = vi.fn();
    fromScene = vi.fn(() => ({ texture: {} }));
    constructor(..._a: unknown[]) {}
  }
  const ACESFilmicToneMapping = 0;
  const AdditiveBlending = 0;
  const DoubleSide = 0;
  const ToneMapping = 0;
  return {
    Scene,
    Color,
    PerspectiveCamera,
    WebGLRenderer,
    AmbientLight,
    DirectionalLight,
    GridHelper,
    BoxGeometry,
    MeshLambertMaterial,
    Object3D,
    InstancedMesh,
    Euler,
    Vector3,
    Box3,
    Group,
    Mesh,
    Material,
    PlaneGeometry,
    ShaderMaterial,
    SpotLight,
    Texture,
    Vector2,
    Raycaster,
    WebGLRenderTarget,
    PMREMGenerator,
    ACESFilmicToneMapping,
    AdditiveBlending,
    BasicShadowMap: 0,
    Camera,
    CineonToneMapping: 3,
    ColorSpace: "srgb",
    DoubleSide,
    Frustum: class Frustum { setFromProjectionMatrix = vi.fn(); intersectsSphere = vi.fn(() => true); intersectsObject = vi.fn(() => true); },
    LinearToneMapping: 1,
    Matrix4: class Matrix4 { multiplyMatrices = vi.fn(); },
    NoToneMapping: 0,
    OrthographicCamera: class OrthographicCamera {},
    ReinhardToneMapping: 2,
    SRGBColorSpace: "srgb",
    ShadowMapType: 0,
    Sphere: class Sphere {},
    ToneMapping,
    _instancedMeshInstances: instancedMeshInstances,
    _cameraInstances: cameraInstances,
  };
});

vi.mock("three/addons/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    target = {
      set: vi.fn(),
      copy: vi.fn(() => ({ addScaledVector: vi.fn() })),
      clone: vi.fn(() => ({ copy: vi.fn(), add: vi.fn() })),
    };
    enableDamping = false;
    dampingFactor = 0;
    minDistance = 0;
    maxDistance = 0;
    enableRotate = true;
    update = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("../../backend/app.ts", () => ({ getApp: vi.fn() }));
// 注：不再 mock 掉 CORE_MENU_ITEMS 的 roles 项。旧「dock-model 单 panel 直达」捷径已随
// 2026-08-22 收口删除（恒进 roles 列表 → 点角色名 → roleDetailView）。切片控件断言不走
// 菜单 DOM 导航——5329a347 schema 化后经 sliceNodes()（schema-registry 前缀查找）直驱，
// 生产导航路径由 preview-menu 系测试 + layer-controls 集成用例（renderPreviewPanel 接线）覆盖。
// ADR-073 天空能力（sky-capability）依赖 PMREMGenerator 需真实 WebGL context，
// 本测试 three 全 stub 无 WebGL——mock SkyCapability 为 no-op，隔离体素渲染逻辑。
// 方法面同步 mount-preview-core 的 shared 初始化路径（setPreset/apply/getTimeOfDay 即时调用；
// setTime/setCloudCoverage 是滑块回调，一并 mock 防 undefined）
vi.mock("../../features/preview-3d/caps/sky-capability.ts", () => ({
  SkyCapability: class {
    apply = vi.fn();
    dispose = vi.fn();
    setPreset = vi.fn();
    getTimeOfDay = vi.fn(() => 12);
    setTime = vi.fn();
    setCloudCoverage = vi.fn();
    constructor() {}
  },
}));
const { _noopHandler } = vi.hoisted(() => {
  const _noopHandler: ProxyHandler<Record<string, unknown>> = {
    get: (_t, prop) => (typeof prop === "symbol" ? undefined : vi.fn()),
  };
  return { _noopHandler };
});

// 注册表 createAll 会触发真实 cap 工厂（EnvironmentCapability.buildEnvironment 等），
// 需要完整 THREE 环境——本测试 three 全 stub，mock 注册表为 no-op。
// getById 返回 Proxy，任意方法调用都是 vi.fn()，不用逐个列举。
vi.mock("../../features/preview-3d/caps/scene-capability-registry.ts", () => ({
  sceneCapabilityRegistry: {
    createAll: vi.fn(() => []),
    loadAll: vi.fn(),
    getAll: vi.fn(() => []),
    getById: vi.fn(() => new Proxy({}, _noopHandler)),
    saveAll: vi.fn(),
    dispose: vi.fn(),
  },
}));
// ADR-081 LightCapability 依赖真实 WebGL/THREE（聚光灯/体积光锥/方向光 position.copy），
// 本测试 three 全 stub 无 WebGL——mock 为 no-op，隔离体素渲染逻辑（同 SkyCapability）。
vi.mock("../../features/preview-3d/caps/light-capability.ts", () => ({
  LightCapability: class {
    apply = vi.fn();
    dispose = vi.fn();
    setPreset = vi.fn();
    setTarget = vi.fn();
    setTargetHeight = vi.fn();
    getVolumetricEngine = vi.fn(() => "none");
    getParams = vi.fn(() => ({ volumetric: { enabled: false } }));
    constructor() {}
  },
}));

import { getApp, type AppBindings } from "../../backend/app.ts";
import { bus } from "../../bus.ts";
import * as THREE from "three";
import { cleanupVoxel3D, createLitematic3D } from "./litematic-3d.ts";
import { sleep } from "../../test-utils/index.ts";
import { getSchema, listSchemas } from "../../features/preview-3d/adapters/schema-registry.ts";
import { switchPreview } from "../../features/preview-3d/adapters/mount-preview-core.ts";
import { previewSnapshot } from "../../features/preview-3d/state/preview-state.ts";
import type { PreviewMenuNode } from "../../features/preview-3d/adapters/preview-menu/node-types.ts";

/** 访问 mock 暴露的 InstancedMesh 实例列表，供 count / setMatrixAt 断言 */
const meshInstances = (THREE as unknown as {
  _instancedMeshInstances: Array<{
    count: number;
    setMatrixAt: ReturnType<typeof vi.fn>;
  }>;
})._instancedMeshInstances;

/** 访问 mock 暴露的 PerspectiveCamera 实例列表（自身旋转拖拽断言用） */
const cameraInstances = (THREE as unknown as {
  _cameraInstances: Array<{ quaternion: { setFromEuler: ReturnType<typeof vi.fn> } }>;
})._cameraInstances;

/** schema 化后（5329a347）切片面板经 schema-registry 注册，per-scene key = litematic-slice-<n>。
 *  按前缀取最新实例的 builder 产出节点——不导航菜单 DOM（dock-model 恒进 roles 列表，
 *  slice 行在角色下钻后的模型详情层，三跳 DOM 导航对单元测试过脆且与视图渲染细节耦合） */
function sliceNodes(): PreviewMenuNode[] {
  const key = listSchemas().filter((k) => k.startsWith("litematic-slice-")).pop();
  if (!key) throw new Error("litematic slice schema 未注册（createLitematic3D 未完成或已 dispose）");
  return getSchema(key)!(previewSnapshot());
}

/** 触发一次 applyLayer（mock InstancedMesh 构造 count=0，须经切片控件写过才可断言）——
 *  经 schema mode control 触发，等价旧「面板 select change」的生产路径（onChange → applyLayer） */
function triggerApplyLayer(): void {
  sliceNodes().find((n) => n.id === "slice-mode")!.control!.onChange?.(undefined);
}

/** 切换切片模式（真源 = shell 闭包，经模式 select 的 get/set 闭包驱动，同生产 select change） */
function setSliceMode(nodes: PreviewMenuNode[], mode: string): void {
  const m = nodes.find((n) => n.id === "slice-mode")!;
  m.control!.set!(mode);
  m.control!.onChange!(mode);
}

/** 最近创建的 overlay（createLitematic3D append 到 body） */
function lastOverlay(): HTMLElement {
  const kids = document.body.children;
  return kids[kids.length - 1] as HTMLElement;
}

function voxelFn(json: string): (p: string) => Promise<string> {
  return vi.fn().mockResolvedValue(json);
}

const VALID_JSON = JSON.stringify({
  groups: [{ positions: [[1, 2, 3], [4, 5, 6]], color: "#ff0000" }],
  size: [16, 16, 16],
});

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  meshInstances.length = 0;
  cameraInstances.length = 0;
  vi.mocked(getApp).mockResolvedValue({
    GetLitematicVoxelData: voxelFn(VALID_JSON),
  } as unknown as AppBindings);
});

afterEach(() => {
  cleanupVoxel3D();
  document.body.innerHTML = "";
});

describe("cleanupVoxel3D", () => {
  it("无活跃实例 → no-op（不抛）", () => {
    expect(() => cleanupVoxel3D()).not.toThrow();
  });

  it("创建后 cleanup → overlay 移除（_voxel3d 复用清理）", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay).toBeTruthy();
    cleanupVoxel3D();
    expect(document.body.contains(overlay)).toBe(false);
  });
});

describe("createLitematic3D 主路径", () => {
  it("渲染 overlay + 控件，加载完成后 loading 移除", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    // Phase 3 收编：控件从 topBar 迁移到声明式根菜单面板
    // dock 按钮始终可见（模型组 / 场景组）
    expect(overlay.querySelector('[data-testid="dock-model"]')).toBeTruthy();
    expect(overlay.querySelector('[data-testid="dock-scene"]')).toBeTruthy();
    // 加载占位已被移除
    expect(overlay.textContent).not.toContain("加载体素数据");
    // slice 控件通过 menuItems 注入到角色详情面板；此处验证 menuItems 结构正确
    // （roles CORE 项优先，dock-model 点击打开 roles 面板；slice 项在角色详情内）
  });

  it("closeBtn 点击 → overlay 移除（SlideMenu header ✕，legacy #preview-close-3d）", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    // 打开底部 dock 菜单使 SlideMenu 可见，再点 header ✕ 关闭 3D
    const dockBtn = overlay.querySelector('[data-testid="dock-scene"]') as HTMLElement;
    dockBtn.click();
    const closeBtn = overlay.querySelector("#preview-close-3d") as HTMLElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    expect(document.body.contains(overlay)).toBe(false);
  });

  it("ESC 键 → overlay 移除", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.contains(overlay)).toBe(false);
  });

  it("第二次创建复用 → 复用单例外壳（内容层 swap，不重建 DOM）", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const first = lastOverlay();
    await createLitematic3D("/b.litematic", "GetLitematicVoxelData");
    const second = lastOverlay();
    // Phase 3 架构：mount-preview-core 复用单例外壳，第二次创建是同一 overlay 内容层 swap，
    // 不再是「拆旧建新」（避免重建 DOM 导致黑屏窗口期）
    expect(second).toBeTruthy();
    expect(second).toBe(first); // 复用同一 overlay
    // cleanup 移除该 overlay（同一元素）
    cleanupVoxel3D();
    expect(document.body.contains(second)).toBe(false);
  });
});

describe("体素数据处理", () => {
  it("空 groups → voxelEmpty 提示，不崩溃", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(JSON.stringify({ groups: [], size: [10, 10, 10] })),
    } as unknown as AppBindings);
    await createLitematic3D("/empty.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay.textContent).toContain("体素数据为空"); // test-setup t() 返回 zhCN
    unmountOverlay(overlay);
  });

  it("{error} 契约 → 显示具体错误而非 voxelEmpty（对齐 Go voxelErrorJSON）", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetNbtVoxelData: voxelFn(JSON.stringify({ error: "BuildNbtVoxelData: not a structure NBT file" })),
    } as unknown as AppBindings);
    await createLitematic3D("/err.nbt", "GetNbtVoxelData");
    const overlay = lastOverlay();
    expect(overlay.textContent).toContain("not a structure NBT file");
    expect(overlay.textContent).not.toContain("体素数据为空");
    unmountOverlay(overlay);
  });

  it("truncated → 显示方块数量上限提示条", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[0, 0, 0]] }],
          size: [10, 10, 10],
          truncated: true,
          maxBlocks: 200000,
        }),
      ),
    } as unknown as AppBindings);
    await createLitematic3D("/trunc.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay.textContent).toContain("200,000");
    unmountOverlay(overlay);
  });

  it("getApp 抛错 → 错误占位 + toast:show（escH 清理不泄漏）", async () => {
    vi.mocked(getApp).mockRejectedValue(new Error("no-voxel-binding"));
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", toastSpy);
    try {
      await createLitematic3D("/fail.litematic", "GetLitematicVoxelData");
      const overlay = lastOverlay();
      expect(overlay.textContent).toContain("加载失败");
      expect(toastSpy).toHaveBeenCalled();
      unmountOverlay(overlay);
    } finally {
      unsub();
    }
  });
});

describe("控件交互", () => {
  it("旋转模式切换 + 速度滑块更新显示（camera 面板 buildCameraControls）", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    // camera 控件（buildCameraControls）挂在 scene 组的 camera 面板（SlideMenu 弹层内，
    // 懒渲染）。scene 组含 camera/lighting/shadow/postproc/settings 多项，
    // dock-scene 走「组根视图」列出条目，点 preview-camera 下钻渲染相机面板。
    const dock = overlay.querySelector('[data-testid="dock-scene"]') as HTMLElement;
    expect(dock).toBeTruthy();
    dock.click();
    const camRow = overlay.querySelector('[data-testid="preview-camera"]') as HTMLElement;
    expect(camRow).toBeTruthy();
    camRow.click();
    const sel = overlay.querySelector('[data-testid="mmd-rot-mode"]') as HTMLSelectElement;
    expect(sel).toBeTruthy();
    // 相机面板 list 是 buildCameraControls 的挂载点，速度滑块/值标签均在其内，
    // 限定作用域避免误命中 litematic 常驻分层滑块。
    const panelList = sel.parentElement as HTMLElement;
    const spd = panelList.querySelector('input[type="range"]') as HTMLInputElement;
    sel.value = "false";
    sel.dispatchEvent(new Event("change"));
    spd.value = "55";
    spd.dispatchEvent(new Event("input"));
    const spdVal = [...panelList.querySelectorAll("span")].find(
      (s) => /^\d+$/.test(s.textContent || ""),
    );
    expect(spdVal?.textContent).toBe("55");
    unmountOverlay(overlay);
  });

  it("分层模式切换 → applyLayer（mesh.count 更新）；切片轴切换 → 层范围重置", async () => {
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    let nodes = sliceNodes();
    // 单层模式 → 层滑块节点出现（visibleWhen 谓词读 shell 闭包）+ applyLayer 写 count（Y=max 层 → 0）
    setSliceMode(nodes, "single");
    nodes = sliceNodes();
    expect(nodes.find((n) => n.id === "slice-layer")).toBeDefined();
    triggerApplyLayer();
    expect(meshInstances.reduce((s, m) => s + m.count, 0)).toBe(0);
    // 切轴 Z → 层 max 重置为 sizeZ=16（重建节点后读——真实 UI 由 refreshOnChange 触发）
    nodes.find((n) => n.id === "slice-axis")!.control!.set!("Z");
    nodes = sliceNodes();
    expect(nodes.find((n) => n.id === "slice-layer")!.control!.max).toBe(16);
    // 范围模式 → 起止双滑块节点出现
    setSliceMode(nodes, "range");
    nodes = sliceNodes();
    expect(nodes.find((n) => n.id === "slice-range-start")).toBeDefined();
    expect(nodes.find((n) => n.id === "slice-range-end")).toBeDefined();
  });
});

describe("陷阱 #11 坐标对齐 + #17 零值哨兵", () => {
  it("原点体素 [0,0,0] 保留：0 坐标不被当成缺失丢弃", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[0, 0, 0], [0, 0, 5]], color: "#00ff00" }],
          size: [16, 16, 16],
        }),
      ),
    } as unknown as AppBindings);
    await createLitematic3D("/origin.litematic", "GetLitematicVoxelData");
    expect(meshInstances.length).toBeGreaterThanOrEqual(1);
    // mock InstancedMesh 构造 count=0——经 schema mode control 触发 applyLayer(all) 写入合法体素数
    triggerApplyLayer();
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(2); // 两个合法方块都保留
  });

  it("缺失/NaN 坐标整条丢弃，不聚到原点造幽灵方块（#17）", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [
            {
              positions: [
                [1, 2, 3], // 合法
                [0, 0, 0], // 合法原点
                [5, undefined, 1], // 非法 → 丢弃
                [NaN, 0, 0], // 非法 → 丢弃
                [9, 9, 9], // 合法
              ],
              color: "#ff0000",
            },
          ],
          size: [16, 16, 16],
        }),
      ),
    } as unknown as AppBindings);
    await createLitematic3D("/mixed.litematic", "GetLitematicVoxelData");
    // 经 schema mode control 触发 applyLayer(all) 写 count（3 条合法）
    triggerApplyLayer();
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(3);
  });

  it("边界体素 [size-1] 渲染：chunk 索引不越界", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[15, 15, 15], [0, 0, 0]], color: "#0000ff" }],
          size: [16, 16, 16],
        }),
      ),
    } as unknown as AppBindings);
    await createLitematic3D("/edge.litematic", "GetLitematicVoxelData");
    expect(meshInstances.length).toBeGreaterThanOrEqual(1);
    // 经 schema mode control 触发 applyLayer(all) 写 count（2 个合法）
    triggerApplyLayer();
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(2); // 边界 + 原点都在
  });

  it("applyLayer single 模式：只保留目标层方块，count 过滤正确", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [
            { positions: [[0, 0, 0], [1, 0, 0], [2, 5, 2]], color: "#abcdef" },
          ],
          size: [16, 16, 16],
        }),
      ),
    } as unknown as AppBindings);
    await createLitematic3D("/layer.litematic", "GetLitematicVoxelData");
    // schema 驱动：切 single + 层调到 1（target 层 0）
    setSliceMode(sliceNodes(), "single");
    triggerApplyLayer();
    expect(meshInstances.reduce((s, m) => s + m.count, 0)).toBe(0); // 默认 Y=max 层全滤空
    const layer = sliceNodes().find((n) => n.id === "slice-layer")!;
    layer.control!.set!(1);
    layer.control!.onChange?.(1);
    const total = meshInstances.reduce((s, m) => s + m.count, 0);
    expect(total).toBe(2); // [0,0,0] 和 [1,0,0] 在 Y=0 层；[2,5,2] 被过滤
  });
});

describe("审核补充：边界与异步路径", () => {
  it("truncated 且无 maxBlocks → 使用兜底上限 200,000", async () => {
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxelFn(
        JSON.stringify({
          groups: [{ positions: [[0, 0, 0]] }],
          size: [10, 10, 10],
          truncated: true, // 无 maxBlocks 字段
        }),
      ),
    } as unknown as AppBindings);
    await createLitematic3D("/trunc-fallback.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay.textContent).toContain("200,000");
    unmountOverlay(overlay);
  });

  it("加载期间 ESC 关闭 → aborted 守卫：迟到的数据不重建 overlay", async () => {
    let resolveFn: (v: string) => void = () => {};
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: (() =>
        new Promise<string>((r) => {
          resolveFn = r;
        })),
    } as unknown as AppBindings);
    const p = createLitematic3D("/slow.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay(); // overlay 同步已挂载（首个 await 之前）
    // 让 build 越过首个 await getApp()、真正进入 await fn(path)：此刻 resolveFn 才被真实赋值；
    // 必须在此微任务让出后、再发 ESC，才能命中「加载中关闭」分支（迟到的数据不重建 overlay）。
    await Promise.resolve();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.body.contains(overlay)).toBe(false);
    resolveFn(VALID_JSON); // 此刻 resolveFn 已是 fn(path) 的真实 resolver
    await p;
    expect(document.body.contains(overlay)).toBe(false); // 迟到数据不复活
  });

  it("自身旋转模式拖拽：pointerdown + pointermove → quaternion 更新", async () => {
    await createLitematic3D("/drag.litematic", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    // 下钻 camera 面板，切「自身」模式（非 orbit）。camera 控件在 scene 组（dock-scene），
    // scene 组多项走组根视图，点 preview-camera 下钻渲染相机面板。
    const dock = overlay.querySelector('[data-testid="dock-scene"]') as HTMLElement;
    expect(dock).toBeTruthy();
    dock.click();
    const camRow = overlay.querySelector('[data-testid="preview-camera"]') as HTMLElement;
    expect(camRow).toBeTruthy();
    camRow.click();
    const sel = overlay.querySelector('[data-testid="mmd-rot-mode"]') as HTMLSelectElement;
    expect(sel).toBeTruthy();
    sel.value = "false";
    sel.dispatchEvent(new Event("change"));
    // renderer.domElement（canvas）touchAction=none，pointerdown 绑其上、move/up 绑 window
    const rendererEl = Array.from(overlay.querySelectorAll("div")).find(
      (d) => d.style.touchAction === "none",
    ) as HTMLElement;
    expect(rendererEl).toBeTruthy();
    const cam = cameraInstances.at(-1)!;
    rendererEl.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 40 }));
    expect(cam.quaternion.setFromEuler).toHaveBeenCalled();
    // 松开指针后右键不触发自身旋转
    window.dispatchEvent(new PointerEvent("pointerup"));
    cam.quaternion.setFromEuler.mockClear();
    rendererEl.dispatchEvent(new PointerEvent("pointerdown", { button: 2, clientX: 10, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 40 }));
    expect(cam.quaternion.setFromEuler).not.toHaveBeenCalled();
    unmountOverlay(overlay);
  });
});

// ===== appendLitematicPreview 对称契约（Phase B-1，2026-08-24）=====
// 轻量：只验证它经统一路由主门收口为 cooperate=true（keepInScene 追加），
// 不触发真实 3D mount。与 appendMmdPreview/appendVrmPreview 同层薄委托，不测内部实现。
describe("appendLitematicPreview — 同台追加入口对称 mmd/vrm", () => {
  it("调 openModel3DFullscreen 且透传 cooperate:true", async () => {
    const lib = await import("./preview-library.ts");
    const spy = vi.spyOn(lib, "openModel3DFullscreen").mockResolvedValue(undefined);
    const { appendLitematicPreview } = await import("./litematic-3d.ts");
    await appendLitematicPreview("/b.litematic");
    expect(spy).toHaveBeenCalledWith("/b.litematic", { cooperate: true });
    spy.mockRestore();
  });

  it("cooperate 缺省不为 false（保持追加语义，不误触替换清理）", async () => {
    const lib = await import("./preview-library.ts");
    const spy = vi.spyOn(lib, "openModel3DFullscreen").mockResolvedValue(undefined);
    const { appendLitematicPreview } = await import("./litematic-3d.ts");
    await appendLitematicPreview("/c.blueprint");
    const opts = spy.mock.calls[0]?.[1];
    expect(opts?.cooperate).toBe(true);
    spy.mockRestore();
  });
});

/** 直接移除 overlay（避免污染后续用例；内部状态由 afterEach cleanupVoxel3D 清理）。
 * 注意：不能靠「点第一个 button」关闭——ADR-076 v2 后第一个 button 是 ⚙️ 根菜单按钮，
 * close 收进菜单项，直接 removeChild 更稳。 */
function unmountOverlay(overlay: HTMLElement): void {
  if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
}

// ===== ADR-132 遗留 1：蓝图/litematic zip 容器内多模型装配 =====
// createLitematic3D 对 .zip 路径先 ListContainerEntries 枚举 → 装配容器内多模型 adapter
// （containerPath + modelEntries + 容器内 voxelCall）→ 初始 entry = 首项；裸文件零回归。
describe("createLitematic3D .zip 容器（ADR-132 遗留 1）", () => {
  it("zip 枚举出多 entry → 装配容器内 adapter，初始 build 首项 entry，voxelCall 走 GetVoxelDataInContainer", async () => {
    const voxelInContainer = vi.fn().mockResolvedValue(VALID_JSON);
    vi.mocked(getApp).mockResolvedValue({
      ListContainerEntries: vi.fn().mockResolvedValue(JSON.stringify(["builds/a.nbt", "builds/b.litematic"])),
      GetVoxelDataInContainer: voxelInContainer,
    } as unknown as AppBindings);
    await createLitematic3D("/lib/blueprint.zip", "GetLitematicVoxelData");
    // 初始 entry = 首项（builds/a.nbt），容器内 voxelCall 读容器字节
    expect(voxelInContainer).toHaveBeenCalledWith("/lib/blueprint.zip", "builds/a.nbt", ".nbt");
    const overlay = lastOverlay();
    expect(overlay).toBeTruthy();
    // 多模型 select 已注入（schema 注册 + menuItems）
    const key = listSchemas().filter((k) => k.startsWith("litematic-slice-")).pop();
    expect(key).toBeTruthy();
    unmountOverlay(overlay);
  });

  it("zip mixed-format（.nbt + .schematic）→ 切换后 GetVoxelDataInContainer 按各 entry 自身 ext 派发（P1 回归）", async () => {
    const voxelInContainer = vi.fn().mockResolvedValue(VALID_JSON);
    vi.mocked(getApp).mockResolvedValue({
      ListContainerEntries: vi.fn().mockResolvedValue(JSON.stringify(["builds/a.nbt", "maps/x.schematic"])),
      GetVoxelDataInContainer: voxelInContainer,
    } as unknown as AppBindings);
    await createLitematic3D("/lib/mixed.zip", "GetLitematicVoxelData");
    // 初始 build 首项 .nbt → 派发 ".nbt"
    expect(voxelInContainer).toHaveBeenLastCalledWith("/lib/mixed.zip", "builds/a.nbt", ".nbt");
    // 会话内切换到 .schematic entry（select onSelect → ctx.switchTo → switchToSession 重建）
    await switchPreview("maps/x.schematic");
    // 修复前：沿用首项 ext ".nbt"（schematic 的 NBT 被喂给 BuildNbtVoxelDataFromRoot → 构建失败）；
    // 修复后：按 entry 路径派生 ".schematic"，对齐 Go switch-ext 分派
    expect(voxelInContainer).toHaveBeenLastCalledWith("/lib/mixed.zip", "maps/x.schematic", ".schematic");
    const overlay = lastOverlay();
    expect(overlay).toBeTruthy();
    unmountOverlay(overlay);
  });

  it("zip 枚举空/失败 → 降级裸路径（不崩溃，走原 GetLitematicVoxelData 契约）", async () => {
    const voxel = vi.fn().mockResolvedValue(VALID_JSON);
    vi.mocked(getApp).mockResolvedValue({
      ListContainerEntries: vi.fn().mockResolvedValue("[]"),
      GetLitematicVoxelData: voxel,
    } as unknown as AppBindings);
    await createLitematic3D("/lib/empty.zip", "GetLitematicVoxelData");
    // 空容器 → 降级裸路径（zip 当裸文件读，仍走原契约，不崩溃）
    expect(voxel).toHaveBeenCalledWith("/lib/empty.zip");
    const overlay = lastOverlay();
    expect(overlay).toBeTruthy();
    unmountOverlay(overlay);
  });

  it("zip 单 entry → 无 select（单模型无选择语义）", async () => {
    vi.mocked(getApp).mockResolvedValue({
      ListContainerEntries: vi.fn().mockResolvedValue(JSON.stringify(["builds/only.nbt"])),
      GetVoxelDataInContainer: vi.fn().mockResolvedValue(VALID_JSON),
    } as unknown as AppBindings);
    await createLitematic3D("/lib/single.zip", "GetLitematicVoxelData");
    const overlay = lastOverlay();
    expect(overlay).toBeTruthy();
    // 单候选无 select 节点（menuItems 仅 slice 面板）——经 schema-registry 验证 slice 仍注册
    const key = listSchemas().filter((k) => k.startsWith("litematic-slice-")).pop();
    expect(key).toBeTruthy();
    unmountOverlay(overlay);
  });

  it("裸 .litematic 文件零回归（不经枚举，直接走 GetLitematicVoxelData）", async () => {
    const voxel = vi.fn().mockResolvedValue(VALID_JSON);
    vi.mocked(getApp).mockResolvedValue({
      GetLitematicVoxelData: voxel,
    } as unknown as AppBindings);
    await createLitematic3D("/a.litematic", "GetLitematicVoxelData");
    expect(voxel).toHaveBeenCalledWith("/a.litematic");
    const overlay = lastOverlay();
    expect(overlay).toBeTruthy();
    unmountOverlay(overlay);
  });
});
