// ===== 程序化天空能力（ADR-073 L1 首个落地能力）=====
// 复用 Three 官方 Sky（Preetham 大气散射，three/addons/objects/Sky.js），
// 禁止自写大气散射 shader（ADR-073 红线）。
// 本类仅做「接入 scene + uniform 管线 + 可选 IBL 环境联动」的薄封装，
// 后续 bloom/DOF/ground 等能力一律复用同一套路（核心 + 薄封装 + 注册表）。
//
// 设计要点：
// - Sky 材质 side=BackSide 且顶点 z 强制 far，故相机须始终位于天空盒内部：
//   天空盒半边长须 > 相机 maxDistance。预览核心 maxDistance=5000 → scale 默认 12000。
// - 天空依赖 tone mapping 才正确显色；本能力在 apply() 内为本次会话 renderer
//   设置 ACESFilmic + exposure，dispose() 时还原，作用域不泄漏到其它预览。
// - IBL 环境联动（scene.environment）默认开启（2026-08-16 目视验证通过，模型反射/环境光更真实）；
//   如需关闭调用 setEnvironmentEnabled(false)。
// - 实现 SceneCapability 统一接口，支持注册表自动发现 + 菜单控件 + 持久化。
// - God Rays（体积光束，ADR-107）：日出日落时从太阳方向向下投射的半透明光束。

import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
import { assertRevisionRange, reportPatchIssue } from "@/preview-3d/shader-patches/patch-guard.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState, EnvStateKey } from "@/preview-3d/state/env-state-schema.ts";
import type { ModelType } from "@/preview-3d/state/model-defaults.ts";
import {
  type EnvPlacement,
  getTypedCap,
  persistState,
  restoreFields,
  restoreState,
  ringLog,
  type SceneCapability,
  type SceneCapabilityLookup,
} from "./scene-capability.ts";
import { buildSkyNodes } from "./sky-menu.ts";
import { godRaysIntensity, SunBeams } from "./sun-beams.ts";

/**
 * 天空盒半边长（[锐评 S2-4] 原 envState.skyScale 键摘除后提为模块常量）。
 *
 * **硬物理约束**：Three 官方 Sky 的材质 side=BackSide 且顶点 z 强制 far，
 * 故相机须**始终位于天空盒内部**——半边长必须 > 预览核心相机 maxDistance(5000)，
 * 否则相机拉远即飞出盒外、天空整体消失。取 12000 留 2.4× 余量。
 *
 * 该值是渲染实现细节而非用户偏好：无 UI 控件、无回调分支、saveState 不落盘，
 * 暴露成 envState 键只会造就一个「拖了不响应」或「拖坏画面」的旋钮。
 * 约束出处与受约束者现同处一文件（原注释只在 env-state-schema.ts 侧提到）。
 * SunBeams 的锥体/overlay 尺寸也按本常量缩放（构造期快照）。
 */
export const SKY_SCALE = 12000;

/**
 * §4 解耦：给官方 Preetham Sky.js 的 ShaderMaterial 最小化注入两个 uniform，
 * 把「天空底色 × 太阳强度」和「太阳盘白光强度」从硬编码改为可配置尺度。
 * ——不替换 shader 主体（仍为 Preetham 物理模型），仅追加 uniforms 声明 + 两处乘法。
 * 🔗 ADR-073：仍为 Preetham，未自写三色渐变，合规。
 *
 * 🔎 需要 patch 的两处硬编码（来自 three/examples/jsm/objects/Sky.js SkyShader.fragmentShader）：
 *   ① L261:  `pow( vSunE * ((betaRTheta...) * (1.0-Fex) ), vec3(1.5))` → 把 vSunE 前乘 sunIntensityScale
 *        →  `pow( (vSunE * sunIntensityScale) * ((betaRTheta...) * (1.0-Fex) ), vec3(1.5))`
 *   ② L272:  `(vSunE * 19000.0 * Fex) * sundisc;` → 在 19000 后插入 sunDiscScale
 *        →  `(vSunE * 19000.0 * sunDiscScale * Fex) * sundisc;`
 *
 * ⚡ 幂等：重复调用不会重复注入。未注入过时才做 shader 替换并置 needsUpdate=true。
 *
 * @param defaults 默认值通常是 envState.skySunIntensityScale / envState.skySunDiscScale，
 *                 之后通过 uniforms.value 再同步运行时参数。
 */
