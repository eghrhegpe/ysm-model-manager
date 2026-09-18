// ===== ReflectorCapability：反光地面能力（ADR-196 迁移至 envState）=====
// 复用 Three 官方 Reflector（three/addons/objects/Reflector.js），不允许自写镜像相机/RTV shader。
// 与 ShadowCapability / GroundCapability 的分层共存：Shadow 走 cameraSize 正交视锥无承接平面；
// Reflector 平面按 GROUND_LAYER_OFFSETS.reflector 下沉（位于 ground 承接面之下，z-fighting 防御）

import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { assertRevisionRange, reportPatchIssue } from "@/preview-3d/shader-patches/patch-guard.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { type ModelType, pickModelDefaultFields } from "@/preview-3d/state/model-defaults.ts";
import { buildReflectorNodes } from "./reflector-menu.ts";
import {
  type EnvPlacement,
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
  readonly icon = "mirror";
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
    // 只接收 reflector 组的键（dispatcher 前置过滤）。
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed, _state) => {
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
      },
      "reflector",
    );
  }

  /* -------- 内部：构造/销毁 Reflector -------- */

  private injectOpacityIntoShader(options: { shader: ReflectorShaderDef }): boolean {
    // [shader-patch 守卫] three 升级到未审计 REVISION 时显式抛错（ReflectorShader 锚点失配静默降级 → 显式化）
    assertRevisionRange({ module: "reflector-patch", allowed: ["185"] });
    const officialFrag = options.shader.fragmentShader;
    const declAnchor = "uniform vec3 color;";
    const alphaAnchor = "gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );";
    const injectedFrag = officialFrag
      .replace(declAnchor, `${declAnchor}\n\t\t\tuniform float uOpacity;`)
      .replace(alphaAnchor, "gl_FragColor = vec4( blendOverlay( base.rgb, color ), uOpacity );");
    // 单锚点分检（2026-09-14 加固：原整体判断在「decl 命中 alpha 失配」时只报模糊 warn，
    // opacity 静默失效——现精确到失败锚点）；任一失配仍回退官方 shader（保守语义不变）
    const declOk = injectedFrag.includes("uniform float uOpacity;");
    const alphaOk = injectedFrag.includes("), uOpacity );");
    if (!declOk || !alphaOk) {
      reportPatchIssue(
        "reflector",
        `three ReflectorShader 锚点未匹配（decl=${declOk ? "ok" : "miss"} alpha=${alphaOk ? "ok" : "miss"}，three 升级？），opacity 注入失败，回退官方 shader`,
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

    // ⚠️ 官方 Reflector（非 ReflectorForSSRPass）。若将来要把本平面接进 SSRPass 的
    // groundReflector，**不能**直接传本实例——SSRPass 调的是 `doRender()`，本类没有该方法
    // （会抛 "doRender is not a function"）。正确做法是整体换成 `ReflectorForSSRPass`
    // （自带与 SSR 对齐的 maxDistance/opacity/fresnel uniform，是替代品不是附加品）。
    // 现状不需替换：SSR 活动时 postprocessing 侧 applyReflectorSync 已按
    // envState.ppReflectorDisableWhenSSR（默认 true）压制本 cap，双反射默认不可达。
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
    // master toggle（reflector-menu.ts set:
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
  applyModelPreset(modelType: ModelType): void {
    if (this.isStateLoaded) return;
    const picked = pickModelDefaultFields(modelType, [
      "reflectorEnabled",
      "reflectorOpacity",
      "reflectorSize",
      "reflectorResolution",
      "reflectorColor",
      "reflectorClipBias",
    ]);
    if (Object.keys(picked).length > 0) setEnvState(picked, { source: "auto-model" });
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

  /** 环境面板归属（ADR-268）：氛围卡末位 */
  getEnvPlacement(): EnvPlacement {
    return { section: "atmosphere", order: 30 };
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
