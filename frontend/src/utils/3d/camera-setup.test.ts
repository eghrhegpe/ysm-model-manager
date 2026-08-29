// ===== camera-setup.ts 测试 =====
// 覆盖：fitCameraToScene（单根节点）+ fitCameraToRoots（多根节点并集），
// 验证：包围盒计算正确、相机距离公式、空 Box fallback。
// three 用真实实现（Box3/Vector3/OrbitControls），无 WebGL 依赖。
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { fitCameraToScene, fitCameraToRoots } from "./camera-setup.ts";

/** 构造最小可用的 mock context */
function makeCtx() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);
  const renderer = { domElement: document.createElement("canvas") } as any;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  return { camera, controls };
}

/** 构造一个带包围盒的 Group（模拟模型 rootGroup） */
function makeModelRoot(width = 16, height = 32, depth = 16): THREE.Group {
  const root = new THREE.Group();
  // 挂一个 BoxGeometry 让它有实际包围盒
  const geo = new THREE.BoxGeometry(width, height, depth);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  root.add(mesh);
  return root;
}

describe("fitCameraToScene", () => {
  it("单根节点 → 相机距离基于包围盒最大尺寸 * 1.5 + 2", () => {
    const { camera, controls } = makeCtx();
    const root = makeModelRoot(16, 32, 16); // 最大尺寸 32（像素）
    // 注意：调用方应传入已经应用了 1/16 scale 的 root（如 YSM rootGroup）
    // 这里直接传 raw root，模拟已缩放后的场景
    root.scale.set(1 / 16, 1 / 16, 1 / 16);

    fitCameraToScene(root, camera, controls);

    // 缩放后：1×2×1，maxDim=2，dist = 2 * 1.5 + 2 = 5
    const expectedDist = 5;
    expect(camera.position.z).toBeCloseTo(-expectedDist, 1);
    expect(controls.target).toEqual(new THREE.Vector3(0, 0, 0));
  });

  it("null contentRoot → fallback 到 (0, 80, -120)", () => {
    const { camera, controls } = makeCtx();
    fitCameraToScene(null, camera, controls);
    expect(camera.position.x).toBeCloseTo(0, 10);
    expect(camera.position.y).toBeCloseTo(80, 10);
    expect(camera.position.z).toBeCloseTo(-120, 10);
    expect(controls.target.x).toBeCloseTo(0, 10);
    expect(controls.target.y).toBeCloseTo(80, 10);
    expect(controls.target.z).toBeCloseTo(0, 10);
  });

  it("内容根节点有偏移时，相机位置相对 center 计算", () => {
    const { camera, controls } = makeCtx();
    const root = makeModelRoot(16, 16, 16);
    root.scale.set(1 / 16, 1 / 16, 1 / 16);
    root.position.set(10, 5, 0); // 偏移

    fitCameraToScene(root, camera, controls);

    // center = (10, 5, 0)，maxDim = 1，dist = 1 * 1.5 + 2 = 3.5
    // camera position = (10, 5, 0 - 3.5) = (10, 5, -3.5)
    expect(camera.position.x).toBeCloseTo(10, 1);
    expect(camera.position.y).toBeCloseTo(5, 1);
    expect(camera.position.z).toBeCloseTo(-3.5, 1);
    expect(controls.target.x).toBeCloseTo(10, 1);
    expect(controls.target.y).toBeCloseTo(5, 1);
  });

  it("回归：取景后按包围盒收紧 near/far（far ≈ maxDim*50，near=0.05）", () => {
    const { camera, controls } = makeCtx();
    // 故意污染 near/far，模拟共享单例相机被上一类资源留下的残留值
    camera.near = 1;
    camera.far = 12345;
    const root = makeModelRoot(16, 32, 16); // raw 16×32×16
    root.scale.set(1 / 16, 1 / 16, 1 / 16); // 缩放后 1×2×1，maxDim=2

    fitCameraToScene(root, camera, controls);

    // 必须被包围盒标定覆盖：near=0.05、far=maxDim*50=100
    expect(camera.near).toBeCloseTo(0.05, 5);
    expect(camera.far).toBeCloseTo(2 * 50, 5);
  });

  it("回归：空内容根节点 fallback 不污染 near/far（保留既有值）", () => {
    const { camera, controls } = makeCtx();
    const origNear = camera.near;
    const origFar = camera.far;
    fitCameraToScene(null, camera, controls);
    expect(camera.near).toBe(origNear);
    expect(camera.far).toBe(origFar);
  });
});

