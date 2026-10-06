// @vitest-environment happy-dom
// ===== infra/wasd-camera —— 每帧相机运动纯函数不变量 =====
// 覆盖：位移标度（camSpeed×dt）、方向基（前进沿视线水平投影 / 右=前进×上）、
// 归一化（对角不叠加 √2 超速、相反方向互相抵消）、orbit 与 free 两模式的焦点语义
// 差异（orbit = 焦点跟随位移；free = 焦点取相机前方 10 单位）、reuse 槽位不得残留上一帧。
// three 用真实实现（Vector3/PerspectiveCamera），OrbitControls 仅用 {target, update} 桩。
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TdKeyAction } from "./keymap.ts";
import { applyWasdCameraMotion, type WasdReuse } from "./wasd-camera.ts";

interface Rig {
  cam: THREE.PerspectiveCamera;
  ctr: { target: THREE.Vector3; update: ReturnType<typeof vi.fn> };
  ot: THREE.Vector3;
  reuse: WasdReuse;
}

function makeRig(): Rig {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  cam.position.set(0, 0, 0);
  cam.updateMatrixWorld(true);
  const target = new THREE.Vector3();
  const update = vi.fn();
  return {
    cam,
    ctr: { target, update },
    ot: new THREE.Vector3(),
    reuse: {
      camDir: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      move: new THREE.Vector3(),
    },
  };
}

function step(
  rig: Rig,
  keys: Partial<Record<TdKeyAction, boolean>>,
  opts: { speed?: number; dt?: number; orbit?: boolean } = {},
): void {
  applyWasdCameraMotion(
    keys,
    rig.cam,
    rig.ctr as unknown as OrbitControls,
    opts.speed ?? 2,
    opts.dt ?? 0.5,
    opts.orbit ?? false,
    rig.ot,
    rig.reuse,
  );
}

describe("applyWasdCameraMotion —— 位移与标度", () => {
  it("无按键：不位移，但每帧仍同步焦点并 update（提前 return 会让焦点停摆）", () => {
    const rig = makeRig();
    step(rig, {});
    expect(rig.cam.position.toArray()).toEqual([0, 0, 0]);
    expect(rig.ot.toArray()).toEqual([0, 0, 0]);
    // free 模式焦点 = 相机前方 10 单位
    expect(rig.ctr.target.toArray()).toEqual([0, 0, -10]);
    expect(rig.ctr.update).toHaveBeenCalledTimes(1);
  });

  it("前进位移严格等于 camSpeed×dt（沿视线水平投影）", () => {
    const rig = makeRig();
    step(rig, { forward: true }, { speed: 2, dt: 0.5 }); // 标量 1
    expect(rig.cam.position.toArray()).toEqual([0, 0, -1]);
    // free 模式焦点取**移动后**相机位置 + 前方 10
    expect(rig.ctr.target.toArray()).toEqual([0, 0, -11]);
    expect(rig.ot.toArray()).toEqual([0, 0, 0]); // free 模式不动 ot
  });

  it("后退/左/右符号正确（视线 -Z 时：前进 -Z、右 +X、左 -X）", () => {
    const cases: Array<[Partial<Record<TdKeyAction, boolean>>, number[]]> = [
      [{ back: true }, [0, 0, 1]],
      [{ right: true }, [1, 0, 0]],
      [{ left: true }, [-1, 0, 0]],
    ];
    for (const [keys, expected] of cases) {
      const rig = makeRig();
      step(rig, keys, { speed: 2, dt: 0.5 });
      expect(rig.cam.position.toArray()).toEqual(expected);
    }
  });

  it("俯仰视线被削平：相机下俯 45° 时前进仍不产生竖直漂移，水平位移为 camSpeed×dt", () => {
    const rig = makeRig();
    rig.cam.rotation.set(-Math.PI / 4, 0, 0);
    rig.cam.updateMatrixWorld(true);
    const dir = rig.cam.getWorldDirection(new THREE.Vector3());
    expect(Math.abs(dir.y)).toBeGreaterThan(0.5); // 前置：视线确实带俯仰

    step(rig, { forward: true }, { speed: 2, dt: 0.5 });
    expect(rig.cam.position.y).toBe(0);
    expect(Math.hypot(rig.cam.position.x, rig.cam.position.z)).toBeCloseTo(1, 10);
  });

  it("对角（前进+右）与单键同速：归一化消除 √2 超速", () => {
    const single = makeRig();
    step(single, { forward: true }, { speed: 2, dt: 0.5 });
    const diagonal = makeRig();
    step(diagonal, { forward: true, right: true }, { speed: 2, dt: 0.5 });

    const d1 = single.cam.position.length();
    const d2 = diagonal.cam.position.length();
    expect(d2).toBeCloseTo(d1, 10);
    // 对角确实在两个分量上都有位移（不是退化成一维）
    expect(Math.abs(diagonal.cam.position.x)).toBeGreaterThan(0.1);
    expect(Math.abs(diagonal.cam.position.z)).toBeGreaterThan(0.1);
  });

  it("相反方向同按互相抵消（六向全按 → 零位移，但焦点同步仍执行）", () => {
    const rig = makeRig();
    step(rig, { forward: true, back: true, left: true, right: true, up: true, down: true });
    expect(rig.cam.position.toArray()).toEqual([0, 0, 0]);
    expect(rig.ctr.update).toHaveBeenCalledTimes(1);
  });

  it("竖直：up 只改 y；up+down 抵消", () => {
    const up = makeRig();
    step(up, { up: true }, { speed: 2, dt: 0.5 });
    expect(up.cam.position.toArray()).toEqual([0, 1, 0]);

    const both = makeRig();
    step(both, { up: true, down: true }, { speed: 2, dt: 0.5 });
    expect(both.cam.position.toArray()).toEqual([0, 0, 0]);
  });
});

