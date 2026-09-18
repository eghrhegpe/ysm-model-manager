// ===== WaterCapability：水面能力（ADR-196 迁移至 envState）=====
// 独立前水面是 GroundCapability 的「双子域」；拆分后成为环境面板一等公民（与 sky/ground 平级）。
// 波浪 shader 注入（onBeforeCompile）+ 程序化法线贴图（generateNormalMap）仍为水面专属技术基盘，
// 不与他人共享，故不另抽共享模块（YAGNI）。

import * as THREE from "three";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { assertRevisionRange, reportPatchIssue } from "@/preview-3d/shader-patches/patch-guard.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
// ADR-216：监听器集合工厂提级共享原语（原 scene-capability 本地定义）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import {
  type EnvPlacement,
  oneOf,
  persistState,
  restoreFields,
  restoreState,
  type SceneCapability,
} from "./scene-capability.ts";
// ADR-257：形态「如何组装渲染体 / 如何解释尺寸与水位」已下沉到可注册的策略表，
// cap 只持有 WaterBody 并按语义 role 取用部件，不再出现 `mode ===` 判别联合。
import {
  clampPoolRoundness,
  getWaterBodyStrategy,
  INNER_WALL_OPACITY_FACTOR,
  type WaterBody,
  type WaterBuildContext,
  type WaterPartRole,
  type WaterTopMesh,
} from "./water-body-strategies.ts";
import { buildWaterNodes } from "./water-menu.ts";
import type { WaterMode } from "./water-state.ts";
import { WATER_MODES } from "./water-state.ts";

export type { WaterMode };

// [shader-patch 守卫] water 的 REVISION 断言在**材质构造期**执行（见 buildWaveWaterMaterial）。
// 原实现挂在 onBeforeCompile + 模块级 once flag：`waterRevisionChecked` 是进程级单例，
// 多实例（多 tab / 场景重建）下只有首个实例真正被审计，语义也难推理——现每实例每次构造断言，
// 构造频率是用户操作级（模式切换 / pool 结构字段变更），开销可忽略。

export class WaterCapability implements SceneCapability {
  readonly id = "water";
  readonly labelKey = "preview.water";
  readonly icon = "ocean";
  readonly descKey = "preview.waterDesc";

  private scene: THREE.Scene;
  private water: WaterBody;
  private waterTime: { value: number };
  private enabled: boolean;
  /** 参数变更监听（menu 局部刷新用）；仅模式切换等影响分组可见性的离散操作 notify */
  private readonly listenerSet = createListenerSet();
  /** 法线贴图实例级缓存 */
  private normalMapCache: THREE.DataTexture | null = null;
  private normalMapCacheSize = -1;
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;

