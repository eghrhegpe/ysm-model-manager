// @vitest-environment node
// ===== 感知层：呼吸 测试（breath.ts）=====
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createBreathController } from "./breath.ts";
import { type SemanticBoneMap } from "../semantic-bones.ts";

/** 构造带 object 引用的语义骨骼 map（用于真实应用测试） */
function fakeSemanticMap(entries: Record<string, THREE.Object3D>): SemanticBoneMap {
  const map: SemanticBoneMap = {};
  for (const [id, obj] of Object.entries(entries)) {
    map[id as keyof SemanticBoneMap] = { id, object: obj };
  }
  return map;
}

describe("createBreathController", () => {
  it("warmup 后 resting 快照覆盖所有命中的语义骨骼", () => {
    const chest = new THREE.Object3D();
    chest.position.set(0, 1, 0);
    const spine = new THREE.Object3D();
    spine.position.set(0, 0.5, 0);
    const map = fakeSemanticMap({ chest, spine });
    const ctrl = createBreathController();
    ctrl.apply(0, map); // 触发 warmup
    // 第一次 apply 后位置仍应等于 resting（t=0 时 breathe=0）
    expect(chest.position.y).toBeCloseTo(1, 6);
    expect(spine.position.y).toBeCloseTo(0.5, 6);
  });

  it("推进时间后胸骨位置随 breathe 升高（非零偏移）", () => {
    const chest = new THREE.Object3D();
    chest.position.set(0, 1, 0);
    const map = fakeSemanticMap({ chest });
    const ctrl = createBreathController();
    ctrl.apply(0.016, map); // t 推进 0.016/2.5 ≈ 0.0064 cycle
    // breathe = sin(t*2π) 的绝对值，t≈0.0064 时 sin>0，绝对值仍 >0
    expect(chest.position.y).toBeGreaterThan(1);
  });

  it("完整一个周期后位置回归 resting（breathe 闭合）", () => {
    const chest = new THREE.Object3D();
    chest.position.set(0, 1, 0);
    const map = fakeSemanticMap({ chest });
    const ctrl = createBreathController();
    // 推满 1 cycle（BREATH_CYCLE_S 秒，假设 60fps）
    const frames = Math.round(60 * 2.5); // 150 frames
    for (let i = 0; i < frames; i++) {
      ctrl.apply(1 / 60, map);
    }
    // 完成整周期，breathe = |sin(2π)| = 0
    expect(chest.position.y).toBeCloseTo(1, 6);
  });

  it("语义骨骼缺失时静默降级（不抛错）", () => {
    const map: SemanticBoneMap = {}; // 空 map
    const ctrl = createBreathController();
    expect(() => ctrl.apply(0.016, map)).not.toThrow();
  });

  it("reset 清除 resting 快照（切换模型后下次 apply 重新 warmup）", () => {
    const chest = new THREE.Object3D();
    chest.position.set(0, 1, 0);
    const map = fakeSemanticMap({ chest });
    const ctrl = createBreathController();
    ctrl.apply(0, map);
    ctrl.reset();
    // reset 后再次 apply 应重新 warmup（位置不变）
    ctrl.apply(0, map);
    expect(chest.position.y).toBeCloseTo(1, 6);
  });

  it("shoulders 权重低于 chest（同相位下位移更小）", () => {
    const chest = new THREE.Object3D();
    chest.position.set(0, 1, 0);
    const lShoulder = new THREE.Object3D();
    lShoulder.position.set(-0.5, 1.1, 0);
    const map = fakeSemanticMap({ chest, leftShoulder: lShoulder });
    const ctrl = createBreathController();
    // 推到 breathe 峰值附近（t ≈ 0.25 cycle）
    ctrl.apply(0.625, map); // 0.625/2.5 = 0.25 cycle → sin(π/2)=1, breathe=1
    const chestY = chest.position.y;
    const shoulderY = lShoulder.position.y;
    // chest 权重 1.0，shoulder 权重 0.3 → chest 移动 > shoulder 移动
    expect(chestY - 1).toBeGreaterThan((shoulderY - 1.1) * 1.001);
  });
});
