// ===== SunBeams — 日落光束 + 暖色 overlay（拆轴自 sky-capability.ts）=====
// 原 SkyCapability 内嵌的 God Rays（两交叉锥形光束，ADR-107）与 Sunset Tint
// （地平线暖色渐变 overlay）整体迁入本类。二者强耦合——tint 强度 = godRays 强度
// 曲线、挂载决策共享（intensity>0 && enabled 同挂同卸）、detach/dispose 同步清理，
// 故合成一个自包含类而非拆两个文件（拆两会引入类间协调，违反 light-cone 先例的
// 「状态完全内聚、不反向依赖宿主」原则）。
// 宿主 SkyCapability 持本类实例并委派；挂载判定语义与原实现逐行对齐
// （sky-capability.test.ts 的 God Rays 挂载分支用例为契约）。

import * as THREE from "three";
import { disposeObject3D } from "@/preview-3d/safe-dispose.ts";
import { ENV_PRESETS } from "./environment-state.ts";

/** 角度(度)→弧度；内联等价 THREE.MathUtils.degToRad */
const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * god rays / sunset tint 共用强度曲线（0~1；太阳高度角 >20° 时无光束）。
 * 纯函数：elevation 低于 20° 越接近地平线强度越高，(20-e)/30 clamp 到 [0,1]。
 */
export function godRaysIntensity(elevation: number): number {
  if (elevation > 20) return 0;
  return Math.min(1, Math.max(0, (20 - elevation) / 30));
}

/* ============ 光束锥体 shader（两交叉 PlaneGeometry，垂直羽化 + 径向衰减 + shimmer） ============ */

const CONE_VERT = `
  #include <common>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CONE_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;

  void main() {
    float verticalFade = 1.0 - vUv.y;
    verticalFade = pow(verticalFade, 1.5);
    float radialDist = abs(vUv.x - 0.5) * 2.0;
    float radialFade = 1.0 - radialDist * radialDist;
    float shimmer = sin(uTime * 2.0 + vUv.y * 6.28) * 0.05 + 1.0;
    float alpha = uIntensity * verticalFade * radialFade * shimmer;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/* ============ Sunset Tint overlay shader（太阳方向加强的地平线暖色渐变） ============ */

const TINT_VERT = `
  #include <common>
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TINT_FRAG = `
  precision highp float;
  varying vec3 vDir;
  uniform float uIntensity;
  uniform vec3 uSunPosition;
  uniform vec3 uTintHorizon;
  uniform vec3 uTintZenith;

  void main() {
    vec3 dir = normalize(vDir);
    // 地平线混合：direction.y 越低越接近地平线
    float horizonBlend = max(0.0, 1.0 - dir.y);
    // 太阳方向加强：靠近太阳的方向 tint 更强
    float sunProximity = max(0.0, dot(dir, normalize(uSunPosition)));
    float sunBoost = smoothstep(-0.5, 1.0, sunProximity);
    // 综合 tint 强度
    float tintStrength = uIntensity * mix(horizonBlend * 0.8, 1.0, sunBoost * 0.3);
    vec3 tintColor = mix(uTintZenith, uTintHorizon, horizonBlend);
    gl_FragColor = vec4(tintColor * tintStrength, tintStrength * 0.6);
  }
`;

