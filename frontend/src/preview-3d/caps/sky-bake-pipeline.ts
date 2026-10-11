// ===== sky-bake-pipeline.ts（ADR-329 刀③A：天空 IBL 烘焙内核叶）=====
// 职责边界（承 env-ibl / postprocessing-composer / light-instances 叶化范式）：
//   本叶 = **PMREM 烘焙的纯内核**——PMREMGenerator 惰性创建、renderTarget 持有、
//   「太阳高度角变化阈值」门控、烘焙失败回滚。**不碰 scene.environment 槽位**
//   （D1 红线：唯一写者是 EnvironmentCapability；sky 自持路径经 cap 侧装）。
//   cap = 判据与装配——envScene/envSky（Sky 材质体系、uniform 双写）、D10 让权路由
//   （envShouldYieldSlot）、tone mapping 引用计数仲裁。
//
// ⚠️ 刀③ 为何只拆这一半（原计划 120 行整块下沉经评估收窄）：
//   ① `envScene` 内含第二套 `Sky` 实例（envSky），其 uniforms 与主天空在 cap 侧**双写**
//      （applyUniformToPair/scaleToPair + writeUniforms）；一并下沉会与 cap 形成双向耦合，
//      比现状更糟 → envSky/envScene 留 cap，叶只接收 envScene 引用；
//   ② `bakeEnvironmentTexture()` 是 EnvironmentCapability 消费的公共 API（envSource="sky"
//      通路），下沉后需同步改 env cap 调用点，而 env 侧已有 env-ibl.ts 承担装载面，
//      边界会变模糊 → 公共出口留 cap（委托叶的 bakeTexture）；
//   ③ 烘焙阈值常量与 tone 仲裁静态成员仍在 cap（前者随判据、后者与 renderer 共享态相关）。
//   即：刀③ 治的是「烘焙内核」这一真正高内聚块，判据/材质/tone 三面留在编排层。
//
// ⚠️ 拆叶易丢的不变量（勿在重构中丢）：
//   ① 阈值门控：`force=false` 时太阳高度角变化 < PMREM_ELEVATION_THRESHOLD 且已有
//      renderTarget → **不重建**（昼夜循环每帧推进 timeOfDay，无门即每帧全量 PMREM = GPU 熔炉，
//      锐评 P1 实证）；首帧（renderTarget 未建立）无条件烘焙——从无到有一律装载。
//   ② 烘焙期间 `showSunDisc=0`（隐藏太阳盘避免 PMREM 光斑伪影），**finally 必须复原为 1**
//      ——漏复原会让主路径后续 uniform 同步把太阳盘永久关掉（画面症状：太阳消失）。
//   ③ 烘焙失败时 renderTarget 置 null（fromScene 抛错时旧 RT 已 dispose 但引用悬空），
//      且门控基准 lastPmremElevation **不更新**（下次仍会真烘焙一次，不吞错误）。
//   ④ 返回纹理归本叶（renderTarget 持有）所有，调用方（env cap / cap 自持装载）**不得**
//      跨重建长期持有或 dispose——生命周期随 dispose/重建走。
//
// ⚠️ 注入口契约（写测试时踩过的坑，勿再踩）：`sunDiscUniform` 访问器**必须返回 uniform 本体引用**
//   （真实实现 = `uniforms.showSunDisc` 本身），不能返回临时对象如 `{ value: 当前值 }`
//   ——后者会让叶的写入落在临时对象上，观察点永远读到旧值，不变量②就此「假绿」。

import * as THREE from "three";
import { ringLog } from "./scene-capability.ts";

/** 太阳高度角变化 ≥ 2° 才重建（PMREM 门控阈值；与 sky-capability 判据同源迁入） */
export const PMREM_ELEVATION_THRESHOLD = 2.0;

/** 叶构造入参（cap 构造时装配后传入） */
export interface SkyBakeDeps {
  renderer: THREE.WebGLRenderer;
  /** 烘焙专用场景（cap 组装：`envScene.add(envSky)`）——叶只读它做 `fromScene`，不碰其子对象 */
  envScene: THREE.Scene;
  /** 当前太阳高度角（判据回调：叶据此与 lastPmremElevation 比阈值；cap 的 elevation 由 syncSunFromTime 写） */
  currentElevation: () => number;
  /**
   * envSky 的 showSunDisc uniform 访问器（**由 cap 注入**）——envSky 的 uniform 属主在 cap
   * （与主天空双写），叶不认得 Sky 材质类型，只能经注入的访问器翻它。
   * 传法：`() => ((envSky.material as THREE.ShaderMaterial).uniforms.showSunDisc as { value: boolean }).value`
   * 数值语义：原实现写 `0` / `1`（three 的 uniform 用 float，赋 true/false 虽等价但改变
   * 观测到的值类型——测试锁 1，勿改成布尔）。
   */
  sunDiscUniform: () => { value: number } | undefined;
}

