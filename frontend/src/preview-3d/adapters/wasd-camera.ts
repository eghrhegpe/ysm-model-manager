// ===== 3D 预览 WASD/方向键相机运动（从 mount-preview-core.ts §5 抽出）=====
// 纯函数：无任何模块级单例依赖，仅改传入的 cam/ctr/ot 引用。
// 每帧调用一次（rAF 循环内），移动向量经 reuse 槽位复用避免每帧 GC 分配。
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TdKeyAction } from "../keymap.ts";

/** rAF 相机运动复用的 Vector3 实例（避免每帧 GC 分配）；只读常量 */
const upVec = new THREE.Vector3(0, 1, 0);

/** applyWasdCameraMotion 的复用向量槽位（rAF loop 一次性创建，每帧传入） */
export interface WasdReuse {
  camDir: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  move: THREE.Vector3;
}

/** rAF 帧内 WASD/方向键 → 相机平移与焦点跟随（纯函数，无单例依赖；
 *  仅改传入 cam/ctr/ot 引用，移动向量经 reuse 复用，返回值 void） */
export function applyWasdCameraMotion(
  keys: Partial<Record<TdKeyAction, boolean>>,
  cam: THREE.PerspectiveCamera,
  ctr: OrbitControls,
  camSpeed: number,
  dt: number,
  orbitMode: boolean,
  ot: THREE.Vector3,
  reuse: WasdReuse,
): void {
  cam.getWorldDirection(reuse.camDir);
  reuse.forward.set(reuse.camDir.x, 0, reuse.camDir.z).normalize();
  reuse.right.crossVectors(reuse.forward, upVec).normalize();
  reuse.move.set(0, 0, 0);
  // 动作表驱动（input-and-animation 已按键位表把 code 映射成动作；方向键双轨也在此折叠）
  if (keys.forward) reuse.move.add(reuse.forward);
  if (keys.back) reuse.move.sub(reuse.forward);
  if (keys.left) reuse.move.sub(reuse.right);
  if (keys.right) reuse.move.add(reuse.right);
  if (keys.up) reuse.move.y += 1;
  if (keys.down) reuse.move.y -= 1;
  if (reuse.move.length() > 0) {
    reuse.move.normalize().multiplyScalar(camSpeed * dt);
    cam.position.add(reuse.move);
    if (orbitMode) ot.add(reuse.move);
  }
  if (orbitMode && ot) {
    ctr.target.copy(ot);
    ctr.update();
    ot.copy(ctr.target);
  } else {
    ctr.target.copy(cam.position).addScaledVector(reuse.camDir, 10);
    ctr.update();
  }
}
