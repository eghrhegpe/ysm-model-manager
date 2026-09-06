// ===== ReflectorCapability：反光地面能力（ADR-073 caps/ 能力模式）=====
// 复用 Three 官方 Reflector（three/addons/objects/Reflector.js），不允许自写镜像相机/RTV shader。
// 与 ShadowCapability / GroundCapability 的分层共存：Shadow 走 cameraSize 正交视锥无承接平面；
// Reflector 平面按 GROUND_LAYER_OFFSETS.reflector 下沉（位于 ground 承接面之下，z-fighting 防御）
// Reflector 是一个透明 mesh + 背面镜像 WebGLRenderTarget，draw call 代价不低（约等于再渲染一次场景），
// 默认关闭，用户显式开启；模型类别预设给出建议参数。

import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import type { PreviewMenuNode } from "../menu-node-types.ts";
import { buildReflectorNodes } from "./reflector-menu.ts";
import {
  GROUND_LAYER_OFFSETS,
  persistState,
  restoreFields,
  restoreState,
  ringLog,
  type SceneCapability,
} from "./scene-capability.ts";

export interface ReflectorParams {
  enabled: boolean;
  /** 地面平面尺寸（世界单位）*/
  size: number;
  /** 镜面渲染目标分辨率（越大越精细，开销越大） */
  resolution: number;
  /** 镜面色调（白色=纯反射；浅灰=柔和；蓝色=冷调） */
  color: number;
  /** 反射强度（0~1；1 = 完全镜像，0 = 不可见） */
  opacity: number;
  /** clipBias：反射平面 z-fighting 与对象近距裁剪的折中值（0.001~0.01 常见） */
  clipBias: number;
}

export const DEFAULT_REFLECTOR_PARAMS: ReflectorParams = {
  enabled: false,
  size: 100,
  resolution: 1024,
  color: 0xffffff,
  opacity: 0.6,
  clipBias: 0.003,
};

/** 模型类别反光预设：反光强度按材质风格适配（toon 不要强反射，PBR 角色中等，方块/体素弱） */
export const REFLECTOR_PRESETS: Record<string, Partial<ReflectorParams>> = {
  default: { ...DEFAULT_REFLECTOR_PARAMS },
  ysm: {
    // 方块：弱反射，避免镜面太强抢主体
    opacity: 0.25,
    size: 200,
    resolution: 512,
    color: 0xf0f4fa,
  },
  vrm: {
    // PBR 角色：中等反射 + 暖调
    opacity: 0.5,
    size: 60,
    resolution: 1024,
    color: 0xf8efe2,
  },
  mmd: {
    // toon：更弱，避免高光与反射冲突
    opacity: 0.2,
    size: 80,
    resolution: 1024,
    color: 0xfafcff,
  },
  litematic: {
    // 体素：大平面 + 冷调
    opacity: 0.25,
    size: 500,
    resolution: 512,
    color: 0xeaf1fb,
  },
  resourcepack: {
    // MC 方块：同 YSM
    opacity: 0.25,
    size: 200,
    resolution: 512,
    color: 0xf0f4fa,
  },
};

/** three r185 官方 ReflectorShader 静态属性（运行时存在，@types/three 未声明该静态属性，断言桥接） */
type ReflectorShaderDef = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};
const REFLECTOR_SHADER = (Reflector as typeof Reflector & { ReflectorShader: ReflectorShaderDef })
  .ReflectorShader;

export class ReflectorCapability implements SceneCapability {
  readonly id = "reflector";
  readonly labelKey = "preview.reflector";
  readonly icon = "🪟";
  readonly descKey = "preview.reflectorDesc";

  private scene: THREE.Scene;
  private params: ReflectorParams;
  private enabled: boolean;

  private reflector: Reflector | null = null;
  /** loadState 是否成功载入过；setPreset 有它时不覆盖用户会话（对齐 shadow-capability 同名守卫） */
  private isStateLoaded = false;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: Partial<ReflectorParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.params = { ...DEFAULT_REFLECTOR_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? this.params.enabled;
  }

  /* -------- 内部：构造/销毁 Reflector -------- */

  private injectOpacityIntoShader(options: { shader: ReflectorShaderDef }): boolean {
    const officialFrag = options.shader.fragmentShader;
    const declAnchor = "uniform vec3 color;";
    const alphaAnchor = "gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );";
    const injectedFrag = officialFrag
      .replace(declAnchor, `${declAnchor}\n\t\t\tuniform float uOpacity;`)
      .replace(alphaAnchor, "gl_FragColor = vec4( blendOverlay( base.rgb, color ), uOpacity );");
    const injectedOk = injectedFrag !== officialFrag && injectedFrag.includes("uOpacity");
    if (!injectedOk) {
      ringLog(
        "reflector",
        "three ReflectorShader 锚点未匹配（three 升级？），opacity 注入失败，回退官方 shader",
        "warn",
      );
      return false;
    }
    options.shader.fragmentShader = injectedFrag;
    return true;
  }

