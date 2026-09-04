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

// ===== 矩阵新鲜度标记（code review #4：每帧双重全树矩阵更新）=====
// expandBoxVisible 原每帧对每个根 updateWorldMatrix(true, true) 递归全子树，
// 随后 render() 内部又 updateMatrixWorld 一遍——多模型同框时每帧两遍全场景遍历。
// 动静分治：矩阵自上次 render 后未变（无 perFrame 动画）时跳过强制更新，直接
// 复用 render() 留下的新鲜 matrixWorld。标记位何时置 dirty：
//   ① registerModelRoot（新根的 matrixWorld 未渲染过，恒 stale）
//   ② render-loop 每帧检测到 perFrame 回调（模型动画改写局部变换）
// 何时视为 clean：cullModelGroups 走完多根路径后（紧随其后的 render() 会再刷一遍，
// 此后到下一帧 cull 前若无 ①②，矩阵保持新鲜）。
let _matricesDirty = true;

/** 标记矩阵已失效（render-loop 有 perFrame 回调的帧调用；测试路径可直接调） */
export function markCullMatricesDirty(): void {
  _matricesDirty = true;
}

/** 注册模型根节点（adapter 调用） */
export function registerModelRoot(obj: THREE.Object3D): void {
  if (!modelRoots.includes(obj)) {
    modelRoots.push(obj);
    _matricesDirty = true; // 新根未渲染过，matrixWorld 恒 stale
  }
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
    const v = Boolean((obj as THREE.Mesh).isMesh || obj.children.length > 0);
    // 值未变不写（code review #9：每帧给 visible 赋同值触发无谓的脏检查）
    if (obj.visible !== v) obj.visible = v;
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
  // 本帧矩阵已刷新（紧随其后的 render() 再次 updateMatrixWorld，保持新鲜）；
  // 下帧若无 ①注册/②perFrame 置脏，expandBoxVisible 可跳过强制更新
  _matricesDirty = false;
}

/** 递归展开 bounding box，只计入 visible 子树（跳过隐藏的载具/投射物组件） */
function expandBoxVisible(obj: THREE.Object3D, box: THREE.Box3): void {
  if (!obj.visible) return;
  // 动静分治（code review #4）：仅矩阵置脏时强制 updateWorldMatrix(true, true)——
  // 首帧/新注册根/有 perFrame 动画的帧必刷（对齐 Box3.setFromObject 内部语义）；
  // 静态帧直接复用 render() 留下的新鲜 matrixWorld，省一遍全子树递归。
  if (_matricesDirty) {
    obj.updateWorldMatrix(true, true);
  }
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
  _matricesDirty = true; // 下次裁剪从保守态起步
}

// ===== 视锥裁剪开关（localStorage 持久化，设置面板可关）=====
// 默认关：单模型（单个 YSM/VRM rootGroup）时 cullModelGroups 走 modelRoots.length
// ===1 豁免分支，本剔除空转零收益，却承担多根场景的误剔/闪烁风险（用户观察
// "不剔除更正常"即指此）。真正需要省渲染的是多模型同框（>1 根），由用户手动
// 在设置面板开启。剔除失误（误藏模型/闪烁）时也可随时关闭恢复可见。
const CULL_ENABLED_KEY = "ysm_3d_frustumCull";

// 模块级缓存（code review：isFrustumCullEnabled 在 rAF 热路径每帧调用，
// 每帧同步 localStorage 读是 anti-pattern——对齐 render-budget.ts getMaxFps 的
// 缓存 + invalidate 范式；设置面板经 setFrustumCullEnabled 写入时自动失效）
let _cullEnabledCache: boolean | null = null;

/** 视锥裁剪开关是否启用（undefined → 默认关；safeGet 隐私模式安全） */
export function isFrustumCullEnabled(): boolean {
  if (_cullEnabledCache !== null) return _cullEnabledCache;
  const v = safeGet(CULL_ENABLED_KEY);
  const enabled = v === null ? false : v !== "0";
  _cullEnabledCache = enabled;
  return enabled;
}

/** 设置视锥裁剪开关（设置面板开关调用；写入后失效热路径缓存） */
export function setFrustumCullEnabled(enabled: boolean): void {
  safeSet(CULL_ENABLED_KEY, enabled ? "1" : "0");
  _cullEnabledCache = enabled;
}

/** 关闭剔除时恢复所有注册模型根可见性（幂等） */
export function restoreModelGroupsVisible(): void {
  for (const root of modelRoots) root.visible = true;
}