export function injectSkySunScalePatch(
  mat: THREE.ShaderMaterial,
  defaults: { sunIntensityScale: number; sunDiscScale: number } = {
    sunIntensityScale: envState.skySunIntensityScale,
    sunDiscScale: envState.skySunDiscScale,
  },
): void {
  // [shader-patch 守卫] three 升级到未审计 REVISION 时显式抛错（锚点失配静默降级 → 显式化）
  assertRevisionRange({ module: "sky-patch", allowed: ["185"] });
  // 分字段幂等守卫（审计①：原「双字段整体短路」有半残缺口——uniform 已注册但乘法
  // 缺失时误判已注入 → 永不补全，静默半残）。现按字段各自校验：字段视为已注入
  // 仅当「uniform 存在 且 shader 已含对应乘法」。半残状态（uniform 在、乘法缺）下次
  // 调用自动补全乘法层；锚点彻底失配时 ringLog 留痕（消除静默失效缝隙）。
  const hasSunScaleUniform = mat.uniforms.sunIntensityScale !== undefined;
  const hasDiscScaleUniform = mat.uniforms.sunDiscScale !== undefined;
  const hasSunScaleUse = /vSunE\s*\*\s*sunIntensityScale/.test(mat.fragmentShader);
  const hasDiscScaleUse = /19000\.0\s*\*\s*sunDiscScale/.test(mat.fragmentShader);
  if (hasSunScaleUniform && hasDiscScaleUniform && hasSunScaleUse && hasDiscScaleUse) {
    // 完全注入 → 只确保默认值同步到 uniforms（不改 shader，避免重编译）
    mat.uniforms.sunIntensityScale.value = defaults.sunIntensityScale;
    mat.uniforms.sunDiscScale.value = defaults.sunDiscScale;
    return;
  }

  // ① 追加 uniforms（对象层先注册，即使后续 shader 替换失败也不 crash 运行时）
  if (!hasSunScaleUniform) mat.uniforms.sunIntensityScale = { value: defaults.sunIntensityScale };
  if (!hasDiscScaleUniform) mat.uniforms.sunDiscScale = { value: defaults.sunDiscScale };

  // ② patch fragmentShader：按"声明必须先于使用"的 GLSL 顺序三层独立幂等替换。
  //    每一层都做 contains 判断，避免重复替换。如果声明层未匹配，就跳过使用层（防未声明编译报错）
  let patched = false;

  // 2a) uniform 声明：在 "uniform float showSunDisc;\nuniform float time;" 之后追加成两行新声明
  const hasDecl = /uniform\s+float\s+sunIntensityScale\s*;/.test(mat.fragmentShader);
  if (!hasDecl) {
    const before = mat.fragmentShader;
    const uniformDeclInjection =
      "\nuniform float sunIntensityScale;\nuniform float sunDiscScale;\n";
    mat.fragmentShader = mat.fragmentShader.replace(
      /(uniform\s+float\s+showSunDisc\s*;\s*\n\s*uniform\s+float\s+time\s*;)/,
      `$1${uniformDeclInjection}`,
    );
    if (mat.fragmentShader !== before) patched = true;
    else {
      // regex 未匹配（Three 未来版本可能调整 uniforms 顺序），做全局兜底：在最后一个 uniform 声明后加
      // 取 "// Cloud noise functions" 之前最后一个 `uniform ...;` 的行尾追加
      const fallbackIdx = mat.fragmentShader.indexOf("float hash( vec2 p )");
      if (fallbackIdx > 0) {
        mat.fragmentShader =
          mat.fragmentShader.slice(0, fallbackIdx) +
          "uniform float sunIntensityScale;\nuniform float sunDiscScale;\n" +
          mat.fragmentShader.slice(fallbackIdx);
        patched = true;
      } else {
        reportPatchIssue(
          "sky",
          "injectSkySunScalePatch 无法注入声明，跳过 shader patch。请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
          "error",
        );
        // 声明失败 → 不再继续使用层的替换，防 GLSL 编译错
        return;
      }
    }
  }

  // 2b) 解耦点 ①：pow( vSunE * (  →  pow( (vSunE * sunIntensityScale) * (
  if (!hasSunScaleUse) {
    const before = mat.fragmentShader;
    mat.fragmentShader = mat.fragmentShader.replace(
      "pow( vSunE * (",
      "pow( (vSunE * sunIntensityScale) * (",
    );
    if (mat.fragmentShader !== before) patched = true;
    else {
      // 本层需补但锚点失配（无论 uniform 已注册与否——半残修复同样可能被外部破坏
      // 挡住）→ 留痕 + console 兜底，消除「静默半残」失效缝隙
      reportPatchIssue(
        "sky",
        "injectSkySunScalePatch 解耦点①（vSunE 缩放）替换失败：锚点失配。请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
        "error",
      );
    }
  }

  // 2c) 解耦点 ②：19000.0 * Fex → 19000.0 * sunDiscScale * Fex
  if (!hasDiscScaleUse) {
    const before = mat.fragmentShader;
    mat.fragmentShader = mat.fragmentShader.replace(
      "19000.0 * Fex",
      "19000.0 * sunDiscScale * Fex",
    );
    if (mat.fragmentShader !== before) patched = true;
    else {
      reportPatchIssue(
        "sky",
        "injectSkySunScalePatch 解耦点②（太阳盘缩放）替换失败：锚点失配。请检查 Three.js Sky.js fragmentShader 结构是否已变更。",
        "error",
      );
    }
  }

  // ③ 有改动才触发重编译
  if (patched) mat.needsUpdate = true;
}

