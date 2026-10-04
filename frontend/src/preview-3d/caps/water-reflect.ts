// ===== [ADR-297 / ADR-315 D1②] 水面模型倒影（自 water-capability.ts 拆出真缝）=====
// 隐藏 Reflector 借官方 RT + 水 shader 投影采样。实例级载体状态（reflector /
// reflectorClipBias / reflWorldInv）原为 cap 私有字段；拆出后由 cap 持有
// `WaterReflectState`，本模块函数经 state 参数读写——行为零变更（纯搬运）。
import * as THREE from "three";
// ADR-297：倒影复用官方 Reflector（reflector-capability 同先例）——不允许自写镜像相机/斜裁剪。
import { Reflector } from "three/addons/objects/Reflector.js";
import { envState, isSsrRenderActive } from "@/preview-3d/state/env-state.ts";

/** 实例级倒影载体状态（cap 构造期创建一次；函数经 state 读写，不另建全局单例） */
export interface WaterReflectState {
  /** ADR-297：倒影载体——官方 Reflector 但**不挂进场景**：只借它「镜像相机 + 斜裁剪 + 整场渲进 RT」
   *  的管线，反射贴图不靠镜面展示、由水 shader 自采样（投影 + 斜率扰动 + fresnel）。首次活跃懒建。 */
  reflector: Reflector | null;
  /** [锐评 F-2] 懒建时烙进的 clipBias（schema waterReflectionClipBias，默认 3 = 原裸字面量值）。
   *  bias 烘在 Reflector.onBeforeRender 闭包里（r185 源码实证），无法就地改 uniform——
   *  ensureReflector 现读 envState 与之比对，不一致即弃载体、下拍以新 bias 重建。 */
  reflectorClipBias: number;
  /** 逐帧临时量：matrixWorld⁻¹（官方 textureMatrix 末位乘了镜面变换，输入是镜面局部坐标；
   *  水 shader 喂世界坐标，须右乘 M⁻¹ 剥回世界空间口径） */
  reflWorldInv: THREE.Matrix4;
}

/** 新建一份实例状态（cap 构造期调用，替代原三个私有字段的初始值） */
export function createWaterReflectState(): WaterReflectState {
  return {
    reflector: null,
    reflectorClipBias: -1,
    reflWorldInv: new THREE.Matrix4(),
  };
}

/** [锐评 3.5] clipBias 重建死区（单位 = clipBias 自定义量级，非米制）。
 *  schema `waterReflectionClipBias` 滑杆 step=0.1，拖满 0→10 有 ~100 个离散值——
 *  每个都触发 Reflector + RT 重建的话，单次拖动会重建百次（几何/材质/RT 三件全建）。
 *  死区 0.05：|Δbias| < 0.05 时镜像裁剪面位移肉眼不可感，跳过重建（保住内嵌 carry）。
 *  与既有纪律一致：bias 实质变化（F-2 的 1.5 偏离 = Δ1.5）仍重建。 */
const REFLECTOR_CLIP_BIAS_TOLERANCE = 0.05;

/** 倒影驱动上下文：顶水面（shader 补挂路）+ 宿主 renderer/camera + 逐帧 update 入口 */
export interface WaterReflectCtx {
  top: THREE.Mesh;
  renderer: THREE.WebGLRenderer | null;
  camera: THREE.PerspectiveCamera | null;
  /** 每帧一次反射 RT 渲染（cap.update 驱动）；cap 侧包装为 this.renderReflection */
  update: (dt: number) => void;
}

/** 倒影门控：总开关 ∧（SSR 抑制启用时 SSR 不活跃）∧ 宿主在场。
 *  ⚠️ pp* 键属 postprocessing 组，water 回调收不到派发——此处不另订第二路订阅，
 *  逐帧现读 envState 现算（真值源仍是 envState 单处，单门纪律不破）。 */
export function reflectionActive(ctx: WaterReflectCtx): boolean {
  if (!envState.waterReflectionEnabled) return false;
  if (envState.waterReflectDisableWhenSSR && isSsrRenderActive()) return false;
  // [锐评回归 2026-10-04] 水面**全透明**（film 浓度 0 / pool 不透明度 0）时倒影无意义：可见性单门后
  // wetness=0 不再隐水（`root.visible` 仍为真），若不在此门掉，开着倒影就每帧白付一次整场 RT 重渲，
  // 而画面里一滴水都没有。波相仍由 `update` 推进（廉价），只是不渲 RT。
  if (!((ctx.top.material as THREE.Material).opacity > 0)) return false;
  return ctx.renderer !== null && ctx.camera !== null;
}