/** sunPos 与 writeUniforms 同公式重建：phi=90-elevation、theta=azimuth 的球面单位向量 */
function sunDirFromAngles(elevation: number, azimuth: number): THREE.Vector3 {
  const phi = degToRad(90 - elevation);
  const theta = degToRad(azimuth);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

/**
 * 日落光束视觉组：两交叉光束锥体（God Rays）+ 太阳方向暖色 overlay（Sunset Tint）。
 * 状态（group / tintMesh / time / enabled）完全内聚于本类；对外只暴露基于
 * 太阳角度 + dt 的纯操作，不反向依赖 SkyCapability。scale 为天空盒半边长
 * （构造期快照：锥体/overlay 尺寸随其缩放，与原实现一致——运行期 skyScale
 * 变更不重建，宿主原有行为）。
 */
export class SunBeams {
  private scene: THREE.Scene;
  private enabled = false;
  /** 光束锥组（两交叉 mesh 共享材质）。仅挂载态观察/释放判定用，勿直接修改 */
  group: THREE.Group | null = null;
  /** 日落 tint overlay mesh。仅挂载态观察/释放判定用，勿直接修改 */
  tintMesh: THREE.Mesh | null = null;
  /** 光束 shimmer 动画时钟（shader uTime 引用同一对象，tick 推进） */
  time: { value: number };

  constructor(scene: THREE.Scene, scale: number) {
    this.scene = scene;
    this.time = { value: 0 };
    this.group = this.buildConeGroup(scale);
    this.tintMesh = this.buildTintMesh(scale * 0.999); // 略小于 sky，避免 z-fighting
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 切换光束开关（对齐原 setGodRaysEnabled → updateGodRays 的 disabled 分支）：
   * 关闭时只摘除光束锥组（tint overlay 保持原挂载态，等下一次 sync 的
   * intensity 判定收口——原实现同款怪癖，重构保持等价）；开启只翻标志，
   * 实际挂载随下一次 sync() 按 intensity 判定。
   */
  setEnabled(v: boolean): void {
    if (this.enabled === v) return;
    this.enabled = v;
    if (!v) this.unmountCones();
  }

  /**
   * 核心同步（对齐原 updateGodRays + updateSunsetTint 成对语义）：
   * 按太阳角度旋转光束锥组、计算 intensity、决策锥组与 tint overlay 的
   * 挂载/卸载、刷新 tint overlay uniform。宿主在太阳位置变化 / 开关切换 /
   * apply 后调用。
   */
  sync(elevation: number, azimuth: number): void {
    // disabled 分支：只摘锥组并隐藏（tint 不动——原 updateGodRays 同款）
    if (!this.enabled || !this.group) {
      this.unmountCones();
      return;
    }
    const elRad = degToRad(elevation);
    // 旋转 group：先绕 X 轴调整仰角，再绕 Y 轴调整方位
    this.group.rotation.x = -elRad; // 负：仰角越高，beam 越往下压
    this.group.rotation.y = degToRad(azimuth - 90); // 0°=东, 90°=南

    const intensity = godRaysIntensity(elevation);
    // 更新光束 intensity uniform
    const mesh0 = this.group.children[0] as THREE.Mesh;
    if (mesh0.material instanceof THREE.ShaderMaterial && mesh0.material.uniforms?.uIntensity) {
      mesh0.material.uniforms.uIntensity.value = intensity;
    }
    // 光束锥组挂载决策
    if (intensity > 0 && !this.group.parent) {
      // 挂载时初始化颜色为 sunset 预设的 sunColor
      const mat = this.group.children[0] as THREE.Mesh;
      if (mat.material instanceof THREE.ShaderMaterial) {
        mat.material.uniforms.uColor.value.copy(this.godRaysColor());
      }
      this.scene.add(this.group);
      this.group.visible = true;
    } else if (intensity === 0 && this.group.parent) {
      this.group.parent.remove(this.group);
      this.group.visible = false;
    }

    // tint overlay 挂载决策（与光束同决策：intensity>0 挂、=0 卸）
    if (intensity > 0 && this.tintMesh && !this.tintMesh.parent) {
      this.scene.add(this.tintMesh);
      this.tintMesh.visible = true;
    } else if (this.tintMesh && intensity === 0 && this.tintMesh.parent) {
      this.tintMesh.parent.remove(this.tintMesh);
      this.tintMesh.visible = false;
    }
    // 刷新 tint overlay uniform（原 updateSunsetTint：强度 + 太阳方向）
    if (this.tintMesh) {
      const mat = this.tintMesh.material as THREE.ShaderMaterial;
      if (mat.uniforms) {
        mat.uniforms.uIntensity.value = intensity;
        mat.uniforms.uSunPosition.value.copy(sunDirFromAngles(elevation, azimuth));
      }
    }
  }

  /** 推进光束 shimmer 动画时钟（宿主 update(dt) 每帧调用，独立于昼夜循环活着） */
  tick(dt: number): void {
    this.time.value += dt;
  }

  /** 从场景摘除光束 + tint overlay（宿主 detach 时调用；不动 enabled 标志） */
  detach(): void {
    this.unmountCones();
    if (this.tintMesh?.parent) {
      this.tintMesh.parent.remove(this.tintMesh);
      this.tintMesh.visible = false;
    }
  }

  /** 释放几何/材质（detach 后调用，幂等；disposeObject3D uuid 去重防共享材质 double-dispose） */
  dispose(): void {
    disposeObject3D(this.group);
    this.group = null;
    disposeObject3D(this.tintMesh);
    this.tintMesh = null;
  }

  /** 光束挂载色（跟随 sunset 预设的 sunColor，最贴合日出日落光束） */
  private godRaysColor(): THREE.Color {
    return new THREE.Color(ENV_PRESETS.sunset.sunColor);
  }

  private unmountCones(): void {
    if (this.group?.parent) {
      this.group.parent.remove(this.group);
      this.group.visible = false;
    }
  }

  private buildConeGroup(scale: number): THREE.Group {
    const width = scale * 0.3;
    const height = scale * 0.4;

    const geo1 = new THREE.PlaneGeometry(width, height, 1, 1);
    const geo2 = new THREE.PlaneGeometry(width, height, 1, 1);
    const material = this.createConeShaderMaterial();

    const mesh1 = new THREE.Mesh(geo1, material);
    const mesh2 = new THREE.Mesh(geo2, material);
    mesh2.rotation.z = Math.PI / 2;

    mesh1.position.y = height * 0.5;
    mesh2.position.y = height * 0.5;

    const group = new THREE.Group();
    group.add(mesh1);
    group.add(mesh2);
    group.visible = false;
    return group;
  }

  private createConeShaderMaterial(): THREE.ShaderMaterial {
    const uniforms = {
      uColor: { value: new THREE.Color(1.0, 0.7, 0.3) },
      uIntensity: { value: 0 },
      uTime: this.time,
    };

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: CONE_VERT,
      fragmentShader: CONE_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private buildTintMesh(scale: number): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(scale, scale);
    const sunsetPreset = ENV_PRESETS.sunset;
    const uniforms = {
      uIntensity: { value: 0 },
      uSunPosition: { value: new THREE.Vector3() },
      uTintHorizon: { value: new THREE.Color(sunsetPreset.horizon) }, // 0xff8a5c 橙
      uTintZenith: { value: new THREE.Color(sunsetPreset.zenith) }, // 0x2a1855 暗蓝紫
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: TINT_VERT,
      fragmentShader: TINT_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    return mesh;
  }
}
