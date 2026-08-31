// ===== frustum-cull 险恶测试 =====
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as THREE from "three";
import {
  registerModelRoot,
  unregisterModelRoot,
  cullModelGroups,
  clearModelRoots,
  getModelRootCount,
  isFrustumCullEnabled,
  setFrustumCullEnabled,
  restoreModelGroupsVisible,
} from "./frustum-cull.ts";

// Mock THREE 的 Frustum/Matrix4 以控制裁剪结果
vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  return actual;
});

function makeGroup(name?: string): THREE.Group {
  const g = new THREE.Group();
  if (name) g.name = name;
  // 给一个默认的 bounding box（非空）
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geo);
  g.add(mesh);
  return g;
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
}

describe("frustum-cull", () => {
  beforeEach(() => {
    clearModelRoots();
  });

  it("register + getModelRootCount", () => {
    const g = makeGroup();
    expect(getModelRootCount()).toBe(0);
    registerModelRoot(g);
    expect(getModelRootCount()).toBe(1);
    registerModelRoot(g); // 重复注册不增加
    expect(getModelRootCount()).toBe(1);
  });

  it("unregister", () => {
    const g1 = makeGroup("a");
    const g2 = makeGroup("b");
    registerModelRoot(g1);
    registerModelRoot(g2);
    expect(getModelRootCount()).toBe(2);
    unregisterModelRoot(g1);
    expect(getModelRootCount()).toBe(1);
    unregisterModelRoot(makeGroup("unknown")); // 不存在的不报错
    expect(getModelRootCount()).toBe(1);
  });

  it("clearModelRoots", () => {
    registerModelRoot(makeGroup("a"));
    registerModelRoot(makeGroup("b"));
    registerModelRoot(makeGroup("c"));
    expect(getModelRootCount()).toBe(3);
    clearModelRoots();
    expect(getModelRootCount()).toBe(0);
  });

  it("cullModelGroups 清理已移除的引用", () => {
    const g = makeGroup();
    registerModelRoot(g);
    expect(getModelRootCount()).toBe(1);
    // 从父节点移除
    const parent = new THREE.Scene();
    parent.add(g);
    parent.remove(g);
    // cull 时应自动清理
    cullModelGroups(makeCamera());
    expect(getModelRootCount()).toBe(0);
  });

  it("cullModelGroups 不报错当无注册时", () => {
    expect(() => cullModelGroups(makeCamera())).not.toThrow();
  });

  it("cullModelGroups 对空组设置 visible=false", () => {
    const g = new THREE.Group(); // 空组，无子节点 → 空 bounding box
    registerModelRoot(g);
    const scene = new THREE.Scene();
    scene.add(g);
    cullModelGroups(makeCamera());
    // 空组应被裁剪
    expect(g.visible).toBe(false);
  });

  it("cullModelGroups 对有内容的组保留 visible", () => {
    const g = makeGroup("content");
    registerModelRoot(g);
    const scene = new THREE.Scene();
    scene.add(g);
    // 相机正对原点，组在原点 → 应该可见
    const cam = makeCamera();
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cullModelGroups(cam);
    expect(g.visible).toBe(true);
  });

  it("single-model preview skips recursive group bounds and uses mesh culling", () => {
    const g = makeGroup("single");
    const scene = new THREE.Scene();
    scene.add(g);
    registerModelRoot(g);
    const boundsSpy = vi.spyOn(THREE.Box3.prototype, "setFromObject");

    cullModelGroups(makeCamera());

    expect(boundsSpy).not.toHaveBeenCalled();
    expect(g.visible).toBe(true);
    boundsSpy.mockRestore();
  });

  it("多模型独立裁剪", () => {
    const g1 = makeGroup("near");
    g1.position.set(0, 0, 0);
    const g2 = makeGroup("far");
    g2.position.set(10000, 10000, 10000); // 极远处
    registerModelRoot(g1);
    registerModelRoot(g2);
    const scene = new THREE.Scene();
    scene.add(g1);
    scene.add(g2);
    const cam = makeCamera();
    cam.position.set(0, 0, 5);
    cam.lookAt(0, 0, 0);
    cullModelGroups(cam);
    // 近处组可见，极远组不可见
    expect(g1.visible).toBe(true);
    expect(g2.visible).toBe(false);
  });

  describe("多组件 bounding box 只计可见子树（修复②：载具/投射物隐藏不撑大 box）", () => {
    /** 构造带 geometry.boundingBox 的 mesh（expandBoxVisible 依赖已计算 bbox） */
    function makeMeshWithBounds(min: [number, number, number], max: [number, number, number]): THREE.Mesh {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.computeBoundingBox();
      // 手动覆盖 boundingBox 以控制范围
      geo.boundingBox!.min.set(min[0], min[1], min[2]);
      geo.boundingBox!.max.set(max[0], max[1], max[2]);
      return new THREE.Mesh(geo);
    }

    it("隐藏的子组件（车）不计入 rootGroup 的 bounding box", () => {
      // 模拟 wine_fox 多组件：rootGroup 下有 main（角色，小范围）+ foxcar（车，远端大范围）
      const rootGroup = new THREE.Group();
      const mainGroup = new THREE.Group();
      mainGroup.add(makeMeshWithBounds([-2, 0, -2], [2, 40, 2]));
      const foxcarGroup = new THREE.Group();
      // 车在远端，bounding 极大——若计入会把整体 box 撑到视锥外
      foxcarGroup.add(makeMeshWithBounds([-19, 4, -34], [19, 30, 12]));
      foxcarGroup.visible = false; // 载具默认隐藏（修复① 的契约）
      rootGroup.add(mainGroup);
      rootGroup.add(foxcarGroup);

      const scene = new THREE.Scene();
      scene.add(rootGroup);
      // 需要两个 root 触发多根路径（单根特例不裁剪）
      const otherRoot = makeGroup("other");
      otherRoot.position.set(0, 0, 0);
      scene.add(otherRoot);
      registerModelRoot(rootGroup);
      registerModelRoot(otherRoot);

      // 相机正对原点，角色在原点 → 若 box 只计 main 应可见
      const cam = makeCamera();
      cam.position.set(0, 20, 50);
      cam.lookAt(0, 20, 0);
      cullModelGroups(cam);

      // 若 foxcar 被错误计入 box，整体 box 会偏到 [-19,-34] 远端，
      // bounding sphere 中心偏移 + 半径变大 → 可能被剔除（闪烁根源）
      expect(rootGroup.visible).toBe(true);
      expect(foxcarGroup.visible).toBe(false); // 隐藏的载具保持隐藏
      unregisterModelRoot(rootGroup);
      unregisterModelRoot(otherRoot);
    });

    it("所有子组件都隐藏时 rootGroup 被裁剪（box 为空）", () => {
      const rootGroup = new THREE.Group();
      const mainGroup = new THREE.Group();
      mainGroup.visible = false;
      const foxcarGroup = new THREE.Group();
      foxcarGroup.visible = false;
      rootGroup.add(mainGroup);
      rootGroup.add(foxcarGroup);

      const scene = new THREE.Scene();
      scene.add(rootGroup);
      const otherRoot = makeGroup("other");
      scene.add(otherRoot);
      registerModelRoot(rootGroup);
      registerModelRoot(otherRoot);

      cullModelGroups(makeCamera());

      // 全部子树隐藏 → box 为空 → rootGroup.visible = false
      expect(rootGroup.visible).toBe(false);
      unregisterModelRoot(rootGroup);
      unregisterModelRoot(otherRoot);
    });
  });

  describe("视锥裁剪开关", () => {
    it("默认关闭（无存储值 → undefined → false）", () => {
      // 单模型（单个 YSM/VRM rootGroup）本就走豁免分支、Group 级剔除空转零收益；
      // 默认关免去多根场景误剔/闪烁风险，需多模型同框大场景时手动在设置面板开启。
      localStorage.removeItem("ysm_3d_frustumCull");
      expect(isFrustumCullEnabled()).toBe(false);
    });

    it("setFrustumCullEnabled 切换读写", () => {
      setFrustumCullEnabled(false);
      expect(isFrustumCullEnabled()).toBe(false);
      setFrustumCullEnabled(true);
      expect(isFrustumCullEnabled()).toBe(true);
      localStorage.removeItem("ysm_3d_frustumCull");
    });

    it("restoreModelGroupsVisible 恢复被剔除的注册根（关剔除时兜底）", () => {
      const near = makeGroup("near");
      const g = makeGroup("far");
      g.position.set(10000, 10000, 10000);
      registerModelRoot(near);
      registerModelRoot(g);
      const scene = new THREE.Scene();
      scene.add(near);
      scene.add(g);
      const cam = makeCamera();
      cam.position.set(0, 0, 5);
      cam.lookAt(0, 0, 0);
      // 多根路径（单根特例不裁剪）：极远组被剔除
      cullModelGroups(cam);
      expect(g.visible).toBe(false);
      restoreModelGroupsVisible();
      expect(g.visible).toBe(true); // 关剔除时恢复可见
      expect(near.visible).toBe(true);
      unregisterModelRoot(g);
      unregisterModelRoot(near);
    });
  });
});