export class SkyCapability implements SceneCapability {
  readonly id = "sky";
  readonly labelKey = "preview.sky";
  readonly icon = "sky";
  readonly descKey = "preview.skyDesc";

  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private caps?: SceneCapabilityLookup;
  /** PMREMGenerator 延迟创建（构造函数不依赖 WebGL，node 测试友好） */
  private pmrem: THREE.PMREMGenerator | null = null;
  private sky: Sky;
  private envScene: THREE.Scene;
  private envSky: Sky;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private enabled: boolean;
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;
  /** 本实例是否已向 toneRefCount 贡献过引用（apply 幂等标记——防重复 apply 抬高计数；
   *  从未贡献的实例 dispose 不得拆共享 tone 状态，见 dispose/apply 注释） */
  private toneApplied = false;
  private prevToneMapping: THREE.ToneMapping;
  private prevExposure: number;
  /** 构造前 scene.environment 的快照——dispose 时还原，detach 不触碰（用户可能再启用） */
  private prevEnvironment: THREE.Texture | THREE.CubeTexture | null;
  /** 引用计数：多个 SkyCapability 共享同一 renderer 时，
   *  tone mapping 只在第一个 attach 时设置，只在最后一个 dispose 时恢复。
   *  WeakMap：cap 未 dispose 时不得阻碍 renderer 被 GC（锐评 P2）。 */
  private static toneRefCount = new WeakMap<THREE.WebGLRenderer, number>();
  private static prevToneMap = new WeakMap<THREE.WebGLRenderer, THREE.ToneMapping>();
  private static prevExposureMap = new WeakMap<THREE.WebGLRenderer, number>();
  /** 日落光束 + tint overlay（拆轴自本类：sun-beams.ts 持有完整视觉状态机） */
  private beams: SunBeams;
  /** ADR-196：运行时太阳位置（从 envState.skyTimeOfDay 推导） */
  private elevation = 0;
  private azimuth = 180;

