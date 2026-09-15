// ===== 视锥裁剪工具（Group 级 frustum culling）=====
// Three.js 默认逐 mesh 做 frustumCulled，但对整个 Group 仍需遍历子节点。
// 本工具在 Group 级做 BoundingSphere 测试，visible=false 后 Three.js 跳过整组遍历。
// 用途：多模型同框时，镜头外的模型整组跳过（省 matrixWorld 递归 + mesh 遍历）。
import * as THREE from "three";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _box = new THREE.Box3();
const _sphere = new THREE.Sphere();
const _vec = new THREE.Vector3();

/** 需要裁剪的模型根节点列表（adapter 在 scene.add 时注册） */
const modelRoots: THREE.Object3D[] = [];

/**
 * 被**本模块**压成 visible=false 的根集合（抑制态归属，2026-09 修复）。
 * 只记录「我们写的隐藏」，restoreModelGroupsVisible 据此精确还原，
 * 不覆盖用户经 sceneRegistry.setVisible 施加的隐藏意图。
 */
const _culled = new Set<THREE.Object3D>();

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
  // 抑制态一并摘除：已注销的根不再由我们负责还原（引用可能被 adapter 复用/释放）
  _culled.delete(obj);
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
    // 尊重用户隐藏：单根场景下本分支只做「空组压隐藏」这一件事，若该根已被
    // 非本模块隐藏（用户面板隐藏），不得写 true 复活它。
    if (!obj.visible && !_culled.has(obj)) return;
    const v = Boolean((obj as THREE.Mesh).isMesh || obj.children.length > 0);
    // 值未变不写（code review #9：每帧给 visible 赋同值触发无谓的脏检查）
    if (obj.visible !== v) {
      obj.visible = v;
      // 抑制态归属：只有「我们写的隐藏」才登记，供 restore 精确还原
      if (!v) _culled.add(obj);
      else _culled.delete(obj);
    }
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
    // 尊重非本模块置的隐藏：用户经 sceneRegistry.setVisible 隐藏的根（未登记在 _culled）
    // 直接跳过，既不做剔除判定也不改写 visible——否则剔除会「接管」用户意图并在
    // restore 时把它当自己的抑制态还原，造成「隐藏被兜底复活」。
    if (!obj.visible && !_culled.has(obj)) {
      // 唯一例外：子树全空（无 isMesh 且无子节点）仍需压隐藏由下面的 isEmpty 分支处理，
      // 但那种根本就不可能可见，跳过不影响正确性。
      continue;
    }
    // 只累加 visible 子树：Box3.setFromObject 默认计入 visible=false 的子节点，
    // 多组件模型里隐藏的车/载具会把 bounding box 撑大并偏移，导致视锥剔除在
    // 边界来回翻转（角色闪烁）。手写递归跳过 !visible 子树修复此问题。
    _box.makeEmpty();
    expandBoxVisible(obj, _box);
    if (_box.isEmpty()) {
      obj.visible = false;
      _culled.add(obj);
      continue;
    }
    _box.getBoundingSphere(_sphere);
    const inFrustum = _frustum.intersectsSphere(_sphere);
    obj.visible = inFrustum;
    // 抑制态归属：入册/出册随本帧判定同步，restore 时只还原仍被我们压着的
    if (inFrustum) _culled.delete(obj);
    else _culled.add(obj);
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
  _culled.clear(); // 抑制态随注册表一同消亡，防跨会话残留引用了已 dispose 的根
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

/**
 * 关闭剔除时恢复**被本模块压下的**注册根可见性。
 *
 * [2026-09 修复] 原实现无条件 `root.visible = true`，与「按模型隐藏」共用同一个
 * `Object3D.visible` 布尔而互相踩踏：`sceneRegistry.setVisible(id,false)` 把
 * `roots[].visible=false` 后，本函数在**下一帧**（剔除默认关，render-host 每帧走此分支）
 * 又把同一批引用抹回 true——用户点「隐藏」闪一下即复活。
 * （roots 与 modelRoots 是同一批对象：register-built-scene 用 scene.children 差量捕获，
 * 捕获到的正是 adapter 里 scene.add + registerModelRoot 的同一个 rootGroup。）
 *
 * 现按「抑制态归属」判定：只恢复**我们压下去的**根（`_culled` 集合记录），
 * 用户/其它属主主动隐藏的根原样保留。范式对齐 postprocessing-capability 的
 * reflectorSuppressing（ADR-247 D2）——同样是「谁压下、谁还原，不覆盖他人选择」。
 */
export function restoreModelGroupsVisible(): void {
  if (_culled.size === 0) return; // 常态（剔除从没裁剪过）：零写，不做无谓 dirty
  for (const root of _culled) {
    // 仍注册着的才恢复；已注销的不再触碰（引用可能已被 adapter 复用）
    if (modelRoots.includes(root)) root.visible = true;
  }
  _culled.clear();
}
