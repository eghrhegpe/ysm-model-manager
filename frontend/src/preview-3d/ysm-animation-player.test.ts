import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createYsmAnimPlayer, type YsmAnimPlayer } from "./ysm-animation-player.ts";
import type { AnimationClip } from "../utils/animation/animation.ts";
import type { BoneHierarchyNode } from "../utils/animation/animation.ts";
import { compileMolang } from "../utils/animation/molang.ts";
import type { AnimationController } from "../utils/animation/animation-controller.ts";

function makeClip(length = 2.0, boneName = "root"): AnimationClip {
  return {
    name: "test",
    loop: true,
    length,
    bones: {
      [boneName]: {
        position: [
          { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
          { time: 1, post: [1, 0, 0], pre: [0, 0, 0], lerp: "linear" },
          { time: 2, post: [0, 0, 0], pre: [1, 0, 0], lerp: "linear" },
        ],
      },
    },
  };
}

const H: BoneHierarchyNode[] = [{ name: "root" }];

function makeBone(name: string): THREE.Object3D {
  const b = new THREE.Object3D();
  b.name = name;
  return b;
}

describe("createYsmAnimPlayer", () => {
  it("apply 后骨骼变换被更新", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [makeClip(2)], H, ["run"]);
    player.apply(1.0);
    expect(bone.position.x).toBeCloseTo(-1.0, 5); // 游戏内口径：动画位移 X 取负叠加（base 0 - tx 1）
  });

  it("toggle/isPlaying 状态切换", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [makeClip(2)], H, ["run"]);
    expect(player.isPlaying()).toBe(true);
    player.toggle();
    expect(player.isPlaying()).toBe(false);
    const startX = bone.position.x;
    player.apply(0.5);
    expect(bone.position.x).toBeCloseTo(startX, 5);
  });

  it("loop 动画超过 clip.length 后取模", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [makeClip(2)], H, ["run"]);
    player.apply(3.0);
    expect(bone.position.x).toBeCloseTo(-1.0, 5); // 3%2=1 → X 取负（游戏内口径）
  });

  it("非 loop 动画超过 clip.length 后暂停在末帧", () => {
    const bone = makeBone("root");
    const clip = { ...makeClip(2), loop: false };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clip], H, ["run"]);
    player.apply(3.0);
    expect(bone.position.x).toBeCloseTo(0.0, 5);
    expect(player.isPlaying()).toBe(false);
  });

  it("骨骼名不匹配静默跳过不抛错", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["head", bone]]), [makeClip(2)], H, ["run"]);
    expect(() => player.apply(1.0)).not.toThrow();
    expect(bone.position.x).toBe(0);
  });

  it("dispose 后重置状态", () => {
    const bone = makeBone("root");
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [makeClip(2)], H, ["run"]);
    player.apply(1.5);
    player.dispose();
    expect(player.getTime()).toBe(0);
    expect(player.isPlaying()).toBe(true);
  });

  // ---- L2 多 clip ----
  it("clipCount 返回正确数量", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1), makeClip(2), makeClip(3)], H, ["idle", "run", "attack"]);
    expect(player.clipCount()).toBe(3);
  });

  it("clips() 返回正确标签列表", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1), makeClip(2)], H, ["idle", "run"]);
    expect(player.clips()).toEqual([{ label: "idle" }, { label: "run" }]);
  });

  it("selectClip 切换后 time 重置", () => {
    const bone = makeBone("root");
    const clip1 = makeClip(2);
    const clip2: AnimationClip = {
      name: "jump", loop: false, length: 2,
      bones: {
        root: {
          position: [
            { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
            { time: 1, post: [0, 1, 0], pre: [0, 0, 0], lerp: "linear" },
          ],
        },
      },
    };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clip1, clip2], H, ["idle", "jump"]);
    player.selectClip(1);
    expect(player.currentIndex()).toBe(1);
    expect(player.getTime()).toBe(0);
    player.apply(1.0);
    expect(bone.position.y).toBeCloseTo(1.0, 5);
  });

  it("selectClip 越界静默忽略", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1)], H, ["idle"]);
    player.selectClip(99);
    expect(player.currentIndex()).toBe(0);
    player.selectClip(-1);
    expect(player.currentIndex()).toBe(0);
  });

  it("自定义 clipLabels 可选", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1)], H, ["custom"]);
    expect(player.clips()[0].label).toBe("custom");
  });

  it("缺省 clipLabels 自动生成", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(1), makeClip(2)], H);
    expect(player.clips()[0].label).toBe("Clip 0");
    expect(player.clips()[1].label).toBe("Clip 1");
  });

  it("isAnimActive 播放中返回 true，暂停返回 false", () => {
    const player = createYsmAnimPlayer(new Map(), [makeClip(2)], H, ["run"]);
    expect(player.isAnimActive()).toBe(true);
    player.toggle();
    expect(player.isAnimActive()).toBe(false);
  });

  // ---- P0-1 slerp 插值正确性 ----
  it("slerp: 旋转从 rest 平滑过渡到 target，而非直接跳到 target", () => {
    const bone = makeBone("root");
    // 初始姿态：绕 Y 轴 0°
    // 目标姿态：绕 Y 轴 90°（PI/2）
    const clip: AnimationClip = {
      name: "rotate",
      loop: true,
      length: 2,
      bones: {
        root: {
          rotation: [
            { time: 0, post: [0, Math.PI / 2, 0], pre: [0, 0, 0], lerp: "linear" },
            { time: 2, post: [0, Math.PI / 2, 0], pre: [0, Math.PI / 2, 0], lerp: "linear" },
          ],
        },
      },
    };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clip], H, ["rotate"]);

    // 初始四元数应为 identity
    const initialY = bone.quaternion.y;
    expect(initialY).toBeCloseTo(0, 5);

    // 首次 apply 采集 rest（alpha=0），第二次 apply 才开始插值
    player.apply(0); // 采集 rest
    player.apply(0.016); // alpha = 0.08，slerp 一小段
    const qy1 = bone.quaternion.y;
    // alpha=0.08 时，Y 轴旋转约 7.2°，quaternion y = sin(3.6°) ≈ 0.063
    expect(qy1).toBeGreaterThan(0);
    expect(qy1).toBeLessThan(0.3); // 远未达到 sin(PI/4)=0.707

    // 继续 apply，骨骼应缓慢逼近目标
    for (let i = 0; i < 20; i++) player.apply(0.05);
    const qy2 = bone.quaternion.y;
    // 经过约 1s，alpha ≈ 1.0，应该已经比较接近目标（sin(PI/4)=0.707）
    expect(qy2).toBeGreaterThan(0.5);

    // 足够长时间后，应收敛到目标四元数
    for (let i = 0; i < 100; i++) player.apply(0.1);// 最终姿态应非常接近目标
    const finalQ = bone.quaternion;
    const targetQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0, "ZYX"));
    // 最终姿态应非常接近目标（ZYX 欧拉序：与 Blockbench bedrock.js L648-882 对齐）
    expect(finalQ.angleTo(targetQ)).toBeLessThan(0.1);
  });

  it("slerp: dispose 后重新 apply 从当前姿态重新开始插值", () => {
    const bone = makeBone("root");
    const clip: AnimationClip = {
      name: "rotate",
      loop: true,
      length: 2,
      bones: {
        root: {
          rotation: [
            { time: 0, post: [0, Math.PI / 2, 0], pre: [0, 0, 0], lerp: "linear" },
            { time: 2, post: [0, Math.PI / 2, 0], pre: [0, Math.PI / 2, 0], lerp: "linear" },
          ],
        },
      },
    };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clip], H, ["rotate"]);

    // 先 apply 少量步，让骨骼到达中间姿态（alpha < 1）
    player.apply(0); // 采集 rest (identity)
    for (let i = 0; i < 3; i++) player.apply(0.05); // alpha ≈ 0.75
    const midY = bone.quaternion.y;
    expect(midY).toBeGreaterThan(0);
    expect(midY).toBeLessThan(0.707); // 未到达 target

    // dispose 重置
    player.dispose();

    // dispose 后，rest 和 alpha 都清空了
    // 新的 apply(0) 采集当前姿态为新 rest
    player.apply(0);
    const yAfterReset = bone.quaternion.y;
    // 采集 rest 时不改变姿态
    expect(yAfterReset).toBeCloseTo(midY, 5);

    // 再 apply 一小步，alpha 从 0 开始增加，骨骼继续向 target 旋转
    player.apply(0.05);
    const yAfterStep = bone.quaternion.y;
    // 应该继续向 target 方向旋转（y 增大）
    expect(yAfterStep).toBeGreaterThan(yAfterReset);
  });

  // ---- L3 切 clip 平滑过渡（三通道统一淡入，ADR-100 遗留）----

  /** 常量 position clip 工厂（全程锁定 pos） */
  function makeConstPosClip(name: string, boneName: string, pos: [number, number, number], length = 1): AnimationClip {
    return {
      name,
      loop: true,
      length,
      bones: {
        [boneName]: {
          position: [
            { time: 0, post: pos, pre: pos, lerp: "linear" },
            { time: length, post: pos, pre: pos, lerp: "linear" },
          ],
        },
      },
    };
  }

  it("L3: 切 clip 后 position 通道从当前姿态平滑淡入，而非瞬跳", () => {
    const bone = makeBone("root");
    const clipA = makeConstPosClip("a", "root", [1, 0, 0]);
    const clipB = makeConstPosClip("b", "root", [5, 0, 0]);
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clipA, clipB], H, ["a", "b"]);

    for (let i = 0; i < 10; i++) player.apply(0.05);
    expect(bone.position.x).toBeCloseTo(-1.0, 5); // clipA pos=[1,0,0] → base 0 - 1（X 取负）

    player.selectClip(1);
    player.apply(0.02); // 一小步：应停在 -1→-5 途中
    expect(bone.position.x).toBeLessThan(-1.0);
    expect(bone.position.x).toBeGreaterThan(-5.0);

    for (let i = 0; i < 30; i++) player.apply(0.05);
    expect(bone.position.x).toBeCloseTo(-5.0, 4); // 最终收敛到 clipB（0-5）
  });

  it("L3: 新 clip 未触及的骨骼渐回 base 姿态，而非钉在旧姿态", () => {
    const root = makeBone("root");
    const arm = makeBone("arm");
    const clipA = makeConstPosClip("a", "arm", [2, 0, 0]); // 动画 arm
    const clipB = makeConstPosClip("b", "root", [0, 1, 0]); // 只动画 root，不碰 arm
    const hierarchy: BoneHierarchyNode[] = [{ name: "root" }, { name: "arm", parent: "root" }];
    const player = createYsmAnimPlayer(
      new Map([["root", root], ["arm", arm]]),
      [clipA, clipB],
      hierarchy,
      ["a", "b"],
    );

    for (let i = 0; i < 10; i++) player.apply(0.05);
    expect(arm.position.x).toBeCloseTo(-2.0, 5); // arm 被 clipA 推到 x=-2（0-2，X 取负）

    player.selectClip(1);
    player.apply(0.02); // 一小步：arm 应开始回落但仍在途中
    expect(arm.position.x).toBeLessThan(0);
    expect(arm.position.x).toBeGreaterThan(-2.0);

    for (let i = 0; i < 30; i++) player.apply(0.05);
    expect(arm.position.x).toBeCloseTo(0, 4); // 渐回 base（构造期姿态）
  });

  it("L3: 从未被动画触及的骨骼保持构造期 base 偏移", () => {
    const root = makeBone("root");
    const free = makeBone("free");
    free.position.set(1, 2, 3); // base 偏移
    const clip = makeConstPosClip("a", "root", [4, 0, 0]); // 只动画 root
    const hierarchy: BoneHierarchyNode[] = [{ name: "root" }, { name: "free", parent: "root" }];
    const player = createYsmAnimPlayer(
      new Map([["root", root], ["free", free]]),
      [clip],
      hierarchy,
      ["a"],
    );

    for (let i = 0; i < 10; i++) player.apply(0.05);
    expect(free.position.x).toBeCloseTo(1, 5);
    expect(free.position.y).toBeCloseTo(2, 5);
    expect(free.position.z).toBeCloseTo(3, 5);
  });

  it("transition: selectClip 后姿态从当前值平滑过渡，不硬切到目标", () => {
    const bone = makeBone("root");
    const clipA = makeConstPosClip("a", "root", [1, 0, 0]);
    const clipB = makeConstPosClip("b", "root", [5, 0, 0]);
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clipA, clipB], H, ["a", "b"]);

    // clipA 收敛到 x=-1
    for (let i = 0; i < 10; i++) player.apply(0.05);
    expect(bone.position.x).toBeCloseTo(-1.0, 5);

    // selectClip 切到 clipB（目标 x=-5）
    player.selectClip(1);
    // 一小步：alpha≈0.05，从 -1 向 -5 插值 5% → 约 -1.2
    player.apply(0.01);
    expect(bone.position.x).toBeGreaterThan(-1.5); // 没硬切到 -5
    expect(bone.position.x).toBeLessThan(-1.0);    // 已开始向 -5 过渡
  });

  it("transition: selectClip 保留当前姿态作为过渡起点（不清空）", () => {
    const bone = makeBone("root");
    const clipA = makeConstPosClip("a", "root", [2, 0, 0]);
    const clipB = makeConstPosClip("b", "root", [8, 0, 0]);
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clipA, clipB], H, ["a", "b"]);

    // clipA 收敛到 x=-2
    for (let i = 0; i < 10; i++) player.apply(0.05);
    expect(bone.position.x).toBeCloseTo(-2.0, 5);

    // selectClip 切到 clipB（目标 x=-8）
    player.selectClip(1);

    // 第一帧：alpha 很小，姿态应从 -2 开始向 -8 过渡，但还远没到 -8
    player.apply(0.02);
    expect(bone.position.x).toBeGreaterThan(-8.0);
    expect(bone.position.x).toBeLessThan(-2.0);

    // 收敛到 clipB 目标
    for (let i = 0; i < 30; i++) player.apply(0.05);
    expect(bone.position.x).toBeCloseTo(-8.0, 4);
  });

  // ---- 动画控制器（wine_fox 状态机，ADR-100 L4 语义：v. 每实体持久）----

  it("控制器: timeline 写 v.* 后条件触发状态切换（跨帧持久作用域）", () => {
    const bone = makeBone("root");
    const clipIdle: AnimationClip = {
      name: "idle",
      loop: true,
      length: 2,
      timeline: [
        { time: 0.5, actions: [compileMolang("v.flag = 1")!], raw: ["v.flag = 1"] },
      ],
      bones: {
        root: {
          position: [
            { time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
            { time: 1, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" },
          ],
        },
      },
    };
    const clipRun = makeConstPosClip("run", "root", [1, 0, 0]);
    const controller: AnimationController = {
      name: "test",
      initialState: "idle",
      states: new Map([
        ["idle", {
          name: "idle",
          animations: ["idle"],
          onExit: [],
          transitions: [
            { target: "run", condition: compileMolang("v.flag != 0"), raw: "v.flag != 0", unconditional: false },
          ],
          blendTransition: 0.2,
        }],
        ["run", {
          name: "run",
          animations: ["run"],
          onExit: [],
          transitions: [],
          blendTransition: 0.2,
        }],
      ]),
    };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clipIdle, clipRun], H, ["idle", "run"]);
    player.setController(controller);

    // 第一帧：timeline 事件(0.5)未触发，v.flag 未写 → 条件不满足
    player.apply(0.3);
    expect(player.getControllerState()).toBe("idle");
    expect(player.currentIndex()).toBe(0);

    // 第二帧：跨过 0.5 → v.flag=1 写入作用域 → 条件触发切换
    player.apply(0.3);
    expect(player.getControllerState()).toBe("run");
    expect(player.currentIndex()).toBe(1);
  });

  it("控制器: 时间条件按 timeInState 评估（query.anim_time >= 0.5）", () => {
    const bone = makeBone("root");
    const clipIdle = makeConstPosClip("idle", "root", [0, 0, 0]);
    const clipRun = makeConstPosClip("run", "root", [1, 0, 0]);
    const controller: AnimationController = {
      name: "test",
      initialState: "idle",
      states: new Map([
        ["idle", {
          name: "idle",
          animations: ["idle"],
          onExit: [],
          transitions: [
            { target: "run", condition: compileMolang("query.anim_time >= 0.5"), raw: "query.anim_time >= 0.5", unconditional: false },
          ],
          blendTransition: 0.2,
        }],
        ["run", {
          name: "run",
          animations: ["run"],
          onExit: [],
          transitions: [],
          blendTransition: 0.2,
        }],
      ]),
    };
    const player = createYsmAnimPlayer(new Map([["root", bone]]), [clipIdle, clipRun], H, ["idle", "run"]);
    player.setController(controller);

    // timeInState=0.3 < 0.5：不切换
    player.apply(0.3);
    expect(player.getControllerState()).toBe("idle");

    // timeInState=0.6 >= 0.5：切换（修复前硬编码 anim_time=0，永不触发）
    player.apply(0.3);
    expect(player.getControllerState()).toBe("run");
    expect(player.currentIndex()).toBe(1);
  });
});