  constructor(opts: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    enabled?: boolean;
    /** cap 间协调查询器（组合根 createAll 注入）——环境开关变化通知 light 刷新 ambient */
    caps?: SceneCapabilityLookup;
  }) {
    this.scene = opts.scene;
    this.renderer = opts.renderer;
    if (opts.caps !== undefined) this.caps = opts.caps;
    this.enabled = opts.enabled ?? true;
    this.prevToneMapping = this.renderer.toneMapping;
    this.prevExposure = this.renderer.toneMappingExposure;
    this.prevEnvironment = this.scene.environment;
    // Sky 是 Mesh + ShaderMaterial，纯数据对象，构造函数不依赖 WebGL
    this.sky = this.createSky();
    this.envSky = this.createSky();
    // §4 解耦：只给主天空 this.sky 注入 sun scale 补丁，envSky（用于 IBL）保持原生 Preetham —
    // 这样 IBL 环境贴图的色调基准与物体反射保持物理正确，而主天空不再被 1000² 的太阳强度炸白。
    injectSkySunScalePatch(this.sky.material as THREE.ShaderMaterial, {
      sunIntensityScale: envState.skySunIntensityScale,
      sunDiscScale: envState.skySunDiscScale,
    });
    this.envScene = new THREE.Scene();
    this.envScene.add(this.envSky);
    // 日落光束 + tint overlay（默认禁用；SunBeams 内聚 cones/tint/time 状态机）
    this.beams = new SunBeams(this.scene, SKY_SCALE);

    // ADR-196：初始化运行时太阳位置
    this.elevation = envState.skyElevation;
    this.azimuth = envState.skyAzimuth;

    // ADR-196：订阅 envState 变更（只接收 sky 组的键，dispatcher 前置过滤）
    // 字段分派表：每个字段 → 应用函数（双写顺序由表顺序保证，消除 if 链顺序隐患）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed, state) => {
        if (!this.enabled) return;

        // ① 时间/位置类：先同步实例字段，再写 uniform
        if (changed.has("skyTimeOfDay")) {
          this.syncSunFromTime();
          this.writeUniforms(this.sky);
          this.writeUniforms(this.envSky);
          this.maybeRegenerateEnvironment(state);
          this.beams.sync(this.elevation, this.azimuth);
        }
        if (changed.has("skyElevation")) {
          this.elevation = state.skyElevation;
        }
        if (changed.has("skyAzimuth")) {
          this.azimuth = state.skyAzimuth;
        }
        if (changed.has("skyElevation") || changed.has("skyAzimuth")) {
          this.writeUniforms(this.sky);
          this.writeUniforms(this.envSky);
          if (state.skyEnvironment && state.skyForceEnv) {
            this.regenerateEnvironment();
          }
        }

        // ② 散射/大气类：双写 uniform（sky + envSky）
        this.applyUniform(changed, "skyCloudCoverage", "cloudCoverage", state.skyCloudCoverage);
        if (changed.has("skyCloudCoverage") && changed.has("skyForceEnv") && state.skyEnvironment) {
          // 云量 + forceEnv 同变 → 重建 IBL（setCloudCoverage(regenerate=true) 语义）
          this.regenerateEnvironment();
        }
        this.applyUniform(changed, "skyTurbidity", "turbidity", state.skyTurbidity);
        this.applyUniform(changed, "skyRayleigh", "rayleigh", state.skyRayleigh);
        this.applyUniform(changed, "skyMieCoefficient", "mieCoefficient", state.skyMieCoefficient);
        this.applyUniform(
          changed,
          "skyMieDirectionalG",
          "mieDirectionalG",
          state.skyMieDirectionalG,
        );

        // ③ 太阳尺度类：双写 uniform（带 undefined 守卫——patch 幂等注入）
        this.applyScaledUniform(
          changed,
          "skySunIntensityScale",
          "sunIntensityScale",
          state.skySunIntensityScale,
        );
        this.applyScaledUniform(changed, "skySunDiscScale", "sunDiscScale", state.skySunDiscScale);

        // ④ 渲染状态类
        // [ADR-250 §2.3] 曝光属主归 sky：有效曝光 = skyExposure × ppExposure。
        // ppExposure 变更亦走此处重算（原由 PostprocessingCapability 直接覆写，两 cap 并写同一字段
        // 造成约 1.8× 亮度跳变——「MMD 亮瞎」的真因，见 ADR-250 §1.4）。
        if (changed.has("skyExposure") || changed.has("ppExposure")) {
          this.applyExposure();
        }
        if (changed.has("skyEnvironment")) {
          if (state.skyEnvironment) this.regenerateEnvironment();
          else this.clearEnvironment();
        }
        if (changed.has("skyGodRaysEnabled")) {
          this.beams.sync(this.elevation, this.azimuth);
        }
        // ⚠️ 刀⑳：skyAutoRotate 原为「只写不读的孤儿」——schema 声明了该键（env-state-schema.ts），
        // 但此处无分支、save/loadState 也不读写它 ⇒ 昼夜循环开关**无法持久化**。
        // 现补齐：回调内同步实例标志（update(dt) 读它驱动推进），持久化随 save/loadState。
        if (changed.has("skyAutoRotate")) {
          this.autoRotateOn = state.skyAutoRotate;
        }
      },
      // [ADR-250 §2.3] 本 cap 是曝光属主（有效曝光 = skyExposure × ppExposure），
      // 故需跨组订阅：自己组的 skyExposure + postprocessing 组的 ppExposure。
      ["sky", "postprocessing"],
    );
  }

  /** 双写 uniform（sky + envSky），仅当 changed 含该字段时 */
  private applyUniform(
    changed: Set<EnvStateKey>,
    field: EnvStateKey,
    uniform: string,
    value: number,
  ): void {
    if (!changed.has(field)) return;
    (this.sky.material.uniforms as Record<string, { value: number }>)[uniform].value = value;
    (this.envSky.material.uniforms as Record<string, { value: number }>)[uniform].value = value;
  }

  /** 双写 uniform（带 undefined 守卫——patch 幂等注入后 uniform 必存在，但防御性保留） */
  private applyScaledUniform(
    changed: Set<EnvStateKey>,
    field: EnvStateKey,
    uniform: string,
    value: number,
  ): void {
    if (!changed.has(field)) return;
    const u = this.sky.material.uniforms as Record<string, { value: number } | undefined>;
    const eu = this.envSky.material.uniforms as Record<string, { value: number } | undefined>;
    const su = u[uniform];
    const esu = eu[uniform];
    if (su !== undefined) su.value = value;
    if (esu !== undefined) esu.value = value;
  }

  /** PMREM 重建门控：forceEnv=true 无条件重建；forceEnv=false 按太阳高度角阈值 */
  private maybeRegenerateEnvironment(state: EnvState): void {
    if (!state.skyEnvironment) return;
    if (state.skyForceEnv) {
      this.regenerateEnvironment();
    } else {
      const el = this.elevation;
      const dirty =
        Math.abs(el - this.lastPmremElevation) >= SkyCapability.PMREM_ELEVATION_THRESHOLD;
      if (dirty) this.regenerateEnvironment();
    }
  }

  /** 确保 PMREMGenerator 已创建（延迟到首次需要时） */
  private ensurePMREM(): THREE.PMREMGenerator {
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(this.renderer);
    }
    return this.pmrem;
  }

  private createSky(): Sky {
    const sky = new Sky();
    sky.scale.setScalar(SKY_SCALE);
    sky.material.uniforms.cloudCoverage.value = envState.skyCloudCoverage;
    return sky;
  }

  /** 应用天空到场景（背景 + 可选 IBL + tone mapping + god rays） */
  apply(): void {
    this.syncSunFromTime();
    this.writeUniforms(this.sky);
    this.writeUniforms(this.envSky);
    if (!this.enabled) {
      this.detach();
      return;
    }
    if (!this.sky.parent) this.scene.add(this.sky);
    // 天空依赖 tone mapping 显色；引用计数仲裁多 session 共享 renderer。
    // 幂等：本实例已贡献过就不再 +1（重复 apply（setEnabled 往返）不得抬高计数，
    // 否则 dispose 永远到不了 0，tone mapping 永不恢复）。
    if (!this.toneApplied) {
      const cnt = SkyCapability.toneRefCount.get(this.renderer) ?? 0;
      if (cnt === 0) {
        SkyCapability.prevToneMap.set(this.renderer, this.renderer.toneMapping);
        SkyCapability.prevExposureMap.set(this.renderer, this.renderer.toneMappingExposure);
      }
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      SkyCapability.toneRefCount.set(this.renderer, cnt + 1);
      this.toneApplied = true;
    }
    // exposure 每次都刷：apply→detach→apply 往返时 toneApplied 已为 true，
    // 但 exposure 可能已被外部改过，必须重新写入。
    // [ADR-250 §2.3] 统一走 applyExposure（skyExposure × ppExposure）。
    this.applyExposure();
    if (envState.skyEnvironment) this.regenerateEnvironment();
    else this.clearEnvironment();
    // 同步日落光束 + tint overlay 挂载（按当前太阳角度决策）
    this.beams.sync(this.elevation, this.azimuth);
  }

  /**
   * 写入 `renderer.toneMappingExposure` —— [ADR-250 §2.3] 本 cap 是**唯一属主**。
   *
   * 有效曝光 = `skyExposure × ppExposure`（ppExposure 默认 1.0，故默认行为与原
   * `skyExposure` 一致）。后处理侧只提供 `ppExposure` 作为**乘法系数**，
   * 不再直接覆写渲染器字段——原双写造成约 1.8× 亮度跳变（「MMD 亮瞎」的真因）：后处理一开
   * 即从 `skyExposure`(per-type 0.5~0.6) 跳到 `ppExposure`(全局 1.0)。
   */
  private applyExposure(): void {
    this.renderer.toneMappingExposure = envState.skyExposure * envState.ppExposure;
  }

  private writeUniforms(sky: Sky): void {
    const u = sky.material.uniforms;
    u.turbidity.value = envState.skyTurbidity;
    u.rayleigh.value = envState.skyRayleigh;
    u.mieCoefficient.value = envState.skyMieCoefficient;
    u.mieDirectionalG.value = envState.skyMieDirectionalG;
    u.cloudCoverage.value = envState.skyCloudCoverage;
    const phi = THREE.MathUtils.degToRad(90 - this.elevation);
    const theta = THREE.MathUtils.degToRad(this.azimuth);
    const sun = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sun);
    if (u.sunIntensityScale !== undefined) {
      u.sunIntensityScale.value = envState.skySunIntensityScale;
    }
    if (u.sunDiscScale !== undefined) {
      u.sunDiscScale.value = envState.skySunDiscScale;
    }
  }

  /**
   * 烘焙 IBL 纹理（**纯生产，不碰 scene.environment**）。
   *
   * [ADR-292 D2] 从 `regenerateEnvironment` 拆出的「只烤不装」半边：slots 写入归
   * {@link regenerateEnvironment}（sky 自持路径）或 EnvironmentCapability（envSource="sky" 路径）。
   *
   * @returns 烘焙是否成功（成功则 this.renderTarget 可读）
   */
  private bakeEnvironment(): boolean {
    // 生成环境贴图时隐藏太阳盘，避免光斑伪影（Sky 文档建议）
    this.envSky.material.uniforms.showSunDisc.value = 0;
    try {
      if (this.renderTarget) this.renderTarget.dispose();
      this.renderTarget = this.ensurePMREM().fromScene(this.envScene);
      // 同步阈值基准：任何重建路径（手动 forceEnv / 循环阈值命中 / setSun / preset）
      // 都以此时太阳高度角为新的门控基准，避免循环在手动调参后首帧冗余重建。
      this.lastPmremElevation = this.elevation;
      return true;
    } catch (e) {
      ringLog("sky", `环境贴图生成失败: ${e}`, "error");
      // catch 后 renderTarget 可能悬空（fromScene 抛错时 renderTarget 已 dispose 但未重置）
      this.renderTarget = null;
      return false;
    } finally {
      this.envSky.material.uniforms.showSunDisc.value = 1;
    }
  }

  /** 烘焙 + 装入 scene.environment（sky 自持路径；ADR-292 后 envSource="sky" 走 bakeEnvironmentTexture） */
  private regenerateEnvironment(): void {
    this.bakeEnvironment();
    // bakeEnvironment 失败时已把 renderTarget 置 null，故此处读值天然带 null 语义
    this.scene.environment = this.renderTarget?.texture ?? null;
  }

  private clearEnvironment(): void {
    if (this.scene.environment === this.renderTarget?.texture) {
      this.scene.environment = null;
    }
  }

  /** 调整太阳位置（度） */
  setSun(elevation: number, azimuth: number): void {
    // ADR-196 收口：纯写 envState；渲染应用（writeUniforms/PMREM 重建）统一走
    // callback 的 skyElevation/skyAzimuth 分支（forceEnv=true → 无条件重建）。
    setEnvState(
      { skyElevation: elevation, skyAzimuth: azimuth, skyForceEnv: true },
      { source: "manual" },
    );
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else this.detach();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnvironmentEnabled(v: boolean): void {
    // ADR-196 收口：纯写 envState；regenerate/clear 由 callback 的 skyEnvironment 分支落地。
    setEnvState({ skyEnvironment: v }, { source: "manual" });
    // [doc:adr-126-p5] 双间接光协调：环境光开关变化同步 light 的 ambient 衰减（防 ×0.5 过期）——
    // 经构造注入的查询器（组合根 createAll 传入），不 import registry（防模块环）。
    // 跨 cap 通知非 envState 派发范畴（light 的 ambient 衰减读 sky 开关做派生），setter 保留。
    getTypedCap(this.caps, "light")?.refreshAmbientFromSky?.();
  }

  /** [ADR-284] 大气与模型类别解耦：不再按类别改散射/曝光参数。
   *  本方法仅保留「换模型 → 置 skyForceEnv 脉冲 → 重建 IBL」的离散动作。 */
  applyModelPreset(modelType: ModelType): void {
    void modelType; // 类别不再参与取参（保留签名以对齐装配链其余 cap）
    setEnvState({ skyForceEnv: true }, { source: "auto-model" });
    // 恢复预设切换的 IBL 重建：changed 集不命中 callback 的任一重建分支
    // （唯一判 skyForceEnv 的 cloudCoverage 分支要求 skyCloudCoverage 同变，预设不含），
    // envSky uniforms 已由 callback 散射分支同步，此处只需重建一次
    if (this.enabled && envState.skyEnvironment) this.regenerateEnvironment();
  }

  /** 设置云量 0=晴空 1=多云（ADR-073 #4）；regenerate=true 时同步刷新 IBL 环境 */
  setCloudCoverage(v: number, regenerate = false): void {
    // ADR-196 收口：纯写 envState；uniform 由 callback 的 skyCloudCoverage 分支落地；
    // regenerate 语义保留（置 skyForceEnv 由 callback 判定重建）。
    setEnvState(
      { skyCloudCoverage: v, ...(regenerate ? { skyForceEnv: true } : {}) },
      { source: "manual" },
    );
  }

  /** §4 解耦：设置太阳强度对天空底色的耦合尺度（合法域 [0,1.5]／滑杆 0.3–1.2，默认 0.75）；
   *  1.0 = 原生 Preetham 强度（正午最白），越低天空越不被太阳光绑架。 */
  setSunIntensityScale(v: number): void {
    // 值域钳制在唯一写入口（ADR-283）：合法域 [0,1.5] 由 schema range 声明，滑杆行程见 uiRange
    // ADR-196 收口：纯写 envState；uniform 由 callback 落地。
    setEnvState({ skySunIntensityScale: v }, { source: "manual" });
  }

  /** §4 解耦：设置太阳盘白光的尺度（合法域 [0,1.5]／滑杆 0–1.2，默认 0.5）；
   *  1.0 = 原生 19000× 白光炸弹，越低太阳盘越暗、Bloom 越不炸屏。 */
  setSunDiscScale(v: number): void {
    // 值域钳制在唯一写入口（ADR-283）：合法域 [0,1.5] 由 schema range 声明，滑杆行程见 uiRange
    // ADR-196 收口：纯写 envState；uniform 由 callback 落地。
    setEnvState({ skySunDiscScale: v }, { source: "manual" });
  }

  /** 获取解耦尺度当前值（用于 UI getter / 测试断言） */
  getSunIntensityScale(): number {
    return envState.skySunIntensityScale;
  }
  getSunDiscScale(): number {
    return envState.skySunDiscScale;
  }

  /** 返回完整 params 浅拷贝（UI 面板 / 测试断言用，对齐其它 capability 口径） */
  getParams() {
    return {
      elevation: this.elevation,
      azimuth: this.azimuth,
      turbidity: envState.skyTurbidity,
      rayleigh: envState.skyRayleigh,
      mieCoefficient: envState.skyMieCoefficient,
      mieDirectionalG: envState.skyMieDirectionalG,
      cloudCoverage: envState.skyCloudCoverage,
      scale: SKY_SCALE,
      environment: envState.skyEnvironment,
      timeOfDay: envState.skyTimeOfDay,
      exposure: envState.skyExposure,
      sunIntensityScale: envState.skySunIntensityScale,
      sunDiscScale: envState.skySunDiscScale,
    };
  }

  // ── 昼夜循环动画（2026-08-20 引入；2026-09-03 迁入 SceneCapability.update(dt)）──
  // 自建 rAF 循环已删除——此前与 mount-preview-core 全局唯一 rAF（L591 c.update?.(dt)）
  // 双时钟并存，帧序 / document.hidden 暂停语义分裂；timeOfDay 推进改由核心帧循环驱动。
  // 速度：约 1 小时/秒（24 秒一圈），夜间会自然转暗。
  private autoRotateOn = false;
  private static readonly AUTO_ROTATE_HOURS_PER_SEC = 1;
  /**
   * 上次 PMREM 环境贴图重建时的太阳高度角（°）。
   * 昼夜循环下 setTime 每帧被 update(dt) 驱动——环境贴图重生是「立方体贴图 + mip 模糊」的
   * 重活（锐评 P1 GPU 熔炉）：高度角变化未超阈值时不重建（IBL 反射差异肉眼不可辨），
   * 手动 setTime（滑块/时间轴）走 forceEnv=true 强制刷新（拖动即见，体验不降级）。
   * 初始 -999 保证首次 setTime 必然重建（无论手动或循环首帧）。
   */
  private lastPmremElevation = -999;
  private static readonly PMREM_ELEVATION_THRESHOLD = 2.0; // 太阳高度角变化 ≥ 2° 才重建

  /** 启动昼夜循环；已开则 no-op（实际推进由 update(dt) 驱动）。
   *  刀⑳：走 setEnvState 单一事实源（对齐 setEnabled 范式）——实例标志由 env 回调同步，
   *  且该键随 saveState/loadState 持久化，否则开关关掉预览就丢。 */
  startAutoRotate(): void {
    setEnvState({ skyAutoRotate: true }, { source: "manual" });
  }

  /** 停止昼夜循环；已停则 no-op */
  stopAutoRotate(): void {
    setEnvState({ skyAutoRotate: false }, { source: "manual" });
  }

  /** 当前是否正在昼夜循环 */
  isAutoRotating(): boolean {
    return this.autoRotateOn;
  }

  /** SceneCapability.update(dt) 钩子（对齐 water-capability 用法）：dt 单位秒，
   *  昼夜循环开启时按 1 小时/秒推进 timeOfDay；setTime 内部已取模 24。
   *  forceEnv=false：昼夜循环每帧驱动 setTime，PMREM 只按太阳高度角阈值重建
   *  （锐评 P1 GPU 熔炉修复——每帧重生环境贴图是 rAF 热路径上的重活）。 */
  update(dt: number): void {
    if (!this.enabled) return;
    this.beams.tick(dt);
    if (!this.autoRotateOn) return;
    // 昼夜循环每帧驱动 timeOfDay，PMREM 按太阳高度角阈值重建（callback 的 skyTimeOfDay
    // force 跳过 shouldOverwrite：autoRotate 推进是动画自身行为，用户拖过一次时间滑杆
    // （manual 写入）后 auto-model 写被永久拒绝 → 昼夜循环冻结；force 恢复推进语义。
    setEnvState(
      {
        skyTimeOfDay:
          (((envState.skyTimeOfDay + dt * SkyCapability.AUTO_ROTATE_HOURS_PER_SEC) % 24) + 24) % 24,
        skyForceEnv: false,
      },
      { source: "auto-model", force: true },
    );
  }

  /** 由 timeOfDay 推导太阳 elevation/azimuth（单一事实来源，避免与 setSun 双写冲突） */
  private syncSunFromTime(): void {
    const { elevation, azimuth } = this.hourToSun(envState.skyTimeOfDay);
    this.elevation = elevation;
    this.azimuth = azimuth;
  }

  /** 按一天中的小时（0-24）映射太阳位置：6=日出(东)、12=正午(南)、18=日落(西)，夜间在地平线下 → 天空转暗 */
  private hourToSun(hour: number): { elevation: number; azimuth: number } {
    const h = ((hour % 24) + 24) % 24;
    const dayAngle = ((h - 6) / 12) * Math.PI; // 6→0, 12→π/2, 18→π
    const elevation = Math.sin(dayAngle) * 70; // 峰值 70°，夜间为负 → 天空转暗
    const azimuth = 90 + ((h - 6) / 12) * 180; // 90(东)→180(南)→270(西)
    return { elevation, azimuth };
  }

  /**
   * 当前 timeOfDay 对应的太阳归一化坐标 (x: 0-1 经度, y: 0-1 纬度，0=底 1=顶)。
   * 供时间轴标记太阳位置；与 ENV_PRESETS.sunPos 同一口径。
   */
  getSunPosition(): { x: number; y: number } {
    const { elevation, azimuth } = this.hourToSun(envState.skyTimeOfDay);
    // azimuth 90~270 → x 0~1；elevation -70~70 → y 0~1（70=顶 1.0，-70=底 0.0）
    const x = (azimuth - 90) / 180;
    const y = (elevation + 70) / 140;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }

  /**
   * 按时间设置太阳位置（time-of-day），联动天空与 IBL 环境。
   * @param opts.forceEnv 是否强制重建 PMREM 环境贴图（默认 true——滑块/时间轴手动
   *   setTime 都是用户主动调参，拖动即见 + 既有测试不改语义）；
   *   传 false 走阈值门控：太阳高度角变化 < PMREM_ELEVATION_THRESHOLD 不重建
   *   （昼夜循环 update(dt) 每帧调用，锐评 P1 GPU 熔炉修复）。
   */
  setTime(hour: number, opts?: { forceEnv?: boolean }): void {
    const forceEnv = opts?.forceEnv ?? true;
    // ADR-196 收口：纯写 envState，渲染应用（syncSun/writeUniforms/PMREM 门控/godrays/tint）
    // 统一走 registerEnvCallback 的 skyTimeOfDay 分支。
    setEnvState(
      { skyTimeOfDay: ((hour % 24) + 24) % 24, skyForceEnv: forceEnv },
      { source: "manual" },
    );
  }

  getTimeOfDay(): number {
    return envState.skyTimeOfDay;
  }

  /** 当前是否联动 IBL 环境贴图（下拉开关初始化用） */
  isEnvironmentEnabled(): boolean {
    return envState.skyEnvironment;
  }

  /**
   * [ADR-292 D2] 烘焙一张天空 IBL 纹理并**交回调用方**——本方法**不写 scene.environment**。
   *
   * 所有权收口：`scene.environment` 的唯一写者是 EnvironmentCapability（D1）。本能力
   * 降级为数据源提供者，只负责「烤」，装载由 env 决定。这样两个 cap 不再互相覆盖
   * （旧实现：本类 regenerateEnvironment 直接写槽位，env cap 也写，后写者赢）。
   *
   * 返回的纹理归**本能力**所有（由 this.renderTarget 持有），生命周期随本 cap 的
   * dispose/重建；调用方**不得** dispose 它，也不得跨重建长期持有。
   *
   * @returns PMREM 预滤波后的环境纹理；烘焙失败时 null（调用方应安全降级）
   */
  bakeEnvironmentTexture(): THREE.Texture | null {
    return this.bakeEnvironment() ? (this.renderTarget?.texture ?? null) : null;
  }

  /** 当前云量（ADR-085 S2：菜单初始化惰性读，消灭硬编码 "0%"） */
  getCloudCoverage(): number {
    return envState.skyCloudCoverage;
  }

  // ── 日落光束 + Sunset Tint（实现已下沉 sun-beams.ts；本类仅保留公开面并委派）──

  /** 获取 god rays intensity（0~1，elevation<20° 时激活） */
  getGodRaysIntensity(): number {
    return godRaysIntensity(this.elevation);
  }

  /** 获取 sunset tint intensity（与 god rays 共用同一强度曲线） */
  getSunsetTintIntensity(): number {
    return godRaysIntensity(this.elevation);
  }

  /** 是否启用 god rays */
  isGodRaysEnabled(): boolean {
    return this.beams.isEnabled();
  }

  /** 切换 god rays 开关（enabled 时立即按当前太阳角同步挂载） */
  setGodRaysEnabled(v: boolean): void {
    this.beams.setEnabled(v);
    if (this.enabled) this.beams.sync(this.elevation, this.azimuth);
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  /** 完整参数面板节点树：sky-enabled 总开关 + timeline controls 节点 + sky-env
   *  平铺原生 + 高级组 folder（时间 slider 已删，见 sky-menu.ts 注释）。 */
  getMenuNodes(): PreviewMenuNode[] {
    return buildSkyNodes(this);
  }

  /* -------- ADR-195 刀3：getMasterNodeId（替代 getMasterToggle）-------- */

  /** 能力主开关节点 id：env 面板据此升 headerToggle + body 剔除同源 */
  getMasterNodeId(): string {
    return "sky-enabled";
  }

  /** 环境面板归属（ADR-268）：基础卡首位 */
  getEnvPlacement(): EnvPlacement {
    return { section: "basic", order: 10 };
  }

  /** 保存状态到 localStorage */
  saveState(): void {
    persistState(this.id, {
      timeOfDay: envState.skyTimeOfDay,
      cloudCoverage: envState.skyCloudCoverage,
      environment: envState.skyEnvironment,
      enabled: this.enabled,
      godRaysEnabled: this.beams.isEnabled(),
      // 刀⑳：昼夜循环开关纳入持久化（原漏 → 关掉预览即丢）
      autoRotate: envState.skyAutoRotate,
      // §4 解耦：持久化用户调整的太阳耦合尺度
      sunIntensityScale: envState.skySunIntensityScale,
      sunDiscScale: envState.skySunDiscScale,
    });
  }

  /** 从 localStorage 恢复状态（字段恢复走 restoreFields，消除与 ground/water 同构的 typeof 样板） */
  loadState(): void {
    restoreFields(restoreState(this.id), {
      enabled: {
        boolean: (v) => {
          this.enabled = v;
        },
      },
      timeOfDay: {
        number: (v) => {
          setEnvState({ skyTimeOfDay: v }, { source: "manual" });
        },
      },
      cloudCoverage: {
        number: (v) => {
          setEnvState({ skyCloudCoverage: v }, { source: "manual" });
        },
      },
      environment: {
        boolean: (v) => {
          setEnvState({ skyEnvironment: v }, { source: "manual" });
        },
      },
      godRaysEnabled: {
        boolean: (v) => {
          this.beams.setEnabled(v);
        },
      },
      // 刀⑳：恢复昼夜循环开关（写 envState → 回调同步实例标志）
      autoRotate: {
        boolean: (v) => {
          setEnvState({ skyAutoRotate: v }, { source: "manual" });
        },
      },
      // §4 解耦：恢复用户调过的耦合尺度（如果有值）；无值保留 DEFAULT 兜底
      sunIntensityScale: {
        number: (v) => {
          setEnvState({ skySunIntensityScale: v }, { source: "manual" });
        },
      },
      sunDiscScale: {
        number: (v) => {
          setEnvState({ skySunDiscScale: v }, { source: "manual" });
        },
      },
    });
  }

  private detach(): void {
    if (this.sky.parent) this.sky.parent.remove(this.sky);
    this.clearEnvironment();
    this.beams.detach();
    // 回滚 tone mapping：setEnabled(false) 时天空消失但 renderer 仍 ACESFilmic 的问题。
    // 引用计数仲裁多 session 共享 renderer，只在最后一个贡献过的 session 退出时还原。
    this.releaseTone();
  }

  /** 回滚本实例对共享 tone 状态的贡献（幂等：toneApplied=false 后再调无副作用） */
  private releaseTone(): void {
    if (!this.toneApplied) return;
    const cnt = SkyCapability.toneRefCount.get(this.renderer) ?? 0;
    if (cnt <= 1) {
      this.renderer.toneMapping =
        SkyCapability.prevToneMap.get(this.renderer) ?? this.prevToneMapping;
      this.renderer.toneMappingExposure =
        SkyCapability.prevExposureMap.get(this.renderer) ?? this.prevExposure;
      SkyCapability.toneRefCount.delete(this.renderer);
      SkyCapability.prevToneMap.delete(this.renderer);
      SkyCapability.prevExposureMap.delete(this.renderer);
    } else {
      SkyCapability.toneRefCount.set(this.renderer, cnt - 1);
    }
    this.toneApplied = false;
  }

  dispose(): void {
    this.stopAutoRotate();
    this.unsubscribeEnv();
    this.detach();
    // 守卫依据：本能力生成过的 environment 贴图引用（须在 renderTarget dispose/置空前捕获）
    const ownedEnv = this.renderTarget?.texture ?? null;
    if (this.renderTarget) {
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
    // tone mapping 已由 detach()→releaseTone() 回滚，此处不再重复处理。
    // dispose 还原 scene.environment 到构造前状态（detach 仅 clearEnvironment 不还原 prev）。
    // 仅当当前 environment 仍归本能力所有（自建贴图或已被
    // clearEnvironment 置 null）才还原——environment-capability（HDR）若在本能力之后写过
    // scene.environment，无条件还原会把别人的贴图冲掉。
    if (this.scene.environment === null || this.scene.environment === ownedEnv) {
      this.scene.environment = this.prevEnvironment;
    }
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.envSky.geometry.dispose();
    (this.envSky.material as THREE.Material).dispose();
    this.pmrem?.dispose();
    // 释放日落光束 + tint overlay（SunBeams.dispose：disposeObject3D uuid 去重——
    // 光束两 mesh 共享 material 只释放一次）
    this.beams.dispose();
  }
}
