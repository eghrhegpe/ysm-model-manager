// ===== VolumetricCone — 体积光锥体（ADR-177 拆分：职责②从 LightCapability 抽离）=====
// 原 LightCapability 内嵌的锥体实现（shader + 几何 + 材质 + 挂载状态机）整体迁入本类，
// 使「双引擎抽象」的 cone 引擎成为自包含单元。公开类 LightCapability 持本类实例并委派。
// 挂载判定语义与原实现逐行对齐（light-capability.test.ts 的锥组状态机用例为契约）。
//
// [2026-09-18 设计审核修复] 从「两片交叉 PlaneGeometry + discard 抠锥」换为真锥体网格：
//   · 十字片只是锥的剪影：侧 45° 视角两片双双 edge-on → 光柱近乎消失；
//   · 相机穿过锥体时两片内壁 additive 叠加 → 中央亮竖缝伪影；
//   · 模型贴近锥面时体积光只沿两平面与模型相交 → 光柱像剪纸穿过实体。
//   真锥体（ConeGeometry 48×4 段，openEnded）在任何视角都有正确的侧壁轮廓，双面渲染叠出厚度。
//   同批修复两处：
//   ① ACES 旁路——自定义 shader 不注入 tonemapping/输出色彩空间转换，加色以线性值直写屏幕，
//      亮处硬裁并以超亮值喂 bloom 阈值；现补 <tonemapping_fragment> + <colorspace_fragment>。
//   ② 「恒垂直向下」写死——锥体朝向改由「聚光灯 → 靶点」方向驱动（见 rebuild 的 spotlightDir），
//      默认俯视灯下与旧行为逐像素等价，灯一旦可倾斜锥体自动跟随。
//   视角相关边缘辉光复用 three 内置 uniform cameraPosition（renderer 每帧喂），无需外部每帧接线。

import * as THREE from "three";
import { disposeObject3D, safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { dbg } from "@/utils/debug/debug.ts";
import type { LightInstanceParams, VolumetricParams } from "./light-presets.ts";

/* ============ 体积光锥 shader（真锥体网格 + 轴向衰减 + Fresnel 边缘辉光） ============ */

const VOLUMETRIC_CONE_VERT = `
  varying float vY;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main() {
    vY = position.y;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    // 锥组只有平移 + 旋转（无缩放），mat3(modelMatrix) 即法线矩阵
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOLUMETRIC_CONE_FRAG = `
  precision highp float;
  varying float vY;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  uniform vec3 uColor;
  uniform float uMaxAlpha;
  uniform float uFogPower;
  uniform float uEdgeFade;
  uniform float uHeight;
  uniform float uTipStrength;
  uniform float uBaseStrength;

  void main() {
    // h = 0 底面（远端，光落在对象上），h = 1 锥顶（光源处）——与旧十字片实现同式，
    // 「底部强度/顶部强度/上下亮度比/空气散射」四个滑块语义不变。
    float h = (vY + uHeight * 0.5) / max(uHeight, 0.0001);
    // 垂直强度：底面与锥顶之间的插值
    float vertIntensity = mix(uBaseStrength, uTipStrength, h);
    // 空气散射（fog）：指数衰减，fogPower 越大越集中底部
    float airFalloff = exp(-uFogPower * h);

    // Fresnel 边缘辉光：视线越掠射（锥面侧壁轮廓）越亮——真锥体「实体感」的来源，
    // 取代旧实现按截面上半径压暗的 radialFalloff（平面剪影才有的概念）。
    // edgeFade=0 → 均匀壳；edgeFade=1 → 边缘辉光主导（细亮壳）。
    // 视线方向与 three 自身 chunk（envmap_fragment）同款：正交相机取 viewMatrix 第三行。
    vec3 viewDir = isOrthographic
      ? normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]))
      : normalize(cameraPosition - vWorldPos);
    // DualSide 下背面法线反向 → abs() 拉回，两面辉光对称
    float NdotV = abs(dot(normalize(vWorldNormal), viewDir));
    float fresnel = pow(clamp(1.0 - NdotV, 0.0, 1.0), 1.0 + uEdgeFade * 2.0);
    float shell = mix(1.0, 0.12 + 0.88 * fresnel, uEdgeFade);

    float alpha = uMaxAlpha * vertIntensity * airFalloff * shell;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(uColor * alpha, alpha);
    // 场景其余部分走 ACESFilmic + 输出色彩空间转换；ShaderMaterial 不会自动注入这两个 chunk，
    // 旧实现因此旁路色调映射（亮处硬裁 + 异常喂 bloom 阈值）。缺省 material.toneMapped=true
    // 时 renderer 已注入 TONE_MAPPING 宏与 linearToOutputTexel()，此处只需调用。
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface VolumetricConeUniforms {
  uColor: { value: THREE.Color };
  uMaxAlpha: { value: number };
  uFogPower: { value: number };
  uEdgeFade: { value: number };
  uHeight: { value: number };
  uTipStrength: { value: number };
  uBaseStrength: { value: number };
}