/**
 * 天空 IBL 烘焙内核（ADR-329 刀③A）：持有 PMREMGenerator + renderTarget + 阈值门控基准。
 * cap 持一个本类实例，bakeEnvironment/ensurePMREM/renderTarget 语义全部委托，行为零变更。
 */
export class SkyBakePipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly envScene: THREE.Scene;
  private readonly currentElevation: () => number;
  private readonly sunDiscUniform: () => { value: number } | undefined;

  /** PMREMGenerator 延迟创建（构造函数不依赖 WebGL，node 测试友好） */
  private pmrem: THREE.PMREMGenerator | null = null;
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  /** 上次真烘焙时的太阳高度角（阈值门控基准；-999 = 尚未烘焙过 → 首帧无条件烘焙） */
  private lastPmremElevation = -999;

  constructor(deps: SkyBakeDeps) {
    this.renderer = deps.renderer;
    this.envScene = deps.envScene;
    this.currentElevation = deps.currentElevation;
    this.sunDiscUniform = deps.sunDiscUniform;
  }

  /** 确保 PMREMGenerator 已创建（延迟到首次需要时） */
  private ensurePMREM(): THREE.PMREMGenerator {
    if (!this.pmrem) {
      this.pmrem = new THREE.PMREMGenerator(this.renderer);
    }
    return this.pmrem;
  }

  /** 当前烘焙产物纹理（无则 null）——cap 自持装载（regenerateEnvironment）与公共出口共用。 */
  texture(): THREE.Texture | null {
    return this.renderTarget?.texture ?? null;
  }

  /** 烘焙产物是否已存在（clearEnvironment 的槽位归属判定用） */
  hasTexture(): boolean {
    return this.renderTarget !== null;
  }

  /**
   * 烘焙 IBL 纹理（**纯生产，不碰 scene.environment**）。
   *
   * [ADR-292 D2] 从 `regenerateEnvironment` 拆出的「只烤不装」半边：槽位写入归
   * cap 的 regenerateEnvironment（sky 自持路径）或 EnvironmentCapability（envSource="sky" 路径）。
   *
   * @param force 跳过「太阳高度角变化阈值」门控强制烘焙。
   *   阈值门控存在的理由：昼夜循环每帧推进 timeOfDay，无门控会**每帧全量 PMREM**
   *   （GPU 熔炉，见 sky-capability.test.ts 的云量回归）。故连续动画走阈值，
   *   离散的结构性变更（来源/预设切换）显式 force。
   *   首帧（renderTarget 尚未建立）无条件烘焙——从无到有一律装载。
   * @returns 烘焙是否成功（成功则 texture() 可读）
   */
  bake(force = false): boolean {
    if (!force) {
      // ⚠️ 不变量①：阈值门控（首帧无 RT 时无条件烘焙）
      const dirty =
        Math.abs(this.currentElevation() - this.lastPmremElevation) >= PMREM_ELEVATION_THRESHOLD;
      if (this.renderTarget && !dirty) return true;
    }
    // 生成环境贴图时隐藏太阳盘，避免光斑伪影（Sky 文档建议）
    // ⚠️ 不变量②：finally 必须复原 showSunDisc=1
    this.setSunDiscVisible(0);
    try {
      if (this.renderTarget) this.renderTarget.dispose();
      this.renderTarget = this.ensurePMREM().fromScene(this.envScene);
      // 同步阈值基准：任何重建路径（手动 forceEnv / 循环阈值命中 / setSun / preset）
      // 都以此时太阳高度角为新的门控基准，避免循环在手动调参后首帧冗余重建。
      this.lastPmremElevation = this.currentElevation();
      return true;
    } catch (e) {
      ringLog("sky", `环境贴图生成失败: ${e}`, "error");
      // ⚠️ 不变量③：catch 后 renderTarget 可能悬空（fromScene 抛错时已 dispose 但未重置）
      this.renderTarget = null;
      return false;
    } finally {
      this.setSunDiscVisible(1);
    }
  }

  /** 开关 envSky 的太阳盘 uniform（经 cap 注入的访问器翻——envSky 的 uniform 属主在 cap） */
  private setSunDiscVisible(v: 0 | 1): void {
    const u = this.sunDiscUniform();
    if (u) u.value = v;
  }

  /** 释放烘焙资源（cap.dispose 委托；renderTarget + PMREMGenerator，three dispose 幂等） */
  dispose(): void {
    this.renderTarget?.dispose();
    this.renderTarget = null;
    this.pmrem?.dispose();
    this.pmrem = null;
  }
}
