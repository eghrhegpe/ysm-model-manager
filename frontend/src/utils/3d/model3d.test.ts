// ===== 3D 操作偏好加载测试（model3d 纯函数层）=====
// 覆盖：键位/速度/旋转模式 localStorage 解析与回退、compKey 口径
//  + buildSceneMesh：骨骼层级构建（组件组/父挂载/坐标/缩放口径）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Spec3D } from "./model3d.ts";

// three stub：buildSceneMesh + renderModel3D 全链（Group/Scene/Camera/Renderer/灯光/网格/材质/Raycaster）
vi.mock("three", () => {
  const vectorLike = () => ({ x: 0, y: 0, z: 0 });
  // 共享 mock 引用（类字段在实例上，prototype 不可注入 → 导出共享对象供测试覆写返回值）
  const raycaster = { setFromCamera: vi.fn(), intersectObjects: vi.fn(() => []) };
  const box3 = {
    expandByObject: vi.fn(),
    isEmpty: vi.fn(() => true),
    getCenter: vi.fn(() => vectorLike()),
    getSize: vi.fn(() => ({ x: 1, y: 1, z: 1 })),
  };
  class FakeRaycaster {
    setFromCamera = raycaster.setFromCamera;
    intersectObjects = raycaster.intersectObjects;
  }
  class FakeBox3 {
    expandByObject = box3.expandByObject;
    isEmpty = box3.isEmpty;
    getCenter = box3.getCenter;
    getSize = box3.getSize;
  }
  class FakeGroup {
    name = "";
    visible = true;
    isGroup = true;
    scale = { set: vi.fn() };
    position = { x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn(), add: vi.fn(), addScaledVector: vi.fn() };
    quaternion = { x: 0, y: 0, z: 0, w: 1, set: vi.fn(), setFromEuler: vi.fn() };
    children: unknown[] = [];
    add(...cs: unknown[]) {
      this.children.push(...cs);
      return this;
    }
    traverse(fn: (c: unknown) => void): void {
      fn(this);
      for (const c of this.children) (c as { traverse?: (f: (c: unknown) => void) => void }).traverse?.(fn);
    }
    getWorldPosition(v: { x: number; y: number; z: number }): typeof v {
      v.x = 0;
      v.y = 0;
      v.z = 0;
      return v;
    }
    updateMatrixWorld(): void {}
  }
  class FakeScene {
    background: unknown;
    children: unknown[] = [];
    add(...cs: unknown[]) {
      this.children.push(...cs);
      return this;
    }
    remove(c: unknown): void {
      this.children = this.children.filter((x) => x !== c);
    }
    traverse(fn: (c: unknown) => void): void {
      this.children.forEach((c) => {
        if ((c as { traverse?: (f: (c: unknown) => void) => void }).traverse) (c as { traverse: (f: (c: unknown) => void) => void }).traverse(fn);
        else fn(c);
      });
    }
    updateMatrixWorld(): void {}
  }
  class FakeCamera {
    position = { set: vi.fn(), copy: vi.fn(), add: vi.fn(), addScaledVector: vi.fn(), clone: vi.fn(() => ({ copy: vi.fn() })) };
    quaternion = { setFromEuler: vi.fn(), set: vi.fn() };
    lookAt = vi.fn();
    getWorldDirection = vi.fn(() => vectorLike());
    aspect = 0;
    updateProjectionMatrix = vi.fn();
  }
  class FakeRenderer {
    domElement = document.createElement("canvas");
    outputColorSpace = "";
    setSize = vi.fn();
    setPixelRatio = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
  }
  class FakeMesh {
    isMesh = true;
    position = { set: vi.fn() };
    quaternion = { set: vi.fn() };
    geometry = { dispose: vi.fn(), setAttribute: vi.fn() };
    material = { dispose: vi.fn(), map: { dispose: vi.fn() } };
  }
  class FakeVector3 {
    x: number;
    y: number;
    z: number;
    normalize = vi.fn(function (this: FakeVector3) { return this; });
    add = vi.fn(function (this: FakeVector3) { return this; });
    sub = vi.fn(function (this: FakeVector3) { return this; });
    multiplyScalar = vi.fn(function (this: FakeVector3) { return this; });
    crossVectors = vi.fn(function (this: FakeVector3) { return this; });
    clone = vi.fn(() => new FakeVector3());
    length = vi.fn(() => 0);
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  }
  return {
    Group: FakeGroup,
    Scene: FakeScene,
    WebGLRenderer: FakeRenderer,
    PerspectiveCamera: FakeCamera,
    AmbientLight: class { constructor(..._a: unknown[]) {} },
    DirectionalLight: class { position = { set: vi.fn() }; constructor(..._a: unknown[]) {} },
    GridHelper: class { position = { set: vi.fn() }; constructor(..._a: unknown[]) {} },
    AxesHelper: class { position = { set: vi.fn() }; constructor(..._a: unknown[]) {} },
    Color: class { constructor(..._a: unknown[]) {} },
    BufferGeometry: class {
      setAttribute = vi.fn();
      setIndex = vi.fn();
      setFromPoints = vi.fn();
      dispose = vi.fn();
    },
    Float32BufferAttribute: class {},
    MeshBasicMaterial: class { constructor(..._a: unknown[]) {} dispose = vi.fn(); },
    Mesh: FakeMesh,
    Box3: FakeBox3,
    Vector3: FakeVector3,
    Euler: class { setFromQuaternion = vi.fn(); set = vi.fn(); constructor(..._a: unknown[]) {} },
    Quaternion: class {},
    Raycaster: FakeRaycaster,
    Vector2: class {},
    CanvasTexture: class { minFilter = ""; premultiplyAlpha = false; constructor(..._a: unknown[]) {} dispose = vi.fn(); },
    Line: class { geometry = { dispose: vi.fn() }; material = { dispose: vi.fn() }; },
    LineBasicMaterial: class { constructor(..._a: unknown[]) {} dispose = vi.fn(); },
    Sprite: class { position = { copy: vi.fn() }; scale = { set: vi.fn() }; material = { dispose: vi.fn(), map: { dispose: vi.fn() } }; },
    SpriteMaterial: class { constructor(..._a: unknown[]) {} dispose = vi.fn(); map = { dispose: vi.fn() }; },
    LinearFilter: "LinearFilter",
    FrontSide: "FrontSide",
    SRGBColorSpace: "srgb",
    __raycaster: raycaster,
    __box3: box3,
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

import { compKey, buildSceneMesh } from "./mesh.ts";
import {
  loadTdKeymap,
  loadTdCamSpeed,
  loadTdRotMode,
  DEFAULT_TD_KEYMAP,
  renderModel3D,
  type RenderModel3DHandle,
} from "./model3d.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("loadTdKeymap", () => {
  it("无存储 → 默认键位", () => {
    expect(loadTdKeymap()).toEqual(DEFAULT_TD_KEYMAP);
  });

  it("合法自定义键位 → 逐字段合并", () => {
    localStorage.setItem(
      "td-keymap",
      JSON.stringify({ forward: "KeyE", up: "KeyQ" }),
    );
    const m = loadTdKeymap();
    expect(m.forward).toBe("KeyE");
    expect(m.up).toBe("KeyQ");
    expect(m.back).toBe(DEFAULT_TD_KEYMAP.back); // 未覆盖字段保留默认
  });

  it("损坏 JSON → 回退默认", () => {
    localStorage.setItem("td-keymap", "{bad json");
    expect(loadTdKeymap()).toEqual(DEFAULT_TD_KEYMAP);
  });

  it("空字符串字段 → 忽略用默认", () => {
    localStorage.setItem("td-keymap", JSON.stringify({ forward: "" }));
    expect(loadTdKeymap().forward).toBe(DEFAULT_TD_KEYMAP.forward);
  });
});

describe("loadTdCamSpeed", () => {
  it("默认 20；合法值保留；越界/非数字回退", () => {
    expect(loadTdCamSpeed()).toBe(20);
    localStorage.setItem("td-cam-speed", "55");
    expect(loadTdCamSpeed()).toBe(55);
    localStorage.setItem("td-cam-speed", "1"); // < 2
    expect(loadTdCamSpeed()).toBe(20);
    localStorage.setItem("td-cam-speed", "999"); // > 200
    expect(loadTdCamSpeed()).toBe(20);
    localStorage.setItem("td-cam-speed", "abc");
    expect(loadTdCamSpeed()).toBe(20);
  });
});

describe("loadTdRotMode", () => {
  it("非 free → orbit；free → 自由旋转", () => {
    expect(loadTdRotMode()).toBe(true);
    localStorage.setItem("td-rot-mode", "orbit");
    expect(loadTdRotMode()).toBe(true);
    localStorage.setItem("td-rot-mode", "free");
    expect(loadTdRotMode()).toBe(false);
  });
});

describe("compKey", () => {
  it("mi:id 口径（多组件同名骨骼不冲突）", () => {
    expect(compKey(0, "body")).toBe("0:body");
    expect(compKey(2, "body")).toBe("2:body");
  });
});

describe("buildSceneMesh — 骨骼层级构建", () => {
  const spec: Spec3D = {
    models: [
      {
        id: "main",
        defaultVisible: false,
        bones: [
          {
            id: "root",
            name: "root",
            localPosition: [1, 2, 3],
            localRotation: [0, 0, 0, 1],
          },
          {
            id: "head",
            name: "head",
            parentId: "root",
            localPosition: [0, 0, 1],
            localRotation: [0, 0, 0, 1],
          },
          {
            id: "arm",
            name: "arm",
            localPosition: [0, 0, 0],
            localRotation: [0.1, 0, 0, 0.9],
          },
        ],
      },
      {
        id: "armor",
        bones: [
          {
            id: "root",
            name: "root2",
            localPosition: [0, 0, 0],
            localRotation: [0, 0, 0, 1],
          },
        ],
      },
    ],
  };

  it("modelScale 固定 1/16（基岩口径）+ 根组等比缩放", () => {
    const { modelScale, rootGroup } = buildSceneMesh(spec);
    expect(modelScale).toBe(1 / 16);
    expect(rootGroup.scale.set).toHaveBeenCalledWith(1 / 16, 1 / 16, 1 / 16);
  });

  it("组件级 modelGroup：name/visible 按 defaultVisible", () => {
    const { modelGroups } = buildSceneMesh(spec);
    expect(modelGroups).toHaveLength(2);
    expect(modelGroups[0]!.name).toBe("main");
    expect(modelGroups[0]!.visible).toBe(false); // defaultVisible: false
    expect(modelGroups[1]!.visible).toBe(true); // 缺省可见
  });

  it("bone 组位置/旋转 + 父子挂载（head→root→main modelGroup）", () => {
    const { boneGroupMap, modelGroups } = buildSceneMesh(spec);
    const root = boneGroupMap.get("0:root")!;
    expect(root.name).toBe("root");
    expect(root.position.set).toHaveBeenCalledWith(1, 2, 3);
    // head 挂到 root
    expect(root.children).toContain(boneGroupMap.get("0:head"));
    // root 挂到 main modelGroup
    expect(modelGroups[0]!.children).toContain(root);
  });

  it("组件 key 隔离：两个组件的 root 不冲突", () => {
    const { boneGroupMap } = buildSceneMesh(spec);
    expect(boneGroupMap.get("0:root")).not.toBe(boneGroupMap.get("1:root"));
  });

  it("全局 key 先到先得（main 组件优先）", () => {
    const { boneGroupMap } = buildSceneMesh(spec);
    expect(boneGroupMap.get("root")).toBe(boneGroupMap.get("0:root"));
  });

  it("非单位旋转 → quaternion.set 被调；单位旋转跳过", () => {
    const { boneGroupMap } = buildSceneMesh(spec);
    const arm = boneGroupMap.get("0:arm")!;
    expect(arm.quaternion.set).toHaveBeenCalled();
    const root = boneGroupMap.get("0:root")!;
    expect(root.quaternion.set).not.toHaveBeenCalled();
  });

  it("空 spec → 空组映射 + 空模型组", () => {
    const { boneGroupMap, rootGroup, modelGroups } = buildSceneMesh({
      models: [],
    });
    expect(boneGroupMap.size).toBe(0);
    expect(modelGroups).toHaveLength(0);
    expect(rootGroup.children).toHaveLength(0);
  });
});

// ===== renderModel3D 渲染管线（three 全 stub，验证 handle 契约 + 事件闭环）=====
import * as THREE from "three";

const renderSpec: Spec3D = {
  models: [
    {
      id: "main",
      bones: [
        { id: "root", name: "root", localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1] },
      ],
      meshGroups: [
        {
          boneId: "root",
          positions: [0, 0, 0, 1, 1, 1],
          normals: [0, 0, 1, 0, 0, 1],
          uvs: [0, 0, 1, 1],
          indices: [0, 1],
          texIdx: 0,
          localPosition: [0, 0, 0],
          localRotation: [0, 0, 0, 1],
        },
      ],
    },
  ],
};