  private createReflectorMesh(): Reflector | null {
    const geometry = new THREE.PlaneGeometry(this.params.size, this.params.size);
    const shader = { ...REFLECTOR_SHADER };
    this.injectOpacityIntoShader({ shader });

    const reflector = new Reflector(geometry, {
      clipBias: this.params.clipBias,
      textureWidth: this.params.resolution,
      textureHeight: this.params.resolution,
      color: this.params.color,
      shader,
    });
    reflector.position.y = GROUND_LAYER_OFFSETS.reflector;
    reflector.rotation.x = -Math.PI / 2;
    reflector.name = "ysm-reflector";

    const mat = reflector.material as THREE.ShaderMaterial;
    mat.transparent = true;
    mat.uniforms.uOpacity = { value: this.params.opacity };

    return reflector;
  }

  private buildReflector(): void {
    this.disposeReflector();
    if (!this.enabled) return;
    this.reflector = this.createReflectorMesh();
    if (this.reflector) this.scene.add(this.reflector);
  }

  private disposeReflector(): void {
    if (!this.reflector) return;
    if (this.reflector.parent) this.reflector.parent.remove(this.reflector);
    this.reflector.geometry.dispose();
    // Reflector 内部通过 WebGLRenderTarget 缓存，需显式释放。
    // 不用可选链静默跳过：若 dispose 缺失（three 升级/Reflector 实现变更），显式告警并手动释放 render target。
    if (this.reflector.dispose) {
      this.reflector.dispose();
    } else {
      ringLog(
        "reflector",
        "Reflector.dispose 缺失，手动释放 render target（检查 three 升级）",
        "warn",
      );
      const r = this.reflector as Reflector & {
        getRenderTarget?: () => THREE.WebGLRenderTarget | null;
      };
      const rt = r.getRenderTarget?.();
      if (rt) {
        rt.texture.dispose();
        rt.dispose();
      }
    }
    this.reflector = null;
  }

  /* -------- 参数 API -------- */

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.params.enabled = v;
    this.buildReflector();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 按模型类别套用预设：若用户尚未从 localStorage 恢复过状态（isStateLoaded=false）则套用，避免覆盖用户上次会话配置 */
  setPreset(modelType: string): void {
    if (this.isStateLoaded) return;
    const preset = REFLECTOR_PRESETS[modelType] ?? REFLECTOR_PRESETS.default;
    this.params = { ...this.params, ...preset };
    if (this.enabled) this.buildReflector();
  }

  setOpacity(v: number): void {
    this.params.opacity = Math.max(0, Math.min(1, v));
    const mat = this.reflector?.material as THREE.ShaderMaterial | undefined;
    if (mat?.uniforms?.uOpacity) mat.uniforms.uOpacity.value = this.params.opacity;
  }

  setColor(hex: number): void {
    this.params.color = hex;
    const mat = this.reflector?.material as THREE.ShaderMaterial | undefined;
    // tint 走官方 color uniform（fragmentShader 内 blendOverlay( base.rgb, color ) 原生混合）
    if (mat?.uniforms?.color) mat.uniforms.color.value.setHex(hex);
  }

  setSize(v: number): void {
    this.params.size = v;
    if (this.enabled) this.buildReflector();
  }

  setResolution(v: number): void {
    this.params.resolution = v;
    if (this.enabled) this.buildReflector();
  }

  setClipBias(v: number): void {
    this.params.clipBias = v;
    if (this.enabled) this.buildReflector();
  }

  getParams(): ReflectorParams {
    return { ...this.params, enabled: this.enabled };
  }

  /* -------- 菜单控件（声明式驱动）-------- */

  /* -------- ADR-195 刀3：getMasterNodeId（替代 getMasterToggle）-------- */

  /** 能力总开关节点 id：env 面板据此升 header + body 剔除同源 */
  getMasterNodeId(): string {
    return "reflector-enabled";
  }

  /* -------- ADR-195 刀2 试点：cap 直产节点（getMenuNodes）-------- */

  /** 完整参数面板节点树（能力总开关 + 参数组 folder）——直产 PreviewMenuNode[]，
   *  不经过 MenuControlDef/桥接层；简单控件原生节点 + group→folder。
   *  消费者需「除总开关外」子树时按 getMasterNodeId() 剔除顶层节点
   *  （env.ts envCapSubNodes 通用处理）。 */
  getMenuNodes(): PreviewMenuNode[] {
    return buildReflectorNodes(this);
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      size: this.params.size,
      resolution: this.params.resolution,
      color: this.params.color,
      opacity: this.params.opacity,
      clipBias: this.params.clipBias,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    restoreFields(state, {
      enabled: {
        boolean: (v) => {
          this.enabled = v;
          this.params.enabled = v;
        },
      },
      size: { number: (v) => (this.params.size = v) },
      resolution: { number: (v) => (this.params.resolution = v) },
      color: { number: (v) => (this.params.color = v) },
      opacity: { number: (v) => (this.params.opacity = v) },
      clipBias: { number: (v) => (this.params.clipBias = v) },
    });
    this.isStateLoaded = true;
    this.buildReflector();
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.buildReflector();
  }

  dispose(): void {
    this.disposeReflector();
  }
}