  constructor(opts: {
    scene: THREE.Scene;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.enabled = opts.enabled ?? true;
    this.waterTime = { value: 0 };
    this.water = this.rebuildWaterContainer(true);

    // ADR-196：订阅 envState 变更——渲染应用统一收敛到此回调：
    // 结构字段（mode/size/池体几何）→ 重建容器；参数字段 → 就地改材质/uniform；
    // 子域开关 → 只切可见性。setter 只负责写 envState（不再各自就地改材质，避免双写）。
    // 只接收 water 组的键（dispatcher 前置过滤）。
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed, _state) => {
        // 形态自身的切换必然重建；其余结构字段由当前形态自行声明（ADR-257 B 档）——
        // 新增形态无需回来改动本回调。
        const needsRebuild =
          changed.has("waterMode") ||
          getWaterBodyStrategy(envState.waterMode).needsRebuild(changed);
        if (needsRebuild) {
          // rebuildWaterContainer 内部已
          // syncWaterVisibility（L323 由已更新的 envState 重算 visible）——此处重复
          // 调用是纯 no-op，删除（film/pool/wetness 门控单一入口，便于推理）
          this.rebuildWaterContainer(false);
          if (changed.has("waterMode")) this.notify();
          return;
        }
        if (changed.has("waterEnabled")) {
          this.syncWaterVisibility();
          return;
        }
        // 参数字段：就地应用（不重建容器，材质句柄保持稳定）
        this.applyChangedParams(changed);
        if (changed.has("waterWetness")) this.syncWaterVisibility();
      },
      "water",
    );
  }

  // ── 水材质（波浪 shader + 法线贴图）：film 顶 / pool 顶 共用，避免技术分叉 ──
  private buildWaveWaterMaterial(opts: { forPool: boolean }): THREE.MeshPhysicalMaterial {
    // [shader-patch 守卫] REVISION 断言：water 锚点是渲染管线稳定 chunk 标记，给宽松范围
    // [185,190)，升级审计后再收窄。失配即 throw → registry 工厂兜底使本 cap 缺失，拒绝静默降级。
    assertRevisionRange({
      module: "water-patch",
      allowed: ["185", "186", "187", "188", "189"],
    });
    // 升级到 MeshPhysicalMaterial：pool 模式用 transmission/thickness 体现「水体厚度感」，film 仍降级为原视觉
    const mat = new THREE.MeshPhysicalMaterial({
      color: envState.waterColor,
      transparent: true,
      opacity: envState.waterOpacity * (opts.forPool ? 1 : envState.waterWetness),
      roughness: 0.15,
      metalness: opts.forPool ? 0.0 : 0.3,
      depthWrite: false,
      transmission: opts.forPool ? envState.waterClarity : 0,
      // ADR-257：语义重述为「容器内水的光程」——由容器深度派生，随 poolHeight 变化、
      // 不随 waterLevel 变化（它是容器属性，不描述水面位置）。
      thickness: opts.forPool ? Math.max(0.01, envState.waterPoolHeight * 0.5) : 0,
      clearcoat: opts.forPool ? 0.8 : 0,
      clearcoatRoughness: 0.1,
    });

    mat.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
      mat.userData.shader = shader;
      shader.uniforms.uTime = this.waterTime;
      shader.uniforms.uRoundness = {
        value: opts.forPool ? clampPoolRoundness(envState.waterPoolRoundness) : 0,
      };
      shader.uniforms.uHalfSize = { value: envState.waterSize / 2 };
      shader.uniforms.uSize = { value: envState.waterSize };
      shader.uniforms.uChoppiness = { value: envState.waterChoppiness };
      shader.uniforms.uBaseOpacity = { value: mat.opacity };
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
         uniform float uSize;
         uniform float uHalfSize;
         uniform float uBaseOpacity;
         uniform float uRoundness;
         uniform float uChoppiness;
         varying vec3 vWorldPos_wave;
         varying float vFoam;
         const int GERSTNER_COUNT = 6;
         float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
         // Gerstner 余摆线：返回**物体空间位移**；out 碎波泡沫 + out 物体空间法线。
         // 方向/相位由 wave index hash 播种，freq*=1.19 amp*=0.82 几何级数；
         // 陡度钳制 per-wave σ·k ≤ 0.8/N → Σ ≤ 0.8 防自交。
         //
         // ⚠️ 尺度约定（2026-09-18 实证修正，两处换算缺一不可）：
         // 波场定义在世界水平尺度上——p = position.xy * uSize 即世界水平坐标（水面 mesh 为
         // 单位平面 × scale(uSize,uSize,1)，故局部 1 单位 = 世界 uSize 单位；高度轴 scale.z=1 同尺度）。
         //   · 位移：水平分量是**世界量**，加进局部坐标前须 /sizeSafe；高度分量 scale.z=1 无需换算。
         //   · 法线：解析式给出的是「世界水平偏导」，而 objectNormal 必须是**物体空间法线**——
         //     各向异性缩放经 normalMatrix（逆缩放）还原，故水平分量须 ×sizeSafe。
         // 修正前二者同时漏换算（几何法线偏离解析值平均 94°、最大 179°＝大面积翻面；
         // 修正后 2.4°/7.0°，仅剩一阶近似残差）——数值实证脚本与结论见 ADR-257 §6.4。
         vec3 gerstner(vec2 p, out float foam, out vec3 nrm) {
           vec3 disp = vec3(0.0);
           float jxx = 0.0, jzz = 0.0, jxz = 0.0;
           nrm = vec3(0.0);
           // 防除零：waterSize 只能来自存档（无 UI 入口），脏数据 0 会让 /uSize 产生 NaN 几何，
           // 故取正下界；上方 loadState 另有 ≥1 的入口钳制（两道防线，语义不同：此处只求非零）。
           float sizeSafe = max(uSize, 0.001);
           for (int i = 0; i < GERSTNER_COUNT; i++) {
             float fi = float(i);
             float ang = hash11(fi + 1.0) * 6.2831853;
             vec2 dir = vec2(cos(ang), sin(ang));
             float freq = 0.25 * pow(1.19, fi);
             float amp = min(0.6 * pow(0.82, fi) / freq, 0.5);
             float speed = sqrt(9.8 * freq);
             float wa = freq * amp;
             float steep = clamp(uChoppiness * 0.8 / (wa * float(GERSTNER_COUNT)), 0.0, 0.8 / (wa * float(GERSTNER_COUNT)));
             float phase = freq * dot(dir, p) - speed * uTime;
             float c = cos(phase), s = sin(phase);
             disp.x += steep * amp * dir.x * c / sizeSafe;
             disp.y += steep * amp * dir.y * c / sizeSafe;
             disp.z += amp * s;
             // 泡沫掩码 = 水平压缩量：偏导按位移项逐项取（Jacobian 启发式）
             jxx += steep * wa * dir.x * dir.x * c;
             jzz += steep * wa * dir.y * dir.y * c;
             jxz += steep * wa * dir.x * dir.y * c;
             // 法线偏导：世界水平偏导 -Σ D·WA·C → 物体空间须 ×size；高度轴 -Σ Q·WA·S 同尺度
             nrm.x -= dir.x * wa * c * sizeSafe;
             nrm.y -= dir.y * wa * c * sizeSafe;
             nrm.z -= steep * wa * s;
           }
           nrm.z += 1.0;
           nrm = normalize(nrm);
           float J = (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
           foam = smoothstep(0.0, -0.25, J);
           return disp;
         }`,
      );
      // 解析法线覆盖：必须在 beginnormal_vertex **之后**（objectNormal 由该 chunk 声明）、
      // defaultnormal_vertex **之前**（后者经 normalMatrix 变换并对背面翻转）。
      // 此处只能用 position 属性——transformed 尚未在 begin_vertex 定义。
      // gerstner 交付的 nrm 已是物体空间法线（尺度换算见其头注），可直接赋给 objectNormal。
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
         {
           float gnf;
           vec3 ysmWaveNormal;
           gerstner(position.xy * uSize, gnf, ysmWaveNormal);
           objectNormal = ysmWaveNormal;
         }`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vec2 wpos = transformed.xy * uSize;
         float gf;
         vec3 gWaveNormalUnused;
         vec3 gdisp = gerstner(wpos, gf, gWaveNormalUnused);
         transformed.x += gdisp.x;
         transformed.y += gdisp.y;
         transformed.z += gdisp.z;
         vFoam = gf;
         vec4 worldPosWave = modelMatrix * vec4(transformed, 1.0);
         vWorldPos_wave = worldPosWave.xyz;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
         uniform float uRoundness;
         uniform float uHalfSize;
         uniform float uBaseOpacity;
         varying vec3 vWorldPos_wave;
         varying float vFoam;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace("void main() {", "void main() {\n");
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
         if (uRoundness > 0.0) {
           vec2 p = vWorldPos_wave.xz;
           float md = max(abs(p.x), abs(p.y));
           float edge = uHalfSize - uRoundness * uHalfSize;
           float fade = 1.0 - smoothstep(edge, uHalfSize, md);
           gl_FragColor.a *= fade;
         }
         // 碎波泡沫：Jacobian<0 处 mix 白沫（不依赖反射，单 pass 廉价）
         gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.92, 0.95, 0.98), vFoam * 0.55);
         gl_FragColor.a = min(gl_FragColor.a, uBaseOpacity);`,
      );
      // [shader-patch 守卫] 注入检测：多次无条件 replace 原本零检测（失配全静默）。
      // 现检查三处关键符号是否落地——vertex 的 wave 函数 / beginnormal 的法线覆盖 /
      // fragment 的 uRoundness 裁剪段，任一缺失即告警（console 兜底），不再静默降级
      const vertexOk = shader.vertexShader.includes("vec3 gerstner(");
      const normalOk = shader.vertexShader.includes("objectNormal = ysmWaveNormal;");
      const fragOk = shader.fragmentShader.includes("uRoundness");
      if (!vertexOk || !normalOk || !fragOk) {
        reportPatchIssue(
          "water",
          `water onBeforeCompile 锚点失配（vertex=${vertexOk ? "ok" : "miss"} normal=${normalOk ? "ok" : "miss"} fragment=${fragOk ? "ok" : "miss"}），水面波浪法线 / 波纹 / 圆角 / 透明度 clamp 可能失效。请检查 three 渲染管线 chunk 标记是否变更。`,
          "warn",
        );
      }
    };
    mat.needsUpdate = true;

    const normalMap = this.getNormalMap();
    (mat as THREE.MeshPhysicalMaterial & { normalMap: THREE.DataTexture | null }).normalMap =
      normalMap;
    (mat as THREE.MeshPhysicalMaterial & { normalScale: THREE.Vector2 }).normalScale =
      new THREE.Vector2(envState.waterNormalStrength, envState.waterNormalStrength);
    mat.needsUpdate = true;
    return mat;
  }

  /** 遍历收集某个容器（Mesh/Group）下的所有 mesh，用于同步 material 参数 */
  private collectWaterMeshes(root: THREE.Object3D = this.water.root): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) out.push(m);
    });
    return out;
  }

  /** 顶水面（承载波浪材质）——各形态在 build 时统一塞进 top，故无需再按形态分支 */
  private findTopWater(): WaterTopMesh {
    return this.water.top;
  }

  /**
   * 交给形态策略的装配上下文：材质构造（含波浪 shader 注入）与法线缓存仍留在 cap 侧，
   * strategy 只负责「用这些零件搭出什么样的水体」（ADR-257 B 档）。
   */
  private buildCtx(): WaterBuildContext {
    return {
      buildMaterial: (opts) => this.buildWaveWaterMaterial(opts),
      getNormalMap: () => this.getNormalMap(),
    };
  }

  /** 释放旧 water 容器 */
  private disposeWater(): void {
    if (this.water.root.parent) this.water.root.parent.remove(this.water.root);
    const meshes = this.collectWaterMeshes();
    for (const m of meshes) {
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const asPhysical = mat as THREE.MeshPhysicalMaterial & {
          transmissionRenderTarget?: THREE.WebGLRenderTarget | null;
        };
        const trt = asPhysical?.transmissionRenderTarget;
        if (trt) {
          trt.texture.dispose();
          trt.dispose();
        }
        mat.dispose();
      }
    }
  }

  /** 重建 this.water 根容器（形态由策略表决定） */
  private rebuildWaterContainer(initial = false): WaterBody {
    const wasInScene = !initial && this.water.root.parent != null;
    if (!initial) this.disposeWater();
    // ADR-257 B 档：形态不再在此处三元判断，交给注册表——新增形态不影响本函数。
    this.water = getWaterBodyStrategy(envState.waterMode).build(this.buildCtx());
    this.syncWaterVisibility();
    if (wasInScene && this.enabled) {
      this.scene.add(this.water.root);
    }
    return this.water;
  }

  /** 水面可见性：enabled ∧ water.enabled ∧（受 wetness 门控的形态还需 wetness>0） */
  private syncWaterVisibility(): void {
    const strategy = getWaterBodyStrategy(envState.waterMode);
    const gatePassed = strategy.wetnessGated ? envState.waterWetness > 0 : true;
    const shouldShow = this.enabled && envState.waterEnabled && gatePassed;
    this.water.root.visible = shouldShow;
  }

  /** 推进水面波纹动画（render loop 调用） */
  update(dt: number): void {
    if (!this.enabled || !envState.waterEnabled || !this.water.root.visible) return;
    this.waterTime.value += dt * envState.waterWaveSpeed;
  }

  apply(): void {
    if (!this.enabled) return;
    if (!this.water.root.parent) this.scene.add(this.water.root);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) this.apply();
    else {
      if (this.water.root.parent) this.water.root.parent.remove(this.water.root);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ── 水面：独立开关 / 形态切换 ──
  // ADR-196 收口：setter 只写 envState；渲染应用（可见性/重建/材质）统一走 registerEnvCallback。
  setWaterEnabled(v: boolean): void {
    setEnvState({ waterEnabled: v }, { source: "manual" });
  }
  getWaterEnabled(): boolean {
    return envState.waterEnabled;
  }

  setWaterMode(m: WaterMode): void {
    if (envState.waterMode === m) return;
    setEnvState({ waterMode: m }, { source: "manual" });
  }

  /** 订阅参数变更（模式切换触发）；返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }

  private notify(): void {
    this.listenerSet.notify();
  }
  getWaterMode(): WaterMode {
    return envState.waterMode as WaterMode;
  }

  // ── 水面参数（film + pool 通用）──
  // 就地渲染应用统一入口（registerEnvCallback 的参数字段分派）：不重建容器，保持材质句柄稳定。
  private applyChangedParams(changed: Set<string>): void {
    const s = envState;
    // ADR-257：形态差异一律查表，此处不再出现 `mode === "film" / "pool"` 分支。
    // film 形态下 wallInner / wallOuter / floor 均为空数组——正因如此，
    // 形如 [...targets("surface"), ...targets("wallInner")] 的表达式才能一行同时适配两种形态。
    const strategy = getWaterBodyStrategy(s.waterMode);
    const targets = (role: WaterPartRole) => strategy.getTargets(this.water, role);
    // 受 wetness 门控的形态（film）需乘上 wetness 才是有效不透明度
    const effectiveOpacity = strategy.wetnessGated
      ? s.waterOpacity * s.waterWetness
      : s.waterOpacity;

    // wetness → 顶水面 opacity + uBaseOpacity uniform（仅对受门控形态有意义）
    if (changed.has("waterWetness") && strategy.wetnessGated) {
      const mat = this.water.top.material;
      mat.opacity = effectiveOpacity;
      this.syncBaseOpacityUniform(mat, mat.opacity);
    }
    // opacity → 顶水面 + 池内壁（ADR-257 审核 Item 6：内壁透明度必须随 waterOpacity 跟随，
    // 否则拖透明度滑块时水面与池壁脱节；内壁套 INNER_WALL_OPACITY_FACTOR 与构建期一致）
    if (changed.has("waterOpacity")) {
      const top = this.findTopWater();
      if (top) top.material.opacity = effectiveOpacity;
      for (const m of targets("wallInner")) {
        (m.material as THREE.MeshPhysicalMaterial).opacity =
          s.waterOpacity * INNER_WALL_OPACITY_FACTOR;
      }
    }
    // color → 水面 + 内壁
    if (changed.has("waterColor")) {
      for (const m of [...targets("surface"), ...targets("wallInner")]) {
        const mat = m.material as THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial;
        if ("color" in mat) mat.color.setHex(s.waterColor);
      }
    }
    // normalStrength → top normalScale
    if (changed.has("waterNormalStrength")) {
      const top = this.findTopWater();
      if (top) top.material.normalScale?.set(s.waterNormalStrength, s.waterNormalStrength);
    }
    // poolWallColor → 池底 + 外壁（film 下两者皆空数组，天然 no-op）
    if (changed.has("waterPoolWallColor")) {
      for (const m of [...targets("floor"), ...targets("wallOuter")]) {
        (m.material as THREE.MeshStandardMaterial).color.setHex(s.waterPoolWallColor);
      }
    }
    // poolRoundness → top uRoundness uniform（经 clampPoolRoundness——与构造期同一钳制，
    // 防存档恢复/其他 cap 直写 envState 时越界值从这条路径漏进 uniform）
    if (changed.has("waterPoolRoundness")) {
      const top = this.findTopWater();
      if (top) {
        const shader = (
          top.material as unknown as {
            userData: { shader?: { uniforms: { uRoundness?: { value: number } } } };
          }
        ).userData?.shader;
        if (shader?.uniforms?.uRoundness) {
          shader.uniforms.uRoundness.value = clampPoolRoundness(s.waterPoolRoundness);
        }
      }
    }
    // clarity → 水面 + 内壁 transmission（仅启用体积光学的形态，避免把 film 水膜变透光体）
    if (changed.has("waterClarity") && strategy.supportsVolumeOptics) {
      for (const m of [...targets("surface"), ...targets("wallInner")]) {
        const mat = m.material as THREE.MeshPhysicalMaterial;
        if ("transmission" in mat) {
          mat.transmission = m === this.water.top ? s.waterClarity : s.waterClarity * 0.5;
          mat.needsUpdate = true;
        }
      }
    }
    // size：几何层面交由形态自行解释（film = scale + 法线重取；pool 的 size 变更已被判为重建，
    // 故能走到此处的必是支持就地更新的形态）。
    if (changed.has("waterSize")) {
      strategy.applySize(this.water, s.waterSize, this.buildCtx());
      // uSize / uHalfSize 属波浪 shader 的共享 uniform（跨形态一致），故仍留在 cap 而非下沉。
      const top = this.findTopWater();
      const topShader = (
        top?.material as unknown as {
          userData?: { shader?: { uniforms?: Record<string, { value: number }> } };
        }
      )?.userData?.shader;
      if (topShader?.uniforms?.uSize) {
        topShader.uniforms.uSize.value = s.waterSize;
        topShader.uniforms.uHalfSize.value = s.waterSize / 2;
      }
    }
    // choppiness：顶 uChoppiness uniform（film/pool 共用，ADR-255 改造 B）
    if (changed.has("waterChoppiness")) {
      const top = this.findTopWater();
      const topShader = (
        top?.material as unknown as {
          userData?: { shader?: { uniforms?: Record<string, { value: number }> } };
        }
      )?.userData?.shader;
      if (topShader?.uniforms?.uChoppiness)
        topShader.uniforms.uChoppiness.value = s.waterChoppiness;
    }
    // ADR-257：waterLevel → 水面 position.y（film/pool 通用，零重建）。
    // 解耦的全部收益在此：旧语义下抬水面必须走 pool 并重建 9 个 mesh，如今只改一个标量。
    if (changed.has("waterLevel")) {
      strategy.applyLevel(this.water, s.waterLevel);
    }
    // waterWaveSpeed：无材质应用（仅 update 累加速度读值）
  }

  private syncBaseOpacityUniform(mat: THREE.MeshPhysicalMaterial, value: number): void {
    const shader = (
      mat as unknown as {
        userData: { shader?: { uniforms?: { uBaseOpacity?: { value: number } } } };
      }
    ).userData?.shader;
    if (shader?.uniforms?.uBaseOpacity) shader.uniforms.uBaseOpacity.value = value;
  }

  setWetness(v: number): void {
    setEnvState({ waterWetness: Math.max(0, Math.min(1, v)) }, { source: "manual" });
  }
  getWetness(): number {
    return envState.waterWetness;
  }

  setWaterColor(hex: number): void {
    setEnvState({ waterColor: hex }, { source: "manual" });
  }
  getWaterColor(): number {
    return envState.waterColor;
  }

  setWaterOpacity(v: number): void {
    setEnvState({ waterOpacity: Math.max(0, Math.min(1, v)) }, { source: "manual" });
  }
  getWaterOpacity(): number {
    return envState.waterOpacity;
  }

  // ── 法线贴图强度（顶层水面）──
  setNormalStrength(v: number): void {
    setEnvState({ waterNormalStrength: Math.max(0, Math.min(1, v)) }, { source: "manual" });
  }
  getNormalStrength(): number {
    return envState.waterNormalStrength;
  }

  // ── 水池专属参数（pool 模式）──
  setPoolHeight(v: number): void {
    setEnvState({ waterPoolHeight: Math.max(0.01, v) }, { source: "manual" });
  }
  getPoolHeight(): number {
    return envState.waterPoolHeight;
  }

  setPoolWallThickness(v: number): void {
    setEnvState({ waterPoolWallThickness: Math.max(0.01, v) }, { source: "manual" });
  }
  getPoolWallThickness(): number {
    return envState.waterPoolWallThickness;
  }

  setPoolWallColor(hex: number): void {
    setEnvState({ waterPoolWallColor: hex }, { source: "manual" });
  }
  getPoolWallColor(): number {
    return envState.waterPoolWallColor;
  }

  setPoolRoundness(v: number): void {
    setEnvState({ waterPoolRoundness: clampPoolRoundness(v) }, { source: "manual" });
  }
  getPoolRoundness(): number {
    return envState.waterPoolRoundness;
  }

  setWaveSpeed(v: number): void {
    setEnvState({ waterWaveSpeed: Math.max(0, v) }, { source: "manual" });
  }
  getWaveSpeed(): number {
    return envState.waterWaveSpeed;
  }

  setChoppiness(v: number): void {
    setEnvState({ waterChoppiness: Math.max(0, Math.min(1, v)) }, { source: "manual" });
  }
  getChoppiness(): number {
    return envState.waterChoppiness;
  }

  // ── 水面高度（ADR-257：跨形态通用，与容器彻底解耦）──
  setLevel(v: number): void {
    setEnvState({ waterLevel: Math.max(0, v) }, { source: "manual" });
  }
  getLevel(): number {
    return envState.waterLevel;
  }
  setClarity(v: number): void {
    setEnvState({ waterClarity: Math.max(0, Math.min(1, v)) }, { source: "manual" });
  }
  getClarity(): number {
    return envState.waterClarity;
  }

  // ── 程序化法线贴图生成 ──
  private getNormalMap(): THREE.DataTexture {
    if (this.normalMapCache && this.normalMapCacheSize === envState.waterSize) {
      return this.normalMapCache;
    }
    if (this.normalMapCache) safeDispose(this.normalMapCache);
    this.normalMapCache = this.generateNormalMap(256);
    this.normalMapCacheSize = envState.waterSize;
    return this.normalMapCache;
  }

  private generateNormalMap(size: number): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    const sz = envState.waterSize;

    for (let v = 0; v < size; v++) {
      for (let u = 0; u < size; u++) {
        const x = (u / size - 0.5) * sz * 2;
        const y = (v / size - 0.5) * sz * 2;

        let dhdx = 0,
          dhdy = 0;

        const d1 = new THREE.Vector2(1, 0.3).normalize();
        const p1 = new THREE.Vector2(x, y);
        const phase1 = p1.dot(d1) * 0.8;
        dhdx += 0.08 * Math.cos(phase1) * d1.x * 0.8;
        dhdy += 0.08 * Math.cos(phase1) * d1.y * 0.8;

        const d2 = new THREE.Vector2(-0.4, 1).normalize();
        const p2 = new THREE.Vector2(x, y);
        const phase2 = p2.dot(d2) * 1.1;
        dhdx += 0.05 * Math.cos(phase2) * d2.x * 1.1;
        dhdy += 0.05 * Math.cos(phase2) * d2.y * 1.1;

        const d3 = new THREE.Vector2(0.2, -0.8).normalize();
        const p3 = new THREE.Vector2(x, y);
        const phase3 = p3.dot(d3) * 1.6;
        dhdx += 0.03 * Math.cos(phase3) * d3.x * 1.6;
        dhdy += 0.03 * Math.cos(phase3) * d3.y * 1.6;

        const nx = -dhdx;
        const ny = -dhdy;
        const nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const nnx = nx / len;
        const nny = ny / len;

        const idx = (v * size + u) * 4;
        data[idx] = Math.round((nnx * 0.5 + 0.5) * 255);
        data[idx + 1] = Math.round((nny * 0.5 + 0.5) * 255);
        data[idx + 2] = 255;
        data[idx + 3] = 255;
      }
    }

    return new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  getMenuNodes(): PreviewMenuNode[] {
    return buildWaterNodes(this);
  }

  /* -------- ADR-195 刀3：getMasterNodeId（替代 getMasterToggle）-------- */

  /** 能力主开关节点 id：env 面板据此升 headerToggle + body 剔除同源 */
  getMasterNodeId(): string {
    return "ground-water-enabled";
  }

  /** 环境面板归属（ADR-268）：基础卡末位 */
  getEnvPlacement(): EnvPlacement {
    return { section: "basic", order: 30 };
  }

  /** 保存状态到 localStorage */
  saveState(): void {
    persistState(this.id, {
      size: envState.waterSize,
      enabled: this.enabled,
      waterEnabled: envState.waterEnabled,
      waterMode: envState.waterMode,
      waterWetness: envState.waterWetness,
      waterColor: envState.waterColor,
      waterOpacity: envState.waterOpacity,
      waterNormalStrength: envState.waterNormalStrength,
      waterClarity: envState.waterClarity,
      waterWaveSpeed: envState.waterWaveSpeed,
      waterChoppiness: envState.waterChoppiness,
      waterLevel: envState.waterLevel,
      waterPoolHeight: envState.waterPoolHeight,
      waterPoolWallThickness: envState.waterPoolWallThickness,
      waterPoolWallColor: envState.waterPoolWallColor,
      waterPoolRoundness: envState.waterPoolRoundness,
    });
  }

  /** 从 localStorage 恢复状态 */
  loadState(): void {
    let state = restoreState(this.id) as Record<string, unknown> | null;
    // legacy.water 解包后 state.water 不存在 → 下方
    // nested 判定误判 flat → 子域开关 enabled 不写 setWaterEnabled（envState.
    // waterEnabled 保持默认 true）——「用户关水」偏好升级后丢失，重开能力水面重现
    let fromNestedLegacy = false;
    if (!state) {
      const legacy = restoreState("ground") as Record<string, unknown> | null;
      if (legacy) {
        const lw = legacy.water;
        if (lw && typeof lw === "object") {
          state = lw as Record<string, unknown>;
          fromNestedLegacy = true;
        } else if (
          typeof legacy.wetness === "number" ||
          typeof legacy.waterColor === "number" ||
          typeof legacy.waterOpacity === "number" ||
          typeof legacy.normalStrength === "number"
        ) {
          state = {
            wetness: legacy.wetness,
            waterColor: legacy.waterColor,
            waterOpacity: legacy.waterOpacity,
            normalStrength: legacy.normalStrength,
          };
        }
      }
    }
    if (!state) return;
    restoreFields(state, {
      enabled: { boolean: (v) => (this.enabled = v) },
      // waterSize 无 UI 入口、只能来自存档：脏数据 0/负数会让水面退化成一个点，
      // 且 shader 侧位移换算需要正的尺寸（/sizeSafe），故在入口钳到 ≥1（与 shader 的 0.001 下界双保险）
      size: { number: (v) => setEnvState({ waterSize: Math.max(1, v) }, { source: "manual" }) },
    });
    // 归一化：V2/旧格式水面参数在 state.water 嵌套对象；新 flat 存档直接平铺在顶层。
    // 子域开关键随格式不同：V2 嵌套用 enabled；flat 用顶层 waterEnabled。
    const nested = fromNestedLegacy
      ? state // legacy.water 解包内容即嵌套方言（含 enabled 子域开关）
      : state.water && typeof state.water === "object"
        ? (state.water as Record<string, unknown>)
        : null;
    const w = (nested ?? state) as Record<string, unknown>;
    restoreFields(w, {
      // 子域开关：仅当取到嵌套对象时 w.enabled 才是子域开关（顶层 enabled=能力级，已在上方处理）
      ...(nested
        ? { enabled: { boolean: (v) => this.setWaterEnabled(v) } }
        : { waterEnabled: { boolean: (v) => this.setWaterEnabled(v) } }),
      // 新旧键双轨（restoreFields 对缺失键安全跳过；实际存档只含一种方言）
      mode: oneOf(WATER_MODES, (v) => this.setWaterMode(v)),
      waterMode: oneOf(WATER_MODES, (v) => this.setWaterMode(v)),
      wetness: { number: (v) => this.setWetness(v) },
      waterWetness: { number: (v) => this.setWetness(v) },
      waterColor: { number: (v) => this.setWaterColor(v) },
      waterOpacity: { number: (v) => this.setWaterOpacity(v) },
      normalStrength: { number: (v) => this.setNormalStrength(v) },
      waterNormalStrength: { number: (v) => this.setNormalStrength(v) },
      waveSpeed: { number: (v) => this.setWaveSpeed(v) },
      waterWaveSpeed: { number: (v) => this.setWaveSpeed(v) },
      choppiness: { number: (v) => this.setChoppiness(v) },
      waterChoppiness: { number: (v) => this.setChoppiness(v) },
      // ADR-257：水面高度键（跨形态通用，新旧键双轨与其余参数同惯例）
      level: { number: (v) => this.setLevel(v) },
      waterLevel: { number: (v) => this.setLevel(v) },
      clarity: { number: (v) => this.setClarity(v) },
      waterClarity: { number: (v) => this.setClarity(v) },
      poolHeight: { number: (v) => this.setPoolHeight(v) },
      waterPoolHeight: { number: (v) => this.setPoolHeight(v) },
      poolWallThickness: { number: (v) => this.setPoolWallThickness(v) },
      waterPoolWallThickness: { number: (v) => this.setPoolWallThickness(v) },
      poolWallColor: { number: (v) => this.setPoolWallColor(v) },
      waterPoolWallColor: { number: (v) => this.setPoolWallColor(v) },
      poolRoundness: { number: (v) => this.setPoolRoundness(v) },
      waterPoolRoundness: { number: (v) => this.setPoolRoundness(v) },
    });
    // ADR-257 迁移：旧存档没有 waterLevel 键（旧语义里「水面 y == 池深 h」）。
    // pool 用户兜底为 waterPoolHeight 以保持原有观感；film 用户沿用默认 0.01（与旧硬编码一致）。
    // 注：mode/waterMode 在上方 restoreFields 中已先行还原，故此处读到的 waterMode 即存档形态。
    const hadLevelKey = w.level !== undefined || w.waterLevel !== undefined;
    if (!hadLevelKey && envState.waterMode === "pool") {
      this.setLevel(envState.waterPoolHeight);
    }
  }

  /** 移除并释放 */
  dispose(): void {
    this.unsubscribeEnv();
    if (this.water.root.parent) this.water.root.parent.remove(this.water.root);
    this.disposeWater();
    if (this.normalMapCache) {
      safeDispose(this.normalMapCache);
      this.normalMapCache = null;
      this.normalMapCacheSize = -1;
    }
  }
}