/** 镜面载体懒建 / RT 原位扩缩（边长比对 O(1)，不重建 Reflector）。
 *  **不入场景**：主渲染零开销、零拾取污染；onBeforeRender 用 scope.matrixWorld 算镜像，
 *  故调用前须手动 updateMatrixWorld（无父链可赖）。
 *  [锐评 F-2] clipBias 现读 schema 键 `waterReflectionClipBias`（默认 3 = 原裸字面量，
 *  观感零变化）；bias 烘进 onBeforeRender 闭包不可就地改——现读值与懒建时烙进的
 *  `reflectorClipBias` 不一致即弃旧建新（RT/材质具名释放，不泄漏）。 */
export function ensureReflector(state: WaterReflectState): Reflector {
  const bias = envState.waterReflectionClipBias;
  // [锐评 3.5] clipBias 死区：偏差 < REFLECTOR_CLIP_BIAS_TOLERANCE 时视为未变、跳过重建。
  // 背景：`water-reflection-clip-bias` 滑杆 step=0.1，拖动 0→10 会产生 ~100 个离散值——
  // 每个都触发「弃载体 → 新 Reflector → 新 RT」整场重建（昂贵：几何 + 材质 + RT 纹理）。
  // 而 |Δbias| < 0.05 时投影裁剪面的位移肉眼不可感（clipBias 是投影视空间量，非米制）。
  // 死区仍保留「bias 实质变化 → 重建」语义（diff=0 与 diff=0.04 都不重建，符合预期）。
  if (
    state.reflector &&
    Math.abs(state.reflectorClipBias - bias) >= REFLECTOR_CLIP_BIAS_TOLERANCE
  ) {
    disposeReflector(state);
  }
  if (!state.reflector) {
    state.reflector = new Reflector(new THREE.PlaneGeometry(1, 1), {
      clipBias: bias,
      textureWidth: envState.waterReflectionResolution,
      textureHeight: envState.waterReflectionResolution,
      // [锐评 2026-10-04 P2-3] 显式关 MSAA：three 上游默认 `multisample = 4`（Reflector.js 构造），
      // 即 4× 半浮点 RT（2048 档 ≈ 134 MB，512 档 ≈ 8 MB）——而倒影经水 shader 的斜率扰动采样 +
      // fresnel 混合，边缘抗锯齿的边际收益远不抵这笔显存/带宽。schema 只按分辨率档计价，此处兜底。
      multisample: 0,
    });
    state.reflectorClipBias = bias;
    // 镜面朝上 = 水面平面（裁剪平面即该平面的无限延展，1×1 尺寸不参与数学）
    state.reflector.rotation.x = -Math.PI / 2;
  }
  const rt = state.reflector.getRenderTarget();
  const res = envState.waterReflectionResolution;
  if (rt.width !== res) rt.setSize(res, res);
  return state.reflector;
}

/** 弃倒影载体（RT + 材质 + **几何**具名释放）：bias 重建与 dispose 共用同一出口。
 *  Reflector 不入场景，disposeWater 的 traverse 遍历不到，必须在此点名释放。
 *  [锐评 2026-10-04 P3-2] 官方 `Reflector.dispose()` 只释放 RT + 材质（其 dispose 体仅
 *  `renderTarget.dispose(); scope.material.dispose();`）——**几何是构造期传入的、官方不管**；
 *  本出口补具名释放，否则每次 clipBias 重建（Δ ≥ 死区）都在堆上留一个未释放的 PlaneGeometry。
 *  实际风险很小（载体不入场景、该几何从未被渲染 ⇒ 无 GPU 缓冲泄漏），但「注释承诺 > 实现」
 *  是本仓最重视的一类漂移。 */
export function disposeReflector(state: WaterReflectState): void {
  const reflector = state.reflector;
  if (reflector) {
    const geometry = reflector.geometry;
    reflector.dispose(); // 官方：RT + 材质
    geometry?.dispose(); // 官方不含几何（构造期传入 ⇒ 调用方责任）
  }
  state.reflector = null;
  state.reflectorClipBias = -1;
}

