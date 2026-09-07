// ===== ReflectorCapability：反光地面能力（ADR-196 迁移至 envState）=====
// 复用 Three 官方 Reflector（three/addons/objects/Reflector.js），不允许自写镜像相机/RTV shader。
// 与 ShadowCapability / GroundCapability 的分层共存：Shadow 走 cameraSize 正交视锥无承接平面；
// Reflector 平面按 GROUND_LAYER_OFFSETS.reflector 下沉（位于 ground 承接面之下，z-fighting 防御）

import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import type { PreviewMenuNode } from "../menu-node-types.ts";
import { registerEnvCallback } from "../state/env-dispatcher.ts";
import { envState, setEnvState } from "../state/env-state.ts";
import type { EnvState } from "../state/env-state-schema.ts";
import { MODEL_DEFAULTS } from "../state/model-defaults.ts";
import { buildReflectorNodes } from "./reflector-menu.ts";
import {
  GROUND_LAYER_OFFSETS,
  persistState,
  restoreFields,
  restoreState,
  ringLog,
  type SceneCapability,
} from "./scene-capability.ts";

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
  private enabled: boolean;

  private reflector: Reflector | null = null;
  /** loadState 是否成功载入过；applyModelPreset 有它时不覆盖用户会话（对齐 shadow-capability 同名守卫） */
  private isStateLoaded = false;
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.enabled = opts.enabled ?? true;

    // ADR-196：订阅 envState 变更——细粒度分派（code_review P3 #5/#15/#20 单主化）：
    // 结构性字段（enabled/size/resolution/clipBias）→ buildReflector 全量重建；
    // 参数字段（opacity/color）→ 就地改 reflector material uniform（避免重建重活）。
    this.unsubscribeEnv = registerEnvCallback(this, (changed, _state) => {
      if (
        changed.has("reflectorEnabled") ||
        changed.has("reflectorSize") ||
        changed.has("reflectorResolution") ||
        changed.has("reflectorClipBias")
      ) {
        this.buildReflector();
        return;
      }
      if (changed.has("reflectorOpacity")) {
        const mat = this.reflector?.material as THREE.ShaderMaterial | undefined;
        if (mat?.uniforms?.uOpacity) mat.uniforms.uOpacity.value = envState.reflectorOpacity;
      }
      if (changed.has("reflectorColor")) {
        const mat = this.reflector?.material as THREE.ShaderMaterial | undefined;
        if (mat?.uniforms?.color) mat.uniforms.color.value.setHex(envState.reflectorColor);
      }
    });
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
    const geometry = new THREE.PlaneGeometry(envState.reflectorSize, envState.reflectorSize);
    const shader = { ...REFLECTOR_SHADER };
    this.injectOpacityIntoShader({ shader });

    const reflector = new Reflector(geometry, {
      clipBias: envState.reflectorClipBias,
      textureWidth: envState.reflectorResolution,
      textureHeight: envState.reflectorResolution,
      color: envState.reflectorColor,
      shader,
    });
    reflector.position.y = GROUND_LAYER_OFFSETS.reflector;
    reflector.rotation.x = -Math.PI / 2;
    reflector.name = "ysm-reflector";

    const mat = reflector.material as THREE.ShaderMaterial;
    mat.transparent = true;
    mat.uniforms.uOpacity = { value: envState.reflectorOpacity };

    return reflector;
  }

  private buildReflector(): void {
    this.disposeReflector();
    if (!this.enabled || !envState.reflectorEnabled) return;
    this.reflector = this.createReflectorMesh();
    if (this.reflector) this.scene.add(this.reflector);
  }

  private disposeReflector(): void {
    if (!this.reflector) return;
    if (this.reflector.parent) this.reflector.parent.remove(this.reflector);
    this.reflector.geometry.dispose();
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
    // code_review df84baefb #3/#11（P1）：master toggle（reflector-menu.ts set:
    // cap.setEnabled）须打通 envState.reflectorEnabled gate——buildReflector 的
    // `!envState.reflectorEnabled` 使 toggle ON 后 mesh 永空（唯一写者
    // setEnabledReflector 无生产调用方）；legacy {enabled:true} 存档无该键同样
    // 恢复为永久关闭。ADR-196 收口：setEnvState 同步 dispatch → callback buildReflector。
    setEnvState({ reflectorEnabled: v }, { source: "manual" });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 按模型类别套用预设：若用户尚未从 localStorage 恢复过状态（isStateLoaded=false）则套用，避免覆盖用户上次会话配置 */
  applyModelPreset(modelType: string): void {
    if (this.isStateLoaded) return;
    const preset =
      MODEL_DEFAULTS[modelType as keyof typeof MODEL_DEFAULTS] ?? MODEL_DEFAULTS.default;
    const partial: Partial<EnvState> = {};
    for (const key of [
      "reflectorEnabled",
      "reflectorOpacity",
      "reflectorSize",
      "reflectorResolution",
      "reflectorColor",
      "reflectorClipBias",
    ] as const) {
      if ((preset as Record<string, unknown>)[key] !== undefined)
        (partial as Record<string, unknown>)[key] = (preset as Record<string, unknown>)[key];
    }
    if (Object.keys(partial).length > 0) setEnvState(partial, { source: "auto-model" });
  }

  setEnabledReflector(v: boolean): void {
    setEnvState({ reflectorEnabled: v }, { source: "manual" });
  }

  setOpacity(v: number): void {
    // ADR-196 收口：纯写 envState；uniform 就地改由 callback 细粒度落地。
    setEnvState({ reflectorOpacity: Math.max(0, Math.min(1, v)) }, { source: "manual" });
  }

  setColor(hex: number): void {
    // ADR-196 收口：纯写 envState；uniform 就地改由 callback 细粒度落地。
    setEnvState({ reflectorColor: hex }, { source: "manual" });
  }

  setSize(v: number): void {
    // ADR-196 收口：纯写 envState；buildReflector 由 callback 落地。
    setEnvState({ reflectorSize: v }, { source: "manual" });
  }

  setResolution(v: number): void {
    // ADR-196 收口：纯写 envState；buildReflector 由 callback 落地。
    setEnvState({ reflectorResolution: v }, { source: "manual" });
  }

  setClipBias(v: number): void {
    // ADR-196 收口：纯写 envState；buildReflector 由 callback 落地。
    setEnvState({ reflectorClipBias: v }, { source: "manual" });
  }

  getParams() {
    return {
      enabled: this.enabled && envState.reflectorEnabled,
      size: envState.reflectorSize,
      resolution: envState.reflectorResolution,
      color: envState.reflectorColor,
      opacity: envState.reflectorOpacity,
      clipBias: envState.reflectorClipBias,
    };
  }

  /* -------- ADR-195 刀3：getMasterNodeId（替代 getMasterToggle）-------- */

  /** 能力总开关节点 id：env 面板据此升 header + body 剔除同源 */
  getMasterNodeId(): string {
    return "reflector-enabled";
  }

  /* -------- ADR-195 刀2 试点：cap 直产节点（getMenuNodes）-------- */

  /** 完整参数面板节点树（能力总开关 + 参数组 folder） */
  getMenuNodes(): PreviewMenuNode[] {
    return buildReflectorNodes(this);
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      reflectorEnabled: envState.reflectorEnabled,
      size: envState.reflectorSize,
      resolution: envState.reflectorResolution,
      color: envState.reflectorColor,
      opacity: envState.reflectorOpacity,
      clipBias: envState.reflectorClipBias,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    restoreFields(state, {
      enabled: {
        boolean: (v) => {
          this.enabled = v;
        },
      },
      reflectorEnabled: {
        boolean: (v) => setEnvState({ reflectorEnabled: v }, { source: "manual" }),
      },
      size: { number: (v) => setEnvState({ reflectorSize: v }, { source: "manual" }) },
      resolution: { number: (v) => setEnvState({ reflectorResolution: v }, { source: "manual" }) },
      color: { number: (v) => setEnvState({ reflectorColor: v }, { source: "manual" }) },
      opacity: { number: (v) => setEnvState({ reflectorOpacity: v }, { source: "manual" }) },
      clipBias: { number: (v) => setEnvState({ reflectorClipBias: v }, { source: "manual" }) },
    });
    this.isStateLoaded = true;
    this.buildReflector();
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.buildReflector();
  }

  dispose(): void {
    this.unsubscribeEnv();
    this.disposeReflector();
  }
}
