// ===== [ADR-315 D2②] VRM 感知层驱动（自 vrm-adapter.ts 拆出真缝）=====
// 待机态程序化生命力（呼吸 L1 / 注视 L2 / 眨眼 L1.5 / 足部锚地 IK）的构造与每帧驱动。
// 行为零变更纯搬运：buildPerception 构造期一次性捕获状态依赖，
// applyIdlePerception / applyAnimationFootIK / applyBlinkPerception 供 update 闭包每帧调用。
import type { VRM } from "@pixiv/three-vrm";
import type * as THREE from "three";
import type { PreviewBuildCtx } from "@/preview-3d/adapters/mount-preview-core.ts";
import { createBlinkController } from "@/preview-3d/adapters/shared/perception/blink.ts";
import { createBreathController } from "@/preview-3d/adapters/shared/perception/breath.ts";
import {
  createPerceptionPauseRef,
  type PerceptionPauseRef,
} from "@/preview-3d/adapters/shared/perception/core.ts"; // #9 per-instance 暂停引用（取代全局单例）
import { createGazeController } from "@/preview-3d/adapters/shared/perception/gaze.ts";
import { requireSharedInfra } from "@/preview-3d/adapters/shared/shared-infra.ts";
import type { BoneTree } from "@/preview-3d/bone/bone-tools.ts";
import { createFootIKController } from "@/preview-3d/bone/mmd-foot-ik.ts"; // 程序化足部锚地（待机态 IK，格式无关）
import type { SemanticBoneMap } from "@/preview-3d/bone/semantic-bones.ts";
import type { createVrmFootIKController } from "@/preview-3d/bone/vrm-foot-ik.ts"; // VMD 足ＩＫ 驱动（ADR-243 §2.8 方案 A）
import {
  type PerceptionCapability,
  type PerceptionState,
  pickPerceptionCaps,
} from "@/preview-3d/menu/panels/perception-controls.ts";
import type { VrmMotionClipEntry, VrmMotionState } from "./vrm-motion.ts";

export interface VrmPerceptionState {
  perceptionState: PerceptionState;
  perceptionCaps: PerceptionCapability[];
  breath: ReturnType<typeof createBreathController>;
  gaze: ReturnType<typeof createGazeController> | null;
  blink: ReturnType<typeof createBlinkController>;
  footIK: ReturnType<typeof createFootIKController>;
  useNativeLookAt: boolean;
  blinkExpressionNames: Array<"blink" | "blinkLeft" | "blinkRight">;
  exprMgr: VRM["expressionManager"];
  perceptionPauseRef: PerceptionPauseRef;
}

export function buildPerception(
  vrm: VRM,
  ctx: PreviewBuildCtx,
  boneTree: BoneTree,
  semanticBones: SemanticBoneMap,
): VrmPerceptionState {
  const perceptionState: PerceptionState = {
    breath: true,
    gaze: true,
    blink: true,
    lipSync: false,
    autoDance: false,
  };
  // 能力声明：caps 从真实构造派生（非硬编码清单）——原生 lookAt 接管注视、
  // 眨眼表情缺失、语义骨骼为空时不显示对应开关（否则菜单谎报：开关在、驱动不在）
  const perceptionPauseRef = createPerceptionPauseRef();
  const breath = createBreathController({ pauseRef: perceptionPauseRef });
  const useNativeLookAt = !!vrm.lookAt;
  const gaze: ReturnType<typeof createGazeController> | null = useNativeLookAt
    ? null
    : createGazeController();
  if (useNativeLookAt && ctx.camera && vrm.lookAt) vrm.lookAt.target = ctx.camera;
  const exprMgr = vrm.expressionManager;
  const blinkExpressionNames = exprMgr
    ? (["blink", "blinkLeft", "blinkRight"] as const).filter(
        (n) => exprMgr.getExpression(n) !== null,
      )
    : ([] as Array<"blink" | "blinkLeft" | "blinkRight">);
  const blink = createBlinkController({ pauseRef: perceptionPauseRef });
  const perceptionCaps = pickPerceptionCaps([
    ...(semanticBones && Object.keys(semanticBones).length > 0 ? (["breath"] as const) : []),
    ...(!useNativeLookAt ? (["gaze"] as const) : []),
    ...(blinkExpressionNames.length > 0 ? (["blink"] as const) : []),
  ]);
  const footIK = createFootIKController(boneTree, semanticBones);
  return {
    perceptionState,
    perceptionCaps,
    breath,
    gaze,
    blink,
    footIK,
    useNativeLookAt,
    blinkExpressionNames,
    exprMgr,
    perceptionPauseRef,
  };
}

/** 待机态感知层驱动的状态依赖（Stage5 组装期一次性捕获，外提后各自可度量复杂度） */
export interface VrmIdlePerceptionDeps {
  perception: VrmPerceptionState;
  semanticBones: SemanticBoneMap;
  animActive: boolean;
  ctx: PreviewBuildCtx;
}

/**
 * 待机态感知层驱动（呼吸/眨眼自查全局暂停标志；gaze 保留本层 !animActive 守卫）。
 * 从 Stage5 的 update 闭包外提——原实现三层嵌套 if 使 update 认知复杂度超标。
 */
export function applyIdlePerception(dt: number, deps: VrmIdlePerceptionDeps): void {
  const { perception, semanticBones, animActive, ctx } = deps;
  const { perceptionState, breath, gaze, footIK, useNativeLookAt } = perception;
  if (semanticBones) {
    if (perceptionState.breath) breath.apply(dt, semanticBones);
    // gaze 不挂全局暂停标志（摄像机追踪，非动画优先级）——保留本层 !animActive 守卫
    if (!animActive && !useNativeLookAt && perceptionState.gaze)
      gaze?.apply(dt, semanticBones, requireSharedInfra(ctx).camera.position);
  }
  footIK.apply(dt, !animActive);
}

/**
 * 当前动作帧的 VMD 足 IK 驱动。按 live action 的 clip 反查 targets（非独立维护的 index）——
 * time 源与 target 源同一对象，永不脱钩（review 64c24cf3e P1；clip 经公开 `action.getClip()`
 * 读取，不碰 three 私有 `_clip`）。
 */
export function applyAnimationFootIK(
  action: THREE.AnimationAction,
  motionClips: VrmMotionClipEntry[],
  vrmFootIK: ReturnType<typeof createVrmFootIKController>,
): void {
  const current = motionClips.find((c) => c.clip === action.getClip());
  if (current?.footIK) vrmFootIK.apply(action.time, current.footIK);
}

/** 眨眼驱动：exprMgr + 表情名齐备且 blink 开启才生效（从 update 闭包外提降嵌套） */
export function applyBlinkPerception(dt: number, perception: VrmPerceptionState): void {
  const { perceptionState, blink, blinkExpressionNames, exprMgr } = perception;
  if (exprMgr && blinkExpressionNames.length > 0 && perceptionState.blink) {
    const mgr = exprMgr;
    blink.apply(dt, (weight: number) => {
      for (const name of blinkExpressionNames) {
        mgr.setValue(name, weight);
      }
    });
  }
}

/** 每帧 update 的状态依赖（Stage5 组装期一次性捕获；ADR-315 D2② 随感知层一起拆出） */
export interface VrmUpdateDeps {
  vrm: VRM;
  motion: VrmMotionState;
  perception: VrmPerceptionState;
  semanticBones: SemanticBoneMap;
  vrmFootIK: ReturnType<typeof createVrmFootIKController>;
  ctx: PreviewBuildCtx;
}