/** 每帧一次反射 RT 渲染 + 水 shader 三 uniform 落地。
 *  ⚠️ 渲染期间临时隐藏整个水根：① 防水体进自身镜像（双层水）；② 防 pool 顶面
 *  transmission pass（three 内部再渲一遍不透明场景）在镜像通路里嵌套整场渲染。
 *  已知限制（ADR-297 记录）：RT 渲染发生在 render-host 主相机剔除之前，镜像视锥内容
 *  不受主相机 cull 影响（多渲不漏渲）；掠射角下官方「背对早退」跳帧，倒影滞后一帧再补。 */
export function renderReflection(
  state: WaterReflectState,
  waterRoot: THREE.Object3D,
  scene: THREE.Scene,
  ctx: WaterReflectCtx,
): void {
  const topMaterial = ctx.top.material as THREE.Material & {
    userData?: { shader?: THREE.WebGLProgramParametersWithUniforms };
  };
  const shader = topMaterial.userData?.shader;
  if (!reflectionActive(ctx)) {
    // 非活跃：权重归零（开关只翻 uniform，不触发 program 重编译；混合块整体跳过）
    if (shader) (shader.uniforms.uReflStrength as { value: number }).value = 0;
    return;
  }
  const renderer = ctx.renderer as THREE.WebGLRenderer;
  const camera = ctx.camera as THREE.PerspectiveCamera;
  const reflector = ensureReflector(state);
  // 镜面即水面：clip 平面 = Reflector 平面本身，水位升降一个标量跟随
  reflector.position.y = envState.waterLevel;
  reflector.updateMatrixWorld(true);
  // [锐评 2026-10-04 P3-2 订正] 官方 onBeforeRender 读 `camera.matrixWorld`，此处刷新保证矩阵与
  // 已写入的 position/quaternion 一致（防「属性已改、矩阵未更新」）。⚠️ 但它**消除不了**跨帧输入
  // 滞后：RT 渲发生在 render-host 的 caps.update 段，早于本帧 WASD 相机输入与 perFrame 回调
  // （见 render-host.ts 的调用序），故镜像相机读到的仍是上一帧末的输入。原注释称「否则镜像滞后
  // 一帧抖动」，把两件事的功劳记混了——真要消除滞后须把 RT 渲染移到相机输入之后（结构性调整，另议）。
  camera.updateMatrixWorld();
  const prevVisible = waterRoot.visible;
  waterRoot.visible = false;
  try {
    // Reflector 自有实现只吃三参（Object3D 契约的 geometry/material/group 三尾参不参与
    // 镜像数学，见 Reflector.js onBeforeRender 函数体）；声明层继承六参签名，此处收窄
    const drive = reflector.onBeforeRender as unknown as (
      r: THREE.WebGLRenderer,
      s: THREE.Scene,
      c: THREE.Camera,
    ) => void;
    drive.call(reflector, renderer, scene, camera);
  } finally {
    waterRoot.visible = prevVisible;
  }
  // shader 未编译时由 onBeforeCompile 尾部的同源调用补挂（不另等一帧）
  if (shader) applyReflectionUniforms(shader, reflector, state);
}

/** RT 贴图 + 强度 + 世界→RT uv 矩阵一次落地（renderReflection 帧路与 onBeforeCompile
 *  补挂路共用——新材质编译入场的同一拍即重绑，不滞后一帧）。
 *  [锐评 L-3 收口] 原 `setReflectionUniforms(shader, strength)` 是「写死 0 归零」与
 *  「现读强度赋值」两条路各写一遍的公共出口，归零路唯一调用点即此处内联，两函数
 *  一合并（少一层跳转，强度真值源仍唯一 = envState.waterReflectionStrength）。 */
export function applyReflectionUniforms(
  shader: THREE.WebGLProgramParametersWithUniforms,
  reflector: Reflector,
  state: WaterReflectState,
): void {
  const u = shader.uniforms;
  (u.uReflTex as { value: THREE.Texture | null }).value = reflector.getRenderTarget().texture;
  (u.uReflStrength as { value: number }).value = envState.waterReflectionStrength;
  // 官方 textureMatrix = bias·P·V·M(镜面)（输入为镜面局部坐标）；水 shader 喂世界坐标，
  // 右乘 M⁻¹ 剥除镜面自身变换。bias 已在矩阵内 → 除 w 后直接是 uv（0..1）。
  const texMat = (reflector.material as THREE.ShaderMaterial).uniforms.textureMatrix
    .value as THREE.Matrix4;
  state.reflWorldInv.copy(reflector.matrixWorld).invert();
  (u.uReflMatrix as { value: THREE.Matrix4 }).value.multiplyMatrices(texMat, state.reflWorldInv);
}