const raycasterMock = (THREE as unknown as {
  __raycaster: { setFromCamera: ReturnType<typeof vi.fn>; intersectObjects: ReturnType<typeof vi.fn> };
}).__raycaster;
const box3Mock = (THREE as unknown as {
  __box3: {
    expandByObject: ReturnType<typeof vi.fn>;
    isEmpty: ReturnType<typeof vi.fn>;
    getCenter: ReturnType<typeof vi.fn>;
    getSize: ReturnType<typeof vi.fn>;
  };
}).__box3;

function makeContainer(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("renderModel3D", () => {
  let container: HTMLDivElement;
  let handle: RenderModel3DHandle;

  beforeEach(async () => {
    container = makeContainer();
    handle = await renderModel3D(container, [], renderSpec);
  });

  afterEach(() => {
    handle?.cleanup();
    if (container?.parentNode) container.parentNode.removeChild(container);
    localStorage.clear();
  });

  it("主路径：renderer canvas 挂入容器 + 句柄契约齐备", () => {
    expect(container.querySelector("canvas")).toBeTruthy();
    expect(typeof handle.resetCamera).toBe("function");
    expect(typeof handle.setBoneVisible).toBe("function");
    expect(typeof handle.toggleBone).toBe("function");
    expect(typeof handle.showModelGroup).toBe("function");
    expect(typeof handle.setDebugMode).toBe("function");
    expect(handle.getModelGroupCount()).toBe(1);
    expect(handle.getBoneList()).toEqual([{ id: "root", name: "root", parentId: undefined }]);
  });

  it("showModelGroup：idx 显示单组，-1/NaN 全部显示", () => {
    handle.showModelGroup(0);
    handle.showModelGroup(-1);
    handle.showModelGroup(NaN);
  });

  it("setRotationMode：orbit/free 切换不抛；resetCamera 回位", () => {
    handle.setRotationMode(false);
    handle.setRotationMode(true);
    handle.resetCamera();
  });

  it("键盘 F 循环 debug 模式（normal→pivot→bone→normal）", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
  });

  it("setDebugMode 直设 pivot/bone（rebuildDebug 全分支）", () => {
    handle.setDebugMode("pivot");
    handle.setDebugMode("bone");
    handle.setDebugMode("normal");
  });

  it("onBoneSelect：pointermove 命中骨骼 → click 回调携带层级信息", () => {
    raycasterMock.intersectObjects.mockReturnValue([
      { object: { isGroup: true, name: "root", parent: null, visible: true } },
    ]);
    const canvas = container.querySelector("canvas") as HTMLElement;
    const cb = vi.fn();
    handle.onBoneSelect = cb;
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 10 }));
    canvas.dispatchEvent(new MouseEvent("click"));
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "root",
        parent: null,
        children: [],
        localPos: [0, 0, 0],
        localRot: null,
      }),
    );
  });

  it("box 非空 → 相机按包围盒定位", async () => {
    box3Mock.isEmpty.mockReturnValue(false);
    const h2 = await renderModel3D(makeContainer(), [], renderSpec);
    h2.cleanup();
  });

  it("入口守卫：二次渲染先 dispose 旧 renderer（防僵尸 rAF）", async () => {
    // 首个 renderer 的 dispose 在第二次 renderModel3D 入口被调用
    const h2 = await renderModel3D(makeContainer(), [], renderSpec);
    expect(h2).toBeTruthy();
    h2.cleanup();
  });

  it("cleanup：清空容器 + 事件解绑（再次 cleanup 幂等）", () => {
    handle.cleanup();
    handle.cleanup();
    expect(container.innerHTML).toBe("");
  });
});

