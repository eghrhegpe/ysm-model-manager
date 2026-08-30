// @vitest-environment node
// ===== bone-raycast.ts 契约测试 =====
// 覆盖：buildBoneHierarchy 层级映射聚合、getMeshBoneId 父链匹配、
// assembleBoneSelectInfo 信息组装（world/local/旋转/meshCount/cube 数据），
// registerBoneRaycast 的命中/空白/隐藏跳过/click 回调/cleanup 生命周期。
//
// registerBoneRaycast 只依赖 renderer.domElement 的 addEventListener /
// removeEventListener / getBoundingClientRect / style 四个鸭子类型成员，
// 用 FakeDomElement 纯对象即可在 node 环境驱动完整拾取逻辑（three Raycaster 为纯数学）。
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  buildBoneHierarchy,
  getMeshBoneId,
  assembleBoneSelectInfo,
  registerBoneRaycast,
} from "./bone-raycast.ts";
import type { BoneSelectInfo } from "./model3d.ts";

/** 骨骼声明 fixture：hips → head 两级 */
function makeSpec() {
  return {
    models: [
      {
        bones: [
          { id: "hips", name: "臀部" },
          { id: "head", name: "头部", parentId: "hips" },
        ],
      },
    ],
  };
}

describe("buildBoneHierarchy", () => {
  it("nameMap / parentMap / childrenMap 三表聚合", () => {
    const { nameMap, parentMap, childrenMap } = buildBoneHierarchy(makeSpec());
    expect(nameMap.get("hips")).toBe("臀部");
    expect(nameMap.get("head")).toBe("头部");
    expect(parentMap.get("hips")).toBeNull();
    expect(parentMap.get("head")).toBe("hips");
    // 无父级骨骼聚合到 __root__ 哨兵键
    expect(childrenMap.get("__root__")).toEqual(["hips"]);
    expect(childrenMap.get("hips")).toEqual(["head"]);
  });

  it("多模型组骨骼并入同一套映射", () => {
    const spec = {
      models: [
        { bones: [{ id: "a", name: "A" }] },
        { bones: [{ id: "b", name: "B", parentId: "a" }] },
      ],
    };
    const { childrenMap, parentMap } = buildBoneHierarchy(spec);
    expect(childrenMap.get("__root__")).toEqual(["a"]);
    expect(childrenMap.get("a")).toEqual(["b"]);
    expect(parentMap.get("b")).toBe("a");
  });

  it("空 spec → 空映射不抛", () => {
    const { nameMap, parentMap, childrenMap } = buildBoneHierarchy({});
    expect(nameMap.size).toBe(0);
    expect(parentMap.size).toBe(0);
    expect(childrenMap.size).toBe(0);
  });
});

describe("getMeshBoneId", () => {
  const { nameMap } = buildBoneHierarchy(makeSpec());

  it("父链上 isGroup 且命名命中 nameMap → 返回该名", () => {
    const group = new THREE.Group();
    group.name = "head";
    const mesh = new THREE.Mesh(new THREE.BufferGeometry());
    group.add(mesh);
    expect(getMeshBoneId(mesh, nameMap)).toBe("head");
  });

  it("自身是 isGroup 命名命中 → 返回自身名", () => {
    const group = new THREE.Group();
    group.name = "hips";
    expect(getMeshBoneId(group, nameMap)).toBe("hips");
  });

  it("Mesh 自身命名不算（须 isGroup 节点）→ 无命中返回 null", () => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry());
    mesh.name = "head";
    expect(getMeshBoneId(mesh, nameMap)).toBeNull();
  });

  it("链上命名均不在 nameMap → null", () => {
    const group = new THREE.Group();
    group.name = "notABone";
    const mesh = new THREE.Mesh(new THREE.BufferGeometry());
    group.add(mesh);
    expect(getMeshBoneId(mesh, nameMap)).toBeNull();
  });
});