/** 真锥体细分（radial × height）——48 段侧壁足以让边缘辉光平滑，成本约 384 三角形 */
const CONE_RADIAL_SEGMENTS = 48;
const CONE_HEIGHT_SEGMENTS = 4;

/** 默认射束方向（垂直向下）——未显式给出朝向时的兜底（历史行为：聚光灯恒俯视） */
const DEFAULT_BEAM_DIR = new THREE.Vector3(0, -1, 0);

/** 局部 +Y（锥顶指向）的对齐基准 */
const LOCAL_UP = new THREE.Vector3(0, 1, 0);

/** 朝向计算暂存（避免每次 sync 分配；本类单实例持有，无重入） */
const _beamDir = new THREE.Vector3();
const _beamUp = new THREE.Vector3();

/** 材质上所有可能持有贴图的属性 key */
const ALL_TEX_KEYS = [
  "map",
  "emissiveMap",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "lightMap",
  "alphaMap",
  "envMap",
] as const;

function tryDisposeMat(m: THREE.Material): void {
  try {
    for (const key of ALL_TEX_KEYS) {
      const tex = (m as unknown as Record<string, unknown | THREE.Texture | null>)[key];
      if (tex && typeof (tex as THREE.Texture).dispose === "function") {
        safeDispose(tex as THREE.Texture);
      }
    }
    m.dispose();
  } catch (e) {
    // 不再静默吞掉：材质释放失败是 GPU 泄漏的高危信号，留痕便于排查
    dbg("light-cone", {
      op: "tryDisposeMat-fail",
      type: m.type,
      uuid: m.uuid,
      err: safeErrorMessage(e),
    });
  }
}

/**
 * 体积光锥体：真锥体网格（ConeGeometry）+ 轴向衰减 + Fresnel 视角边缘辉光
 * （轻量，无 post-process 管线）。状态（group / uniforms / material / height）完全内聚于本类；
 * 对外只暴露基于 spotlight 参数 + 聚光位置/方向的纯操作，不反向依赖 LightCapability。
 */
export class VolumetricCone {
  private scene: THREE.Scene;
  private group: THREE.Group | null = null;
  private uniforms: VolumetricConeUniforms | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private height = 0;
  /** 最近一次同步的射束方向（世界，光源 → 靶点）——syncPosition 复用，避免重算 */
  private beamDir = new THREE.Vector3(0, -1, 0);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** 当前是否已有锥组实例（与挂载态无关） */
  hasGroup(): boolean {
    return this.group !== null;
  }

  /** 锥组是否已挂入场景 */
  isMounted(): boolean {
    return Boolean(this.group?.parent);
  }

  /**
   * 根据当前参数重建锥组几何 + 材质。spotlight / volumetric 未同时启用时产出空（group 为 null）。
   * spotlightPos 为锥顶位置；spotlightDir 为射束方向（世界，光源 → 靶点，缺省垂直向下），
   * 锥体沿该方向延伸并对齐（旧实现在几何上写死垂直向下，灯一倾斜即与真实光锥脱钩）。
   */
  rebuild(
    height: number,
    sp: LightInstanceParams,
    vm: VolumetricParams,
    spotlightPos: THREE.Vector3,
    spotlightDir: THREE.Vector3 = DEFAULT_BEAM_DIR,
  ): void {
    this.disposeGroup();
    if (!sp.enabled || !vm.enabled) return;

    this.height = height;
    const halfAngle = THREE.MathUtils.degToRad(sp.angle);
    const baseRadius = height * Math.tan(halfAngle) * (1.0 + sp.penumbra * 0.5);

    const mat = this.createMaterial(height, sp, vm);
    this.group = this.buildGroup(mat, height, baseRadius, spotlightPos, spotlightDir);
  }

