// @vitest-environment node
// ===== 感知层：AutoDance 测试（autodance.ts）=====
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBoneTree } from "../bone-tools.ts";
import { createAutoDanceController } from "./autodance.ts";
import { type SemanticBoneMap } from "../semantic-bones.ts";

function fakeMap(entries: Record<string, THREE.Object3D>): SemanticBoneMap {
  const map: SemanticBoneMap = {};
  for (const [id, obj] of Object.entries(entries)) {
    map[id as keyof SemanticBoneMap] = { id, object: obj };
  }
  return map;
}

describe("createAutoDanceController", () => {
  it("初始不抛错（warmup 延迟到首次 apply）", () => {
    const ctrl = createAutoDanceController({ bpm: 120, intensity: 0.5 });
    expect(() => ctrl.apply(0.016, {})).not.toThrow();
    ctrl.dispose();
  });

  it("有 hips 骨时产生旋转变化", () => {
    const hips = new THREE.Object3D();
    hips.rotation.set(0, 0, 0);
    const map = fakeMap({ hips });
    const ctrl = createAutoDanceController({ bpm: 120, intensity: 0.8 });
    ctrl.apply(0.016, map);
    // 第一轮后 rotation 应有变化
    expect(Math.abs(hips.rotation.y)).toBeGreaterThan(0.001);
  });

  it("空 map 不抛错", () => {
    const ctrl = createAutoDanceController();
    expect(() => ctrl.apply(0.016, {})).not.toThrow();
    ctrl.dispose();
  });

  it("disabled 时不驱动", () => {
    const hips = new THREE.Object3D();
    const map = fakeMap({ hips });
    const ctrl = createAutoDanceController({ enabled: false });
    ctrl.apply(0.016, map);
    expect(hips.rotation.y).toBeCloseTo(0, 6);
    ctrl.dispose();
  });

  it("dispose 后不再驱动", () => {
    const hips = new THREE.Object3D();
    const map = fakeMap({ hips });
    const ctrl = createAutoDanceController();
    ctrl.apply(0.016, map);
    const before = hips.rotation.y;
    ctrl.dispose();
    ctrl.apply(0.016, map);
    // dispose 后状态清零，不应继续变化
    expect(hips.rotation.y).toBeCloseTo(before, 6);
  });

  it("intensity=0 时不驱动", () => {
    const hips = new THREE.Object3D();
    const map = fakeMap({ hips });
    const ctrl = createAutoDanceController({ intensity: 0 });
    ctrl.apply(0.016, map);
    expect(hips.rotation.y).toBeCloseTo(0, 6);
    ctrl.dispose();
  });

  it("静止姿态非恒等时摇摆落在骨骼局部轴（P2 乘序回归护栏）", () => {
    // 回归场景：hips 初始绕 X 旋转 45°（静止姿态非恒等）。
    // 乘序反时（dance*rest）摇摆作用于父空间轴——局部 Y 混入 X 分量、偏离 21°；
    // 正确（rest*dance）摇摆落在局部轴——局部 Y 保持 X=0 且长度不变。
    const hips = new THREE.Object3D();
    hips.quaternion.setFromEuler(new THREE.Euler(0.785, 0, 0, "XYZ")); // Rx(45°)
    const restLocalY = new THREE.Vector3(0, 1, 0).clone().applyQuaternion(hips.quaternion.clone());
    const map = fakeMap({ hips });
    const ctrl = createAutoDanceController({ bpm: 120, intensity: 0.8 });

    ctrl.apply(0.05, map); // 驱动一轮
    const drivenLocalY = new THREE.Vector3(0, 1, 0).clone().applyQuaternion(hips.quaternion.clone());

    // 局部 Y 轴不应混入 X 分量（父空间轴摇摆的指纹是 X 分量非零）
    expect(Math.abs(drivenLocalY.x)).toBeLessThan(1e-6);
    // 长度保持 1（纯旋转不缩放）
    expect(drivenLocalY.length()).toBeCloseTo(1, 6);
    // 与静止姿态的局部 Y 同向（摇摆绕自身轴，不把轴带偏）
    expect(drivenLocalY.angleTo(restLocalY)).toBeLessThan(1e-6);
    ctrl.dispose();
  });
});
