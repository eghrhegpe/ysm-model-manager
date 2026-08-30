// ===== WireframeCapability 单元测试 =====
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { WireframeCapability } from "./wireframe-capability.ts";

// mock localStorage（persistState / restoreState 依赖）
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
});

function makeScene(meshCount = 3): { scene: THREE.Scene; meshes: THREE.Mesh[] } {
  const scene = new THREE.Scene();
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < meshCount; i++) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ wireframe: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `mesh-${i}`;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return { scene, meshes };
}

function getWireframe(meshes: THREE.Mesh[]): boolean[] {
  return meshes.map((m) => {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return (mat as THREE.MeshBasicMaterial).wireframe;
  });
}

describe("WireframeCapability", () => {
  let cap: WireframeCapability;

  beforeEach(() => {
    store.clear();
  });

  it("初始状态 off", () => {
    const { scene } = makeScene();
    cap = new WireframeCapability({ scene });
    expect(cap.isEnabled()).toBe(false);
  });

  it("setEnabled(true) → 所有 mesh wireframe=true", () => {
    const { scene, meshes } = makeScene(3);
    cap = new WireframeCapability({ scene });
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    expect(getWireframe(meshes)).toEqual([true, true, true]);
  });

  it("setEnabled(false) → 还原原始 wireframe（false）", () => {
    const { scene, meshes } = makeScene(2);
    cap = new WireframeCapability({ scene });
    cap.setEnabled(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
    expect(getWireframe(meshes)).toEqual([false, false]);
  });

  it("部分原始 wireframe=true 时：关闭后还原各自的原始值", () => {
    const { scene, meshes } = makeScene(3);
    // mesh-1 原本就是 wireframe=true
    const mat1 = meshes[1].material as THREE.MeshBasicMaterial;
    mat1.wireframe = true;

    cap = new WireframeCapability({ scene });
    cap.setEnabled(true); // 全部变 true
    expect(getWireframe(meshes)).toEqual([true, true, true]);

    cap.setEnabled(false); // 还原
    expect(getWireframe(meshes)).toEqual([false, true, false]);
  });

  it("含数组材质的 mesh 也能正确切换", () => {
    const scene = new THREE.Scene();
    const matA = new THREE.MeshBasicMaterial({ wireframe: false });
    const matB = new THREE.MeshBasicMaterial({ wireframe: false });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [matA, matB]);
    scene.add(mesh);

    cap = new WireframeCapability({ scene });
    cap.setEnabled(true);
    expect(matA.wireframe).toBe(true);
    expect(matB.wireframe).toBe(true);

    cap.setEnabled(false);
    expect(matA.wireframe).toBe(false);
    expect(matB.wireframe).toBe(false);
  });

  it("dispose 时自动还原", () => {
    const { scene, meshes } = makeScene(2);
    cap = new WireframeCapability({ scene });
    cap.setEnabled(true);
    cap.dispose();
    expect(getWireframe(meshes)).toEqual([false, false]);
    expect(cap.isEnabled()).toBe(false);
  });

  it("多次 toggle 不累积", () => {
    const { scene, meshes } = makeScene(2);
    cap = new WireframeCapability({ scene });
    cap.setEnabled(true);
    cap.setEnabled(true); // 幂等
    cap.setEnabled(false);
    cap.setEnabled(false); // 幂等
    expect(getWireframe(meshes)).toEqual([false, false]);
  });

  it("getMenuControls 返回 toggle 控件", () => {
    const { scene } = makeScene();
    cap = new WireframeCapability({ scene });
    const controls = cap.getMenuControls();
    expect(controls).toHaveLength(1);
    expect(controls[0].id).toBe("wireframe-toggle");
    expect(controls[0].kind).toBe("toggle");
    expect(controls[0].getValue()).toBe(false);
  });

  it("持久化 save/load", () => {
    const { scene } = makeScene();
    cap = new WireframeCapability({ scene });
    cap.setEnabled(true);
    cap.saveState();

    // 新实例恢复
    const cap2 = new WireframeCapability({ scene });
    expect(cap2.isEnabled()).toBe(false);
    cap2.loadState();
    expect(cap2.isEnabled()).toBe(true);
  });

  it("空场景不报错", () => {
    const scene = new THREE.Scene();
    cap = new WireframeCapability({ scene });
    cap.setEnabled(true);
    expect(cap.isEnabled()).toBe(true);
    cap.setEnabled(false);
    expect(cap.isEnabled()).toBe(false);
  });
});
