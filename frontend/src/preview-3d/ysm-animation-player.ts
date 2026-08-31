// ===== YSM 骨骼动画播放器（ADR-100 L1+L2+L3）=====
// 把 parseBedrockAnimationJSON 产出的 AnimationClip 驱动到 THREE.Object3D 骨骼节点上。
// 纯 Three.js 逻辑，0 backend import（ADR-072 边界纯净）。
//
// 与 VRM VRMA 的差异：
//   - VRM：GLTFLoader + VRMAnimationLoaderPlugin 自动解析 .vrma → vrmAnimations
//   - YSM：手动调 parseBedrockAnimationJSON → evaluateClip → 应用 Group 变换
//
// YSM 骨骼是 THREE.Group 层级（非 THREE.Bone），变换直接作用在 group.position/quaternion/scale。
//
// L3 混合模型（对齐 YSMViewer 的过渡口径：从不硬切）：
//   - 三通道（rotation/position/scale）统一 alpha 累加混合：切换/开播时 rest
//     采集当前姿态，alpha 按 BLEND_RATE 累加到 1（大 dt 单帧即精确到位）。
//   - 构造期捕获各骨骼 base 姿态；当前 clip 未触及的骨骼目标回落到 base，
//     实现「停播骨骼渐回零位」（YSMViewer Aura3DRenderer 同款收尾）。

import * as THREE from "three";
import {
  evaluateClip,
  executeTimeline,
  type AnimationClip,
  type BoneChannels,
  type BoneHierarchyNode,
  type Vec3,
} from "../utils/animation/animation.ts";
import {
  AnimationControllerRuntime,
  type AnimationController,
} from "../utils/animation/animation-controller.ts";
import { setMolangScope } from "../utils/animation/molang.ts";

export interface YsmAnimPlayer {
  apply(dt: number): void;
  dispose(): void;
  toggle(): void;
  isPlaying(): boolean;
  getTime(): number;
  getDuration(): number;
  currentIndex(): number;
  clips(): ReadonlyArray<{ label: string }>;
  clipCount(): number;
  selectClip(index: number): void;
  isAnimActive(): boolean;
  /** 设置动画控制器（wine_fox 等模型的状态机驱动） */
  setController(controller: AnimationController): void;
  /** 获取当前控制器状态名（调试用） */
  getControllerState(): string | null;
}

interface MdApBonePose { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3; }

interface MdApScratch {
  quat: THREE.Quaternion;
  euler: THREE.Euler;
  pos: THREE.Vector3;
  scale: THREE.Vector3;
}

interface MdApState {
  currentIdx: number;
  elapsed: number;
  playing: boolean;
  prevElapsed: number;
  controllerRuntime: AnimationControllerRuntime | null;
  controllerVariables: Record<string, number>;
}

interface MdApCtx {
  boneByName: Map<string, THREE.Object3D>;
  clips: AnimationClip[];
  boneHierarchy: BoneHierarchyNode[];
  labels: ReadonlyArray<{ label: string }>;
  clipNameToIdx: Map<string, number>;
  basePose: Map<string, MdApBonePose>;
  restPose: Map<string, MdApBonePose>;
  blendAlpha: Map<string, number>;
  BLEND_RATE: number;
  scratch: MdApScratch;
}

