// ===== 视锥裁剪工具（Group 级 frustum culling）=====
// Three.js 默认逐 mesh 做 frustumCulled，但对整个 Group 仍需遍历子节点。
// 本工具在 Group 级做 BoundingSphere 测试，visible=false 后 Three.js 跳过整组遍历。
// 用途：多模型同框时，镜头外的模型整组跳过（省 matrixWorld 递归 + mesh 遍历）。
import * as THREE from "three";
import { safeGet, safeSet } from "../utils/dom/storage.ts";

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _box = new THREE.Box3();
const _sphere = new THREE.Sphere();
const _vec = new THREE.Vector3();

/** 需要裁剪的模型根节点列表（adapter 在 scene.add 时注册） */
const modelRoots: THREE.Object3D[] = [];

/** 注册模型根节点（adapter 调用） */
export function registerModelRoot(obj: THREE.Object3D): void {
  if (!modelRoots.includes(obj)) modelRoots.push(obj);
}

/** 注销模型根节点（adapter dispose 时调用） */
export function unregisterModelRoot(obj: THREE.Object3D): void {
  const i = modelRoots.indexOf(obj);
  if (i >= 0) modelRoots.splice(i, 1);
}

/** 获取当前注册的模型根节点数 */
export function getModelRootCount(): number {
  return modelRoots.length;
}

/**
 * 对所有已注册的模型根节点做视锥裁剪。
 * visible=false 的对象会被 Three.js 跳过（不遍历子 mesh）。
 * 在 render loop 中每帧调用一次。
 */
export function cullModelGroups(camera: THREE.Camera): void {
  if (modelRoots.length === 0) return;
  for (let i = modelRoots.length - 1; i >= 0; i--) {
    if (!modelRoots[i].parent) modelRoots.splice(i, 1);
  }
  if (modelRoots.length === 0) return;
  if (modelRoots.length === 1) {
    const obj = modelRoots[0];
    obj.visible = Boolean((obj as THREE.Mesh).isMesh || obj.children.length > 0);
    return;
  }
  _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);

  for (let i = modelRoots.length - 1; i >= 0; i--) {
    const obj = modelRoots[i];
    if (!obj.parent) {
      // 已从场景移除，清理引用
      modelRoots.splice(i, 1);
      continue;
    }
    // 只累加 visible 子树：Box3.setFromObject 默认计入 visible=false 的子节点，
    // 多组件模型里隐藏的车/载具会把 bounding box 撑大并偏移，导致视锥剔除在
    // 边界来回翻转（角色闪烁）。手写递归跳过 !visible 子树修复此问题。
    _box.makeEmpty();
    expandBoxVisible(obj, _box);
    if (_box.isEmpty()) {
      obj.visible = false;
      continue;
    }
    _box.getBoundingSphere(_sphere);
    obj.visible = _frustum.intersectsSphere(_sphere);
  }
}

/** 递归展开 bounding box，只计入 visible 子树（跳过隐藏的载具/投射物组件） */
function expandBoxVisible(obj: THREE.Object3D, box: THREE.Box3): void {
  if (!obj.visible) return;
  // 无条件更新世界矩阵：render loop 外的测试路径可能未 updateMatrixWorld，
  // matrixWorldNeedsUpdate 守卫不可靠（new Group() 初始即 false）。对齐
  // Box3.setFromObject 内部 updateWorldMatrix(true, true) 语义。
  obj.updateWorldMatrix(true, true);
  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    // geometry.boundingBox 默认 null，需显式计算（对齐 Box3.setFromObject 内部行为）
    let bb = mesh.geometry.boundingBox;
    if (!bb) {
      mesh.geometry.computeBoundingBox();
      bb = mesh.geometry.boundingBox;
    }
    if (bb && !bb.isEmpty()) {
      _vec.copy(bb.min).applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(_vec);
      _vec.copy(bb.max).applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(_vec);
    }
  }
  for (const child of obj.children) expandBoxVisible(child, box);
}

/** 清空所有注册（session 结束时调用） */
export function clearModelRoots(): void {
  modelRoots.length = 0;
}

// ===== 视锥裁剪开关（localStorage 持久化，设置面板可关）=====
// 默认关：单模型（单个 YSM/VRM rootGroup）时 cullModelGroups 走 modelRoots.length
// ===1 豁免分支，本剔除空转零收益，却承担多根场景的误剔/闪烁风险（用户观察
// "不剔除更正常"即指此）。真正需要省渲染的是多模型同框（>1 根），由用户手动
// 在设置面板开启。剔除失误（误藏模型/闪烁）时也可随时关闭恢复可见。
const CULL_ENABLED_KEY = "ysm_3d_frustumCull";

/** 视锥裁剪开关是否启用（undefined → 默认关；safeGet 隐私模式安全） */
export function isFrustumCullEnabled(): boolean {
  const v = safeGet(CULL_ENABLED_KEY);
  return v === null ? false : v !== "0";
}

/** 设置视锥裁剪开关（设置面板开关调用） */
export function setFrustumCullEnabled(enabled: boolean): void {
  safeSet(CULL_ENABLED_KEY, enabled ? "1" : "0");
}

/** 关闭剔除时恢复所有注册模型根可见性（幂等） */
export function restoreModelGroupsVisible(): void {
  for (const root of modelRoots) root.visible = true;
}