describe("applyWasdCameraMotion —— 焦点语义（orbit / free）", () => {
  it("orbit：焦点跟随位移（ot 与相机同步平移），target 与 ot 一致", () => {
    const rig = makeRig();
    rig.ot.set(5, 5, 5);
    step(rig, { forward: true }, { speed: 2, dt: 0.5, orbit: true });
    expect(rig.cam.position.toArray()).toEqual([0, 0, -1]);
    expect(rig.ot.toArray()).toEqual([5, 5, 4]);
    expect(rig.ctr.target.toArray()).toEqual([5, 5, 4]);
    expect(rig.ctr.update).toHaveBeenCalledTimes(1);
  });

  it("orbit 无按键：ot 不动但仍每帧回写 update（阻尼/惯性更新不被跳过）", () => {
    const rig = makeRig();
    rig.ot.set(1, 2, 3);
    step(rig, {}, { orbit: true });
    expect(rig.ot.toArray()).toEqual([1, 2, 3]);
    expect(rig.ctr.target.toArray()).toEqual([1, 2, 3]);
    expect(rig.ctr.update).toHaveBeenCalledTimes(1);
  });

  it("free：ot 不被触碰，焦点取相机前方 10 单位的视线方向（非水平化）", () => {
    const rig = makeRig();
    rig.cam.rotation.set(-Math.PI / 4, 0, 0);
    rig.cam.updateMatrixWorld(true);
    rig.ot.set(9, 9, 9);
    step(rig, {}, { orbit: false });
    expect(rig.ot.toArray()).toEqual([9, 9, 9]);
    // 焦点 = 相机位置 + 世界视线方向×10（带俯仰分量）
    const expected = rig.cam.position.clone().addScaledVector(
      rig.cam.getWorldDirection(new THREE.Vector3()),
      10,
    );
    expect(rig.ctr.target.toArray()).toEqual(expected.toArray());
    expect(Math.abs(rig.ctr.target.y)).toBeGreaterThan(1); // 确实带俯仰（未削平）
  });
});

describe("applyWasdCameraMotion —— reuse 槽位", () => {
  it("上一帧的移动向量不残留：W 一帧后空键一帧不再位移", () => {
    const rig = makeRig();
    step(rig, { forward: true }, { speed: 2, dt: 0.5 });
    const after = rig.cam.position.clone();
    expect(after.length()).toBeGreaterThan(0);
    step(rig, {}, { speed: 2, dt: 0.5 });
    expect(rig.cam.position.toArray()).toEqual(after.toArray());
  });

  it("reuse 槽位每帧被覆写（不因复用而累积）：同键连按两帧位移线性叠加", () => {
    const rig = makeRig();
    step(rig, { forward: true }, { speed: 2, dt: 0.5 });
    step(rig, { forward: true }, { speed: 2, dt: 0.5 });
    expect(rig.cam.position.toArray()).toEqual([0, 0, -2]); // 1 + 1，不是 2 帧共用一份
  });
});
