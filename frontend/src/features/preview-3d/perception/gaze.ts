// ===== 感知层：注视追踪（程序化生命力 L2）=====
// 让模型的头部/眼球跟随相机方向，产生"在看你"的生命力感。
// 驱动方式：每帧对 head/leftEye/rightEye 骨骼施加旋转偏移（基于相机相对方向）。
// 设计原则：
//   - 仅驱动骨骼（head/eyes），不影响蒙皮形态；
//   - 宽容缺省：缺失 head 骨时整功能静默降级；
//   - 绝对变换（基于 restingRot 快照，非累加）；
//   - 在适配器 update 里于主运行时之后调用（additive override）。
//
// 消费方示例：
//   const gaze = createGazeController();
//   // in adapter update(dt, semanticBones, cameraPos):
//   gaze.apply(dt, semanticBones, cameraPos);

import * as THREE from "three";
import { getSemanticBone, type SemanticBoneMap, type SemanticBoneId } from "../semantic-bones.ts";

/** 注视驱动的语义骨骼：head 为主，eyes 为辅 */
const GAZE_BONES: SemanticBoneId[] = ["head", "leftEye", "rightEye"];

/** 注视灵敏度：head 最大角度偏移（弧度），eyes 次之 */
const GAZE_HEAD_MAX_RAD = 0.15; // ~8.6°，自然范围
const GAZE_EYE_MAX_RAD = 0.08;  // ~4.6°，眼球微动

/** 平滑因子：每帧向目标旋转插值（lerp t，越大越跟得急） */
const GAZE_SMOOTH = 0.08;

interface GazeSnap {
  /** 骨骼的 rest（中性）四元数，用于计算 offset */
  restRot: THREE.Quaternion;
  /** 骨骼的世界坐标（计算方向用） */
  worldPos: THREE.Vector3;
}

export function createGazeController() {
  let snaps: Map<string, GazeSnap> | null = null;
  let prevCamPos: THREE.Vector3 | null = null;

  function warmup(map: SemanticBoneMap): void {
    if (snaps) return;
    const s = new Map<string, GazeSnap>();
    for (const id of GAZE_BONES) {
      const e = getSemanticBone(map, id);
      if (!e?.object) continue;
      s.set(id, {
        restRot: e.object.quaternion.clone(),
        worldPos: new THREE.Vector3(),
      });
    }
    snaps = s;
  }

  /**
   * 每帧驱动（在 adapter update 内调用，主运行时之后）。
   * @param camPos  相机世界坐标（用于计算相对方向）
   */
  function apply(_dt: number, map: SemanticBoneMap, camPos: THREE.Vector3): void {
    warmup(map);
    if (!snaps?.size) return;

    // 无 head 骨 → 整体降级为静默
    const headSnap = snaps.get("head");
    if (!headSnap) return;

    // 更新 head 世界位置
    const headObj = getSemanticBone(map, "head")?.object;
    if (!headObj) return;
    headObj.getWorldPosition(headSnap.worldPos);

    // 计算相机相对方向（head → cam）
    const dirToCam = new THREE.Vector3()
      .subVectors(camPos, headSnap.worldPos)
      .normalize();

    // 水平角（Yaw）：dir 在 XZ 平面投影与 Z 轴的夹角
    const yaw = Math.atan2(dirToCam.x, dirToCam.z);
    // 垂直角（Pitch）：dir 与 XZ 平面的夹角
    const pitch = Math.asin(Math.max(-1, Math.min(1, dirToCam.y)));

    // head 目标旋转：pitch 绕 X 轴，yaw 绕 Y 轴（叠加）
    const targetQuat = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));

    // 应用到 head：在 restRot 基础上叠加 targetQuat
    // （headObj 已在上面 getSemanticBone("head") 查得并守卫非空——复用，避免重复查找）
    const offset = new THREE.Quaternion().copy(targetQuat).multiply(headSnap.restRot);
    headObj.quaternion.slerp(offset, GAZE_SMOOTH);

    // eyes：基于 head-local 坐标系微动（让眼珠跟着头转，同时在 head 上再微偏）
    for (const eyeId of ["leftEye", "rightEye"] as SemanticBoneId[]) {
      const snap = snaps.get(eyeId);
      const entry = getSemanticBone(map, eyeId);
      if (!snap || !entry?.object) continue;
      // eye 朝向：水平方向镜像（左眼向左看 = negative local X，右眼向右看 = positive local X）
      const sign = eyeId === "leftEye" ? -1 : 1;
      const eyeTarget = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, sign * pitch * 0.3, sign * yaw * 0.5, "YXZ"),
      );
      const eyeOffset = eyeTarget.premultiply(snap.restRot);
      entry.object.quaternion.slerp(eyeOffset, GAZE_SMOOTH);
    }

    prevCamPos = camPos;
  }

  function reset(): void {
    snaps = null;
    prevCamPos = null;
  }

  /** 销毁：释放 Three.js 对象引用（quaternion/position 快照），防止模型移除后内存泄漏 */
  function dispose(): void {
    snaps?.clear();
    snaps = null;
    prevCamPos = null;
  }

  return { apply, reset, dispose };
}
