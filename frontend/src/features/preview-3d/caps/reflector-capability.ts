// ===== ReflectorCapability：反光地面能力（ADR-073 caps/ 能力模式）=====
// 复用 Three 官方 Reflector（three/addons/objects/Reflector.js），不允许自写镜像相机/RTV shader。
// 与 ShadowCapability 的 ShadowMaterial 地面分层共存：
//   - Shadow 平面 y = groundY（贴 GridHelper）
//   - Reflector 平面 y = groundY - 0.01（毫米级后移，避免 z-fighting）
// Reflector 是一个透明 mesh + 背面镜像 WebGLRenderTarget，draw call 代价不低（约等于再渲染一次场景），
// 默认关闭，用户显式开启；模型类别预设给出建议参数。

import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

export interface ReflectorParams {
  enabled: boolean;
  /** 地面平面尺寸（世界单位）*/
  size: number;
  /** 位置 Y（默认与 GridHelper 对齐） */
  groundY: number;
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
  groundY: 0,
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
    opacity: 0.25, size: 200, resolution: 512, color: 0xf0f4fa,
  },
  vrm: {
    // PBR 角色：中等反射 + 暖调
    opacity: 0.5, size: 60, resolution: 1024, color: 0xf8efe2,
  },
  mmd: {
    // toon：更弱，避免高光与反射冲突
    opacity: 0.2, size: 80, resolution: 1024, color: 0xfafcff,
  },
  litematic: {
    // 体素：大平面 + 冷调
    opacity: 0.25, size: 500, resolution: 512, color: 0xeaf1fb,
  },
  resourcepack: {
    // MC 方块：同 YSM
    opacity: 0.25, size: 200, resolution: 512, color: 0xf0f4fa,
  },
};

/** three r185 官方 ReflectorShader 静态属性（运行时存在，@types/three 未声明该静态属性，断言桥接） */
type ReflectorShaderDef = {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
};
const REFLECTOR_SHADER = (Reflector as typeof Reflector & { ReflectorShader: ReflectorShaderDef }).ReflectorShader;

function rcBuildMain(cap: ReflectorCapability): MenuControlDef[] {
  return [
    {
      id: "reflector-enabled",
      kind: "toggle",
      labelKey: "preview.reflector",
      fallback: "反光地面",
      getValue: () => cap.isEnabled(),
      setValue: (v) => cap.setEnabled(v as boolean),
    },
  ];
}

function rcBuildAppearance(cap: ReflectorCapability): MenuControlDef[] {
  return [
    {
      id: "reflector-opacity",
      kind: "slider",
      labelKey: "preview.reflectorOpacity",
      fallback: "反射强度",
      group: "preview.reflectorGroupParams",
      slider: { min: 0, max: 1, step: 0.01 },
      getValue: () => cap.getParams().opacity,
      setValue: (v) => cap.setOpacity(v as number),
    },
    {
      id: "reflector-resolution",
      kind: "slider",
      labelKey: "preview.reflectorResolution",
      fallback: "反射精度",
      group: "preview.reflectorGroupParams",
      slider: { min: 256, max: 2048, step: 256 },
      getValue: () => cap.getParams().resolution,
      setValue: (v) => cap.setResolution(v as number),
    },
    {
      id: "reflector-size",
      kind: "slider",
      labelKey: "preview.reflectorSize",
      fallback: "地面大小",
      group: "preview.reflectorGroupParams",
      slider: { min: 20, max: 500, step: 10 },
      getValue: () => cap.getParams().size,
      setValue: (v) => cap.setSize(v as number),
    },
  ];
}

export class ReflectorCapability implements SceneCapability {
  readonly id = "reflector";
  readonly labelKey = "preview.reflector";
  readonly icon = "🪟";
  readonly descKey = "preview.reflectorDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private params: ReflectorParams;
  private enabled: boolean;

  private reflector: Reflector | null = null;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    params?: Partial<ReflectorParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
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
      console.warn("[reflector-cap] three ReflectorShader 锚点未匹配（three 升级？），opacity 注入失败，回退官方 shader");
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
    reflector.position.y = this.params.groundY - 0.01;
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
    // Reflector 内部通过 WebGLRenderTarget 缓存，需显式释放（.dispose() 已处理 rt）
    this.reflector.dispose?.();
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

  setPreset(modelType: string): void {
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

  setGroundY(v: number): void {
    this.params.groundY = v;
    if (this.reflector) this.reflector.position.y = v - 0.01;
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

  getMenuControls(): MenuControlDef[] {
    return [...rcBuildMain(this), ...rcBuildAppearance(this)];
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
    if (typeof state.enabled === "boolean") { this.enabled = state.enabled; this.params.enabled = state.enabled; }
    if (typeof state.size === "number") this.params.size = state.size;
    if (typeof state.resolution === "number") this.params.resolution = state.resolution;
    if (typeof state.color === "number") this.params.color = state.color;
    if (typeof state.opacity === "number") this.params.opacity = state.opacity;
    if (typeof state.clipBias === "number") this.params.clipBias = state.clipBias;
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