function mdApCreateBasePose(boneByName: Map<string, THREE.Object3D>): Map<string, MdApBonePose> {
  const basePose = new Map<string, MdApBonePose>();
  for (const [name, node] of boneByName) {
    basePose.set(name, {
      pos: node.position.clone(),
      quat: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  }
  return basePose;
}

function mdApCaptureRestPose(
  boneByName: Map<string, THREE.Object3D>,
  restPose: Map<string, MdApBonePose>,
  blendAlpha: Map<string, number>,
): void {
  for (const [name, node] of boneByName) {
    let rest = restPose.get(name);
    if (!rest) {
      rest = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3() };
      restPose.set(name, rest);
    }
    rest.pos.copy(node.position);
    rest.quat.copy(node.quaternion);
    rest.scale.copy(node.scale);
    blendAlpha.set(name, 0);
  }
}

function mdApAdvanceTimeAndController(
  dt: number,
  state: MdApState,
  ctx: MdApCtx,
): void {
  const clip = ctx.clips[state.currentIdx];
  const prevTime = state.prevElapsed;
  state.elapsed += dt;
  if (clip.loop && clip.length > 0) {
    state.elapsed = ((state.elapsed % clip.length) + clip.length) % clip.length;
  } else if (state.elapsed > clip.length) {
    state.elapsed = clip.length;
    state.playing = false;
  }

  if (state.controllerRuntime) setMolangScope(state.controllerVariables);
  try {
    executeTimeline(clip.timeline, prevTime, state.elapsed);
    state.prevElapsed = state.elapsed;

    if (state.controllerRuntime) {
      const switched = state.controllerRuntime.update(dt);
      if (switched) {
        const newAnim = state.controllerRuntime.currentAnimation;
        const newIdx = ctx.clipNameToIdx.get(newAnim);
        if (newIdx !== undefined && newIdx !== state.currentIdx) {
          state.currentIdx = newIdx;
          state.elapsed = 0;
          state.prevElapsed = 0;
          state.playing = true;
          mdApCaptureRestPose(ctx.boneByName, ctx.restPose, ctx.blendAlpha);
        }
      }
    }
  } finally {
    if (state.controllerRuntime) setMolangScope(null);
  }
}

function mdApApplyPose(
  dt: number,
  state: MdApState,
  ctx: MdApCtx,
): void {
  const clip = ctx.clips[state.currentIdx];
  const transforms = evaluateClip(clip, state.elapsed, ctx.boneHierarchy, true);
  const { scratch, basePose, restPose, blendAlpha, BLEND_RATE, boneByName } = ctx;

  for (const [boneName, node] of boneByName) {
    const base = basePose.get(boneName);
    if (!base) continue;
    const transform = transforms.get(boneName);

    if (transform?.rotation) {
      const [rx, ry, rz] = transform.rotation;
      scratch.quat.setFromEuler(scratch.euler.set(rz, ry, rx, "ZYX"));
    } else {
      scratch.quat.copy(base.quat);
    }
    if (transform?.position) {
      scratch.pos.set(
        base.pos.x - transform.position[0],
        base.pos.y + transform.position[1],
        base.pos.z + transform.position[2],
      );
    } else {
      scratch.pos.copy(base.pos);
    }
    if (transform?.scale) {
      const [sx, sy, sz] = transform.scale;
      if (sx === 0 && sy === 0 && sz === 0) {
        node.visible = false;
      } else {
        node.visible = true;
        scratch.scale.set(sx, sy, sz);
      }
    } else {
      scratch.scale.copy(base.scale);
      node.visible = true;
    }

    let rest = restPose.get(boneName);
    let alpha = blendAlpha.get(boneName) ?? 0;
    if (!rest) {
      rest = { pos: node.position.clone(), quat: node.quaternion.clone(), scale: node.scale.clone() };
      restPose.set(boneName, rest);
      alpha = Math.min(1, dt * BLEND_RATE);
    } else {
      alpha = Math.min(1, alpha + dt * BLEND_RATE);
    }
    blendAlpha.set(boneName, alpha);

    node.quaternion.copy(rest.quat).slerp(scratch.quat, alpha);
    node.position.copy(rest.pos).lerp(scratch.pos, alpha);
    node.scale.copy(rest.scale).lerp(scratch.scale, alpha);
  }
}

function mdApSelectClip(
  index: number,
  state: MdApState,
  ctx: MdApCtx,
): void {
  if (index < 0 || index >= ctx.clips.length) return;
  state.currentIdx = index;
  state.elapsed = 0;
  state.prevElapsed = 0;
  state.playing = true;
  mdApCaptureRestPose(ctx.boneByName, ctx.restPose, ctx.blendAlpha);
}

function mdApSetController(
  controller: AnimationController,
  state: MdApState,
  ctx: MdApCtx,
): void {
  state.controllerVariables = {};
  state.controllerRuntime = new AnimationControllerRuntime(
    controller,
    (animationName: string, blendTime: number) => {
      const idx = ctx.clipNameToIdx.get(animationName);
      if (idx !== undefined && idx !== state.currentIdx) {
        state.currentIdx = idx;
        state.elapsed = 0;
        state.prevElapsed = 0;
        state.playing = true;
        mdApCaptureRestPose(ctx.boneByName, ctx.restPose, ctx.blendAlpha);
      }
    },
  );
}

function mdApDispose(
  state: MdApState,
  ctx: MdApCtx,
): void {
  setMolangScope(null);
  state.elapsed = 0;
  state.prevElapsed = 0;
  state.playing = true;
  ctx.restPose.clear();
  ctx.blendAlpha.clear();
}

function mdApBuildMeta(
  clips: AnimationClip[],
  clipLabels: string[] | undefined,
): { labels: ReadonlyArray<{ label: string }>; clipNameToIdx: Map<string, number> } {
  const rawLabels = clipLabels ?? clips.map((_, i) => `Clip ${i}`);
  const labels = rawLabels.slice(0, clips.length).map((label) => ({ label }));
  const clipNameToIdx = new Map<string, number>();
  for (let i = 0; i < clips.length; i++) clipNameToIdx.set(clips[i].name, i);
  return { labels, clipNameToIdx };
}

function mdApCreateInitialState(): MdApState {
  return { currentIdx: 0, elapsed: 0, playing: true, prevElapsed: 0, controllerRuntime: null, controllerVariables: {} };
}

function mdApToggle(state: MdApState, ctx: MdApCtx): void {
  const clip = ctx.clips[state.currentIdx];
  if (state.elapsed >= clip.length && !clip.loop) { state.elapsed = 0; state.playing = true; }
  else { state.playing = !state.playing; }
}

/**
 * Builds a YSM animation player whose per-frame path reuses every temporary object.
 * boneHierarchy remains in the signature for API compatibility; Three.js already
 * propagates the local transforms through the Object3D hierarchy.
 */
export function createYsmAnimPlayer(
  boneByName: Map<string, THREE.Object3D>,
  clips: AnimationClip[],
  boneHierarchy: BoneHierarchyNode[],
  clipLabels?: string[],
): YsmAnimPlayer {
  if (clips.length === 0) throw new Error("YSM animation player requires at least one clip");
  const { labels, clipNameToIdx } = mdApBuildMeta(clips, clipLabels);
  const state = mdApCreateInitialState();
  const ctx: MdApCtx = {
    boneByName, clips, boneHierarchy, labels, clipNameToIdx,
    basePose: mdApCreateBasePose(boneByName),
    restPose: new Map<string, MdApBonePose>(),
    blendAlpha: new Map<string, number>(),
    BLEND_RATE: 5.0,
    scratch: { quat: new THREE.Quaternion(), euler: new THREE.Euler(), pos: new THREE.Vector3(), scale: new THREE.Vector3() },
  };
  const getClip = (): AnimationClip => ctx.clips[state.currentIdx];
  return {
    apply(dt: number): void { if (!state.playing) return; mdApAdvanceTimeAndController(dt, state, ctx); mdApApplyPose(dt, state, ctx); },
    dispose(): void { mdApDispose(state, ctx); },
    toggle(): void { mdApToggle(state, ctx); },
    isPlaying: () => state.playing,
    getTime: () => state.elapsed,
    getDuration: () => getClip().length || 0,
    currentIndex: () => state.currentIdx,
    clips: () => ctx.labels,
    clipCount: () => ctx.clips.length,
    selectClip(index: number): void { mdApSelectClip(index, state, ctx); },
    isAnimActive(): boolean { return state.playing && state.elapsed < (getClip().length || Infinity); },
    setController(controller: AnimationController): void { mdApSetController(controller, state, ctx); },
    getControllerState(): string | null { return state.controllerRuntime?.current_state ?? null; },
  };
}