  private createMaterial(
    height: number,
    sp: LightInstanceParams,
    vm: VolumetricParams,
  ): THREE.ShaderMaterial {
    const uniforms: VolumetricConeUniforms = {
      uColor: { value: new THREE.Color(sp.color) },
      uMaxAlpha: { value: vm.opacity },
      uFogPower: { value: vm.fogPower },
      uEdgeFade: { value: vm.edgeFade },
      uHeight: { value: height },
      uTipStrength: { value: vm.tipStrength },
      uBaseStrength: { value: vm.baseStrength },
    };
    this.uniforms = uniforms;

    this.material = new THREE.ShaderMaterial({
      uniforms: uniforms as unknown as Record<string, THREE.IUniform<unknown>>,
      vertexShader: VOLUMETRIC_CONE_VERT,
      fragmentShader: VOLUMETRIC_CONE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    return this.material;
  }

  private buildGroup(
    mat: THREE.ShaderMaterial,
    height: number,
    baseRadius: number,
    spotlightPos: THREE.Vector3,
    spotlightDir: THREE.Vector3,
  ): THREE.Group {
    // ConeGeometry：锥顶在 +Y（局部 +height/2）、底面圆在 -Y，与「锥顶贴光源、锥底落在对象」
    // 的布局一致；openEnded=true 去掉底面封盖（光柱不该有底盖，否则对象上方出现一片亮盘）。
    const geom = new THREE.ConeGeometry(
      baseRadius,
      height,
      CONE_RADIAL_SEGMENTS,
      CONE_HEIGHT_SEGMENTS,
      true,
    );

    const mesh = new THREE.Mesh(geom, mat);
    const group = new THREE.Group();
    group.name = "ysm-light-volumetric-cone";
    group.add(mesh);

    this.applyTransform(group, spotlightPos, spotlightDir);
    return group;
  }

  /** 锥组定位 + 朝向：锥顶贴 spotlightPos，锥体沿射束方向延伸 */
  private applyTransform(
    group: THREE.Group,
    spotlightPos: THREE.Vector3,
    spotlightDir: THREE.Vector3,
  ): void {
    // 退化方向（光源与靶点重合）兜底为垂直向下，区别于「朝向错乱」
    _beamDir.copy(spotlightDir);
    if (_beamDir.lengthSq() < 1e-12) _beamDir.copy(DEFAULT_BEAM_DIR);
    _beamDir.normalize();
    this.beamDir.copy(_beamDir);

    // 局部 +Y（锥顶指向）对齐射束反向；垂直向下时 -dir = +Y → 单位四元数（旧行为逐像素等价）。
    // 同向分支的退化处理由 three 内部负责（setFromUnitVectors 结尾自带 normalize，r<1e-8 分支兜反向）
    _beamUp.copy(_beamDir).negate();
    group.quaternion.setFromUnitVectors(LOCAL_UP, _beamUp);
    // 几何中心 = 锥顶 + 半高 · 射束方向。
    // 注意符号：ConeGeometry 的锥顶在局部 +Y（向上），而射束向下延伸，故中心须落在
    // 锥顶沿射束「正向」半高处（垂直向下时即 spotlightPos.y - height/2，与旧实现等价）。
    group.position.copy(spotlightPos).addScaledVector(_beamDir, this.height / 2);
  }

  /** 更新现有材质 uniforms（setVolumetric 走此路径，不重建几何） */
  updateUniforms(sp: LightInstanceParams, vm: VolumetricParams): void {
    if (!this.uniforms || !this.material) return;
    this.uniforms.uColor.value.setHex(sp.color);
    this.uniforms.uMaxAlpha.value = vm.opacity;
    this.uniforms.uFogPower.value = vm.fogPower;
    this.uniforms.uEdgeFade.value = vm.edgeFade;
    this.uniforms.uTipStrength.value = vm.tipStrength;
    this.uniforms.uBaseStrength.value = vm.baseStrength;
  }

  /**
   * 挂入场景并对齐聚光灯（幂等：已在场景中则只同步位置/朝向）。
   * 供 rebuild 换新实例后的回挂使用——rebuild 只负责建，不负责挂载。
   */
  attach(spotlightPos: THREE.Vector3, spotlightDir?: THREE.Vector3): void {
    if (!this.group) return;
    if (!this.group.parent) this.scene.add(this.group);
    this.syncPosition(spotlightPos, spotlightDir);
  }

  /** 从场景移除锥组 */
  detach(): void {
    if (this.group?.parent) this.group.parent.remove(this.group);
  }

  /** 仅同步锥组位置/朝向（setTarget 走此路径） */
  syncPosition(spotlightPos: THREE.Vector3, spotlightDir?: THREE.Vector3): void {
    if (!this.group) return;
    this.applyTransform(this.group, spotlightPos, spotlightDir ?? this.beamDir);
  }

  /** 释放锥组几何/材质（detach 后调用，幂等） */
  dispose(): void {
    this.disposeGroup();
    this.material = null;
    this.uniforms = null;
  }

  private disposeGroup(): void {
    if (!this.group) return;
    // 释放逻辑已上收 safe-dispose.disposeObject3D（uuid 去重防共享实例 double-dispose，
    // disposeMaterial=tryDisposeMat 连带清扫材质贴图槽位——opt-in 防误伤子树外共享贴图）
    disposeObject3D(this.group, { detach: true, disposeMaterial: tryDisposeMat });
    this.group = null;
  }
}