describe("fitCameraToRoots", () => {
  it("多根节点 → 并集包围盒适配相机", () => {
    const { camera, controls } = makeCtx();
    const rootA = makeModelRoot(16, 16, 16);
    rootA.scale.set(1 / 16, 1 / 16, 1 / 16);
    rootA.position.set(-5, 0, 0); // 左边

    const rootB = makeModelRoot(16, 16, 16);
    rootB.scale.set(1 / 16, 1 / 16, 1 / 16);
    rootB.position.set(5, 0, 0); // 右边

    fitCameraToRoots([rootA, rootB], camera, controls);

    // 并集：width=11 (从-5.5到5.5)，height=1，depth=1
    // center = (0, 0, 0)，maxDim=11，dist = 11 * 1.5 + 2 = 18.5
    const expectedDist = 18.5;
    expect(camera.position.z).toBeCloseTo(-expectedDist, 1);
    expect(controls.target).toEqual(new THREE.Vector3(0, 0, 0));
  });

  it("空 roots 数组 → fallback 到 (0, 80, -120)", () => {
    const { camera, controls } = makeCtx();
    fitCameraToRoots([], camera, controls);
    expect(camera.position.x).toBeCloseTo(0, 10);
    expect(camera.position.y).toBeCloseTo(80, 10);
    expect(camera.position.z).toBeCloseTo(-120, 10);
    expect(controls.target.x).toBeCloseTo(0, 10);
    expect(controls.target.y).toBeCloseTo(80, 10);
    expect(controls.target.z).toBeCloseTo(0, 10);
  });

  it("roots 含不可见节点 → 仍然计入包围盒（调用方负责过滤）", () => {
    const { camera, controls } = makeCtx();
    const root = makeModelRoot(16, 16, 16);
    root.scale.set(1 / 16, 1 / 16, 1 / 16);
    root.visible = false; // 不可见

    fitCameraToRoots([root], camera, controls);

    // 即使 visible=false，setFromObject 仍然计入（这是设计决策：调用方应自己过滤）
    const expectedDist = 3.5; // maxDim=1, dist = 1 * 1.5 + 2
    expect(camera.position.z).toBeCloseTo(-expectedDist, 1);
  });

  it("回归：多根并集同样收紧 far ≈ 并集 maxDim*50", () => {
    const { camera, controls } = makeCtx();
    camera.far = 9999; // 模拟残留
    const rootA = makeModelRoot(16, 16, 16);
    rootA.scale.set(1 / 16, 1 / 16, 1 / 16);
    rootA.position.set(-5, 0, 0);
    const rootB = makeModelRoot(16, 16, 16);
    rootB.scale.set(1 / 16, 1 / 16, 1 / 16);
    rootB.position.set(5, 0, 0);

    fitCameraToRoots([rootA, rootB], camera, controls);

    // 并集 width=11（从 -5.5 到 5.5），maxDim=11，far=550
    expect(camera.far).toBeCloseTo(11 * 50, 5);
    expect(camera.near).toBeCloseTo(0.05, 5);
  });
});

describe("一致性检查", () => {
  it("fitCameraToScene([root]) 与 fitCameraToRoots([root]) 结果一致", () => {
    const root = makeModelRoot(16, 32, 16);
    root.scale.set(1 / 16, 1 / 16, 1 / 16);

    const ctx1 = makeCtx();
    fitCameraToScene(root, ctx1.camera, ctx1.controls);

    const ctx2 = makeCtx();
    fitCameraToRoots([root], ctx2.camera, ctx2.controls);

    expect(ctx1.camera.position).toEqual(ctx2.camera.position);
    expect(ctx1.controls.target).toEqual(ctx2.controls.target);
  });
});
