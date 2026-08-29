// ===== 3D 相机初始化（从 model3d.ts 拆出，ADR-040 P1 第3轮）=====
// 根据内容根节点的包围盒计算相机初始位置和目标点。
// ysmview 风格：相机放在 Z- 侧（模型正面），距离 = 最大包围盒尺寸 * 1.5 + 2。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * 根据内容根节点的包围盒适配相机位置和 controls.target。
 * @param contentRoot 模型内容根节点（不含 sky/ground 等能力组件）
 * @returns { initCamPos, initCamTarget } 初始状态的深拷贝，供 resetCamera 使用
 */
export function fitCameraToScene(
  contentRoot: THREE.Object3D | null,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): { initCamPos: THREE.Vector3; initCamTarget: THREE.Vector3 } {
  return fitCameraToBounds(contentRoot ? [contentRoot] : [], camera, controls);
}

/**
 * 按给定根节点列表（多模型同框）计算并集包围盒并返回相机初始位姿。
 * 与 fitCameraToScene 同口径，但只框显式传入的 roots（来自 SceneRegistry.visibleRoots），
 * 从而正确处理「隐藏模型不计入」「排除 sky/ground 基线」（ADR-093 T3）。
 * @param roots 各可见模型的根 Object3D（差量捕获所得）
 */
export function fitCameraToRoots(
  roots: THREE.Object3D[],
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): { initCamPos: THREE.Vector3; initCamTarget: THREE.Vector3 } {
  return fitCameraToBounds(roots, camera, controls);
}

/**
 * 内部实现：计算包围盒并设置相机位置。
 * @param roots 要框选的根节点列表
 */
function fitCameraToBounds(
  roots: THREE.Object3D[],
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): { initCamPos: THREE.Vector3; initCamTarget: THREE.Vector3 } {
  const box = new THREE.Box3();
  for (const root of roots) {
    root.updateMatrixWorld();
    box.expandByObject(root);
  }

  if (!box.isEmpty()) {
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.5 + 2;
    // 模型包围盒适配：相机放 Z- 侧（模型正面；历史曾用 +Z/YSMViewer 默认，实际 YSM 模型脸朝 Z-）
    camera.position.set(center.x, center.y, center.z - dist);
    camera.lookAt(center);
    controls.target.copy(center);
    // 深度标定（ADR 对齐 vrm/mmd/fbx/pack）：把近/远裁剪面按包围盒收紧到 maxDim*50，
    // 避免共享单例相机残留的 far=5000 导致 YSM / 多模型同框深度精度崩坏（z-fighting / 遮挡错乱）。
    // 此前 fitCameraToScene 只设机位不碰 near/far，是"其他资源正常、YSM 深度异常"的根因。
    camera.near = 0.05;
    camera.far = maxDim * 50;
    camera.updateProjectionMatrix();
  } else {
    camera.position.set(0, 80, -120);
    controls.target.set(0, 80, 0);
  }
  controls.update();

  return {
    initCamPos: camera.position.clone(),
    initCamTarget: controls.target.clone(),
  };
}
