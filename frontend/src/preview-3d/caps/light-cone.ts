// ===== VolumetricCone — 体积光锥体（ADR-177 拆分：职责②从 LightCapability 抽离）=====
// 原 LightCapability 内嵌的锥体实现（shader + 几何 + 材质 + 挂载状态机）整体迁入本类，
// 使「双引擎抽象」的 cone 引擎成为自包含单元。公开类 LightCapability 持本类实例并委派。
// 挂载判定语义与原实现逐行对齐（light-capability.test.ts 的锥组状态机用例为契约）。

import * as THREE from "three";
import { dbg } from "../../utils/debug/debug.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { safeDispose } from "../safe-dispose.ts";
import type { SpotlightParams, VolumetricParams } from "./light-presets.ts";

/** 角度(度)→弧度；内联等价 THREE.MathUtils.degToRad */
const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/* ============ 体积光锥 shader（两交叉 PlaneGeometry + Cone 遮罩） ============ */

const VOLUMETRIC_CONE_VERT = `
  varying float vY;
  varying float vX;
  varying float vZ;
  void main() {
    vY = position.y;
    vX = position.x;
    vZ = position.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOLUMETRIC_CONE_FRAG = `
  precision highp float;
  varying float vY;
  varying float vX;
  varying float vZ;
  uniform vec3 uColor;
  uniform float uMaxAlpha;
  uniform float uFogPower;
  uniform float uEdgeFade;
  uniform float uHeight;
  uniform float uBaseRadius;
  uniform float uTipStrength;
  uniform float uBaseStrength;

  void main() {
    // h = 0 底部（base），h = 1 顶部（tip）
    float h = (vY + uHeight * 0.5) / uHeight;
    // 当前高度处锥面半径：底部 uBaseRadius → 顶部 0
    float rAtH = uBaseRadius * (1.0 - h);
    float d = sqrt(vX * vX + vZ * vZ);
    if (d > rAtH) discard;
    if (rAtH < 0.0001) discard; // 锥顶退化为点，无内容可渲染

    // 垂直强度：底部与顶部之间的插值
    float vertIntensity = mix(uBaseStrength, uTipStrength, h);
    // 空气散射（fog）：指数衰减从底部到顶部
    float airFalloff = exp(-uFogPower * h);
    // 径向羽化：中心 → 1.0，边缘 → (1 - edgeFade)
    float rNorm = d / rAtH;
    float radialFalloff = 1.0 - rNorm * uEdgeFade;

    float alpha = uMaxAlpha * vertIntensity * airFalloff * radialFalloff;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

interface VolumetricConeUniforms {
  uColor: { value: THREE.Color };
  uMaxAlpha: { value: number };
  uFogPower: { value: number };
  uEdgeFade: { value: number };
  uHeight: { value: number };
  uBaseRadius: { value: number };
  uTipStrength: { value: number };
  uBaseStrength: { value: number };
}

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
 * 体积光锥体：两交叉 PlaneGeometry + Cone 遮罩 shader（轻量，无 post-process 管线）。
 * 状态（group / uniforms / material / height）完全内聚于本类；对外只暴露基于
 * spotlight 参数 + 聚光位置的纯操作，不反向依赖 LightCapability。
 */
export class VolumetricCone {
  private scene: THREE.Scene;
  private group: THREE.Group | null = null;
  private uniforms: VolumetricConeUniforms | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private height = 0;

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
   * spotlightPos 用于挂载定位（锥组底对齐聚光灯正下方）。
   */
  rebuild(
    height: number,
    sp: SpotlightParams,
    vm: VolumetricParams,
    spotlightPos: THREE.Vector3,
  ): void {
    this.disposeGroup();
    if (!sp.enabled || !vm.enabled) return;

    this.height = height;
    const halfAngle = degToRad(sp.angle);
    const baseRadius = height * Math.tan(halfAngle) * (1.0 + sp.penumbra * 0.5);

    const mat = this.createMaterial(height, baseRadius, sp, vm);
    this.group = this.buildGroup(mat, height, baseRadius, spotlightPos);
  }

  private createMaterial(
    height: number,
    baseRadius: number,
    sp: SpotlightParams,
    vm: VolumetricParams,
  ): THREE.ShaderMaterial {
    const uniforms: VolumetricConeUniforms = {
      uColor: { value: new THREE.Color(sp.color) },
      uMaxAlpha: { value: vm.opacity },
      uFogPower: { value: vm.fogPower },
      uEdgeFade: { value: vm.edgeFade },
      uHeight: { value: height },
      uBaseRadius: { value: baseRadius },
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
  ): THREE.Group {
    const halfWidth = baseRadius;
    const geom = new THREE.PlaneGeometry(halfWidth * 2, height);

    const plane1 = new THREE.Mesh(geom, mat);
    const plane2 = new THREE.Mesh(geom, mat);
    plane2.rotation.y = Math.PI / 2;

    const group = new THREE.Group();
    group.name = "ysm-light-volumetric-cone";
    group.add(plane1);
    group.add(plane2);

    group.position.copy(spotlightPos);
    group.position.y -= height / 2;
    return group;
  }

  /** 更新现有材质 uniforms（setVolumetric 走此路径，不重建几何） */
  updateUniforms(sp: SpotlightParams, vm: VolumetricParams): void {
    if (!this.uniforms || !this.material) return;
    this.uniforms.uColor.value.setHex(sp.color);
    this.uniforms.uMaxAlpha.value = vm.opacity;
    this.uniforms.uFogPower.value = vm.fogPower;
    this.uniforms.uEdgeFade.value = vm.edgeFade;
    this.uniforms.uTipStrength.value = vm.tipStrength;
    this.uniforms.uBaseStrength.value = vm.baseStrength;
  }

  /**
   * 挂入场景并对齐聚光灯（幂等：已在场景中则只同步位置）。
   * 供 rebuild 换新实例后的回挂使用——rebuild 只负责建，不负责挂载。
   */
  attach(spotlightPos: THREE.Vector3): void {
    if (!this.group) return;
    if (!this.group.parent) this.scene.add(this.group);
    this.syncPosition(spotlightPos);
  }

  /** 从场景移除锥组 */
  detach(): void {
    if (this.group?.parent) this.group.parent.remove(this.group);
  }

  /** 仅同步锥组位置（setTarget 走此路径） */
  syncPosition(spotlightPos: THREE.Vector3): void {
    if (!this.group) return;
    this.group.position.copy(spotlightPos);
    this.group.position.y -= this.height / 2;
  }

  /** 释放锥组几何/材质（detach 后调用，幂等） */
  dispose(): void {
    this.disposeGroup();
    this.material = null;
    this.uniforms = null;
  }

  private disposeGroup(): void {
    if (!this.group) return;
    if (this.group.parent) this.group.parent.remove(this.group);
    // 两 plane 共享同一 geometry+material（buildGroup），traverse 会重复 dispose
    // 同一实例——P1 double-dispose。用 Set 按 uuid 去重，每个唯一实例只 dispose 一次。
    const seenGeo = new Set<string>();
    const seenMat = new Set<string>();
    this.group.traverse((obj) => {
      const m = obj as THREE.Mesh;
      const geo = m.geometry;
      if (geo) {
        const id = geo.uuid;
        if (!seenGeo.has(id)) {
          seenGeo.add(id);
          safeDispose(geo);
        }
      }
      const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (mat) {
        const mats = Array.isArray(mat) ? mat : [mat];
        for (const mt of mats) {
          if (!mt) continue;
          const id = mt.uuid;
          if (!seenMat.has(id)) {
            seenMat.add(id);
            tryDisposeMat(mt);
          }
        }
      }
    });
    this.group = null;
  }
}