describe("assembleBoneSelectInfo", () => {
  function makeRig(rotationY = 0) {
    const { nameMap, parentMap, childrenMap } = buildBoneHierarchy(makeSpec());
    const group = new THREE.Group();
    group.name = "head";
    group.position.set(0, 2, -5);
    group.rotation.y = rotationY;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.position.set(0.5, 0, 0);
    group.add(mesh);
    const boneGroupMap = new Map([["head", group]]);
    return { nameMap, parentMap, childrenMap, group, mesh, boneGroupMap };
  }

  it("完整组装：name/path/parent/children/meshCount/local/world", () => {
    const rig = makeRig();
    const info = assembleBoneSelectInfo(
      "head", rig.boneGroupMap, rig.nameMap, rig.parentMap, rig.childrenMap, null,
    );
    expect(info.name).toBe("头部");
    expect(info.path).toBe("臀部 / 头部");
    expect(info.parent).toBe("hips");
    expect(info.children).toEqual([]);
    expect(info.meshCount).toBe(1);
    expect(info.localPos).toEqual([0, 2, -5]);
    expect(info.worldPos).toEqual([0, 2, -5]);
  });

  it("非单位四元数 → localRot 输出四元数分量；单位四元数 → null", () => {
    const rotated = makeRig(Math.PI / 2);
    const info = assembleBoneSelectInfo(
      "head", rotated.boneGroupMap, rotated.nameMap, rotated.parentMap, rotated.childrenMap, null,
    );
    expect(info.localRot).not.toBeNull();
    expect(info.localRot![1]).toBeCloseTo(Math.SQRT1_2, 6); // 绕 Y 轴 90°
    expect(info.localRot![3]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(info.localRot![0]).toBeCloseTo(0, 6);

    const plain = makeRig();
    const info2 = assembleBoneSelectInfo(
      "head", plain.boneGroupMap, plain.nameMap, plain.parentMap, plain.childrenMap, null,
    );
    expect(info2.localRot).toBeNull();
  });

  it("hoveredMesh 为 Mesh → cubeRot / cubePos 取 mesh 局部变换", () => {
    const rig = makeRig();
    const info = assembleBoneSelectInfo(
      "head", rig.boneGroupMap, rig.nameMap, rig.parentMap, rig.childrenMap, rig.mesh,
    );
    expect(info.cubePos).toEqual([0.5, 0, 0]);
    expect(info.cubeRot).toEqual([0, 0, 0, 1]);
  });

  it("hoveredMesh 非 Mesh（null）→ cube 数据为 null", () => {
    const rig = makeRig();
    const info = assembleBoneSelectInfo(
      "head", rig.boneGroupMap, rig.nameMap, rig.parentMap, rig.childrenMap, null,
    );
    expect(info.cubeRot).toBeNull();
    expect(info.cubePos).toBeNull();
  });

  it("boneGroupMap 缺骨骼 → 零变换兜底 + name 回退 boneId", () => {
    const rig = makeRig();
    const info = assembleBoneSelectInfo(
      "missing", rig.boneGroupMap, rig.nameMap, rig.parentMap, rig.childrenMap, null,
    );
    expect(info.name).toBe("missing");
    expect(info.meshCount).toBe(0);
    expect(info.worldPos).toEqual([0, 0, 0]);
    expect(info.localPos).toEqual([0, 0, 0]);
    expect(info.path).toBe(""); // nameMap/parentMap 均无该 id
  });
});

// ---------------------------------------------------------------------------
// registerBoneRaycast
// ---------------------------------------------------------------------------

/** renderer.domElement 鸭子类型替身：收集监听器 + 手动 dispatch */
class FakeDomElement {
  style: Record<string, string> = {};
  private listeners = new Map<string, Array<(e: unknown) => void>>();

  addEventListener(type: string, fn: (e: unknown) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  dispatch(type: string, event: { clientX?: number; clientY?: number } = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 200, height: 200 };
  }
}

/** 拾取环境：相机在原点，"head" 骨骼组（含 1 Mesh）位于 (0,0,-5)，屏幕中心射线必命中 */
function makePickRig() {
  const el = new FakeDomElement();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.updateMatrixWorld(true);
  const scene = new THREE.Scene();

  const group = new THREE.Group();
  group.name = "head";
  group.position.set(0, 0, -5);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  group.add(mesh);
  scene.add(group);
  scene.updateMatrixWorld(true); // Raycaster 不自动更新矩阵，须先刷 world 矩阵

  const { nameMap, parentMap, childrenMap } = buildBoneHierarchy(makeSpec());
  const boneGroupMap = new Map([["head", group]]);

  const state = {
    hoveredBone: null as string | null,
    hoveredMesh: null as THREE.Object3D | null,
    setHoveredBone: vi.fn((v: string | null) => { state.hoveredBone = v; }),
    setHoveredMesh: vi.fn((v: THREE.Object3D | null) => { state.hoveredMesh = v; }),
    onBoneSelectCallback: null as ((info: BoneSelectInfo) => void) | null,
  };

  const dispose = registerBoneRaycast(
    { domElement: el as unknown as HTMLElement },
    camera, scene, boneGroupMap, nameMap, parentMap, childrenMap, state,
  );
  return { el, group, mesh, state, dispose };
}

describe("registerBoneRaycast", () => {
  it("pointermove 命中骨骼 → setHoveredBone/Mesh + cursor pointer", () => {
    const rig = makePickRig();
    rig.el.dispatch("pointermove", { clientX: 100, clientY: 100 }); // 视口中心
    expect(rig.state.hoveredBone).toBe("head");
    expect(rig.state.hoveredMesh).toBe(rig.mesh);
    expect(rig.el.style.cursor).toBe("pointer");
  });

  it("pointermove 移到空白 → 清除 hover + cursor default", () => {
    const rig = makePickRig();
    rig.el.dispatch("pointermove", { clientX: 100, clientY: 100 });
    rig.el.dispatch("pointermove", { clientX: 1, clientY: 199 }); // 左上角，射线偏离
    expect(rig.state.hoveredBone).toBeNull();
    expect(rig.state.hoveredMesh).toBeNull();
    expect(rig.el.style.cursor).toBe("default");
  });

  it("骨骼不可见 → 沿父链跳过，视为未命中", () => {
    const rig = makePickRig();
    rig.el.dispatch("pointermove", { clientX: 100, clientY: 100 });
    expect(rig.state.hoveredBone).toBe("head");

    rig.group.visible = false; // Raycaster 仍会命中，但须手动跳过
    rig.el.dispatch("pointermove", { clientX: 100, clientY: 100 });
    expect(rig.state.hoveredBone).toBeNull();
    expect(rig.el.style.cursor).toBe("default");
  });

  it("hover 不变化 → 不重复触发 setter", () => {
    const rig = makePickRig();
    rig.el.dispatch("pointermove", { clientX: 100, clientY: 100 });
    rig.el.dispatch("pointermove", { clientX: 101, clientY: 99 }); // 仍命中同一骨骼
    expect(rig.state.setHoveredBone).toHaveBeenCalledTimes(1);
  });

  it("click：hover 中且回调已设 → 组装 BoneSelectInfo 回调", () => {
    const rig = makePickRig();
    const callback = vi.fn();
    rig.state.onBoneSelectCallback = callback; // 延迟设置（经 state 读取）
    rig.el.dispatch("pointermove", { clientX: 100, clientY: 100 });
    rig.el.dispatch("click", {});
    expect(callback).toHaveBeenCalledTimes(1);
    const info = callback.mock.calls[0][0] as BoneSelectInfo;
    expect(info.name).toBe("头部");
    expect(info.meshCount).toBe(1);
    expect(info.worldPos).toEqual([0, 0, -5]);
    expect(info.cubePos).toEqual([0, 0, 0]);
  });

  it("click：无 hover 或无回调 → 不触发", () => {
    const rig = makePickRig();
    const callback = vi.fn();
    rig.state.onBoneSelectCallback = callback;
    rig.el.dispatch("click", {}); // hoveredBone=null
    expect(callback).not.toHaveBeenCalled();

    rig.state.onBoneSelectCallback = null;
    rig.el.dispatch("pointermove", { clientX: 100, clientY: 100 });
    rig.el.dispatch("click", {}); // 回调为 null
    expect(callback).not.toHaveBeenCalled();
  });

  it("cleanup → 移除监听器，后续事件不再驱动 hover", () => {
    const rig = makePickRig();
    rig.dispose();
    rig.el.dispatch("pointermove", { clientX: 100, clientY: 100 });
    rig.el.dispatch("click", {});
    expect(rig.state.setHoveredBone).not.toHaveBeenCalled();
    expect(rig.state.hoveredBone).toBeNull();
  });
});
