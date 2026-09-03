// @vitest-environment node
// ===== 感知层：注视追踪 测试（gaze.ts）=====
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createGazeController } from "./gaze.ts";
import { type SemanticBoneMap } from "../semantic-bones.ts";

function fakeMap(entries: Record<string, THREE.Object3D>): SemanticBoneMap {
  const map: SemanticBoneMap = {};
  for (const [id, obj] of Object.entries(entries)) {
    map[id as keyof SemanticBoneMap] = { id, object: obj };
  }
  return map;
}

describe("createGazeController", () => {
  it("head 存在时应用偏移（位置不变，旋转变化）", () => {
    const head = new THREE.Object3D();
    head.position.set(0, 1.5, 0);
    head.rotation.set(0, 0, 0);
    const map = fakeMap({ head });
    const ctrl = createGazeController();
    const camPos = new THREE.Vector3(1, 1.6, 5); // 相机在前方偏右
    ctrl.apply(0.016, map, camPos);
    // 旋转应有变化（从 0 偏转向相机）
    expect(Math.abs(head.rotation.y)).toBeGreaterThan(0.001);
  });

  it("无 head 骨时静默降级（不抛错，eyes 也不驱动）", () => {
    const lEye = new THREE.Object3D();
    const map = fakeMap({ leftEye: lEye }); // 只有 eye，没 head
    const ctrl = createGazeController();
    expect(() => ctrl.apply(0.016, map, new THREE.Vector3(0, 0, 10))).not.toThrow();
    // eye 不应被驱动（无 head 兜底）
    expect(lEye.rotation.y).toBeCloseTo(0, 6);
  });

  it("空 map 不抛错", () => {
    const ctrl = createGazeController();
    expect(() => ctrl.apply(0.016, {}, new THREE.Vector3())).not.toThrow();
  });

  it("reset 清除 snap 状态（切换模型后可重新 warmup）", () => {
    const head = new THREE.Object3D();
    head.rotation.set(0.1, 0.2, 0);
    const map = fakeMap({ head });
    const ctrl = createGazeController();
    ctrl.apply(0, map, new THREE.Vector3(0, 0, 10));
    ctrl.reset();
    expect(() => ctrl.apply(0, map, new THREE.Vector3(0, 0, 10))).not.toThrow();
  });

  it("相机在正前方 → head 不偏（yaw≈0, pitch≈0）", () => {
    const head = new THREE.Object3D();
    head.position.set(0, 1, 0);
    const map = fakeMap({ head });
    const ctrl = createGazeController();
    const camPos = new THREE.Vector3(0, 1, 10); // 正前方
    ctrl.apply(0, map, camPos);
    expect(head.rotation.y).toBeCloseTo(0, 4);
    expect(head.rotation.x).toBeCloseTo(0, 4);
  });

  it("相机在左前方 → head 向左转（yaw < 0）", () => {
    const head = new THREE.Object3D();
    head.position.set(0, 1, 0);
    const map = fakeMap({ head });
    const ctrl = createGazeController();
    const camPos = new THREE.Vector3(-3, 1, 5); // 左前方
    ctrl.apply(0, map, camPos);
    expect(head.rotation.y).toBeLessThan(0);
  });
});
