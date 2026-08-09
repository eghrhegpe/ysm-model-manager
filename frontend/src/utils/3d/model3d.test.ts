// ===== 3D 操作偏好加载测试（model3d 纯函数层）=====
// 覆盖：键位/速度/旋转模式 localStorage 解析与回退、compKey 口径
//  + buildSceneMesh：骨骼层级构建（组件组/父挂载/坐标/缩放口径）
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Spec3D } from "./model3d.ts";

// three stub：仅 buildSceneMesh 用到 Group（renderModel3D/screenshotPreview 不测）
vi.mock("three", () => {
  class FakeGroup {
    name = "";
    visible = true;
    scale = { set: vi.fn() };
    position = { set: vi.fn() };
    quaternion = { set: vi.fn() };
    children: unknown[] = [];
    add(...cs: unknown[]) {
      this.children.push(...cs);
      return this;
    }
  }
  return {
    Group: FakeGroup,
    Scene: class {},
    WebGLRenderer: class {},
    PerspectiveCamera: class {},
    AmbientLight: class {},
    DirectionalLight: class {},
    BufferGeometry: class {},
    Float32BufferAttribute: class {},
    MeshBasicMaterial: class {},
    Mesh: class {},
    Box3: class {},
    Vector3: class {},
    GroupUtils: undefined,
  };
});

import {
  loadTdKeymap,
  loadTdCamSpeed,
  loadTdRotMode,
  compKey,
  DEFAULT_TD_KEYMAP,
  buildSceneMesh,
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
