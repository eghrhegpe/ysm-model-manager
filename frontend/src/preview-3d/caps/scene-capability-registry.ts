// ===== 场景能力注册表（ADR-073 扩展：能力注册表驱动）=====
// 所有场景能力（Sky/Ground/Light/后续 Fog/Shadow 等）由本注册表统一创建，
// 新增能力只需：
//   1. 实现 SceneCapability 接口
//   2. 在底部 add() 注册一行
// 菜单/持久化/生命周期全部由框架驱动，零手工 wiring。

import type * as THREE from "three";
import { EnvironmentCapability } from "./environment-capability.ts";
import { FogCapability } from "./fog-capability.ts";
import { GroundCapability } from "./ground-capability.ts";
import { LightCapability } from "./light-capability.ts";
import { PostprocessingCapability } from "./postprocessing-capability.ts";
import { ReflectorCapability } from "./reflector-capability.ts";
import { RenderModeCapability } from "./render-mode-capability.ts";
import { ringLog, type SceneCapability, type SceneCapabilityLookup } from "./scene-capability.ts";
import { ShadowCapability } from "./shadow-capability.ts";
import { SkyCapability } from "./sky-capability.ts";
import { WaterCapability } from "./water-capability.ts";

/**
 * id ↔ 能力类型绑定表（2026-09 锐评 P2-2）：id 字符串与具体能力类型在此声明一次，
 * getById 调用点 `getById("sky")` 自动收窄为 SkyCapability，16 处手写泛型配对全部退役；
 * add(id, factory) 在注册处绑定 K ↔ CapabilityMap[K]，拼错 id / 漏挂 / 返回错类型编译期报错，
 * 运行时再由 add 的 id 校验兜底（反射/动态构造等静态盲区的最后防线）。
 */
export interface CapabilityMap {
  sky: import("./sky-capability.ts").SkyCapability;
  ground: import("./ground-capability.ts").GroundCapability;
  water: import("./water-capability.ts").WaterCapability;
  environment: import("./environment-capability.ts").EnvironmentCapability;
  fog: import("./fog-capability.ts").FogCapability;
  shadow: import("./shadow-capability.ts").ShadowCapability;
  reflector: import("./reflector-capability.ts").ReflectorCapability;
  postprocessing: import("./postprocessing-capability.ts").PostprocessingCapability;
  light: import("./light-capability.ts").LightCapability;
  renderMode: import("./render-mode-capability.ts").RenderModeCapability;
}

/** 能力 id 字面量联合（CapabilityMap 的键） */
export type CapabilityId = keyof CapabilityMap;

/** 能力工厂：接收 scene/renderer/camera，返回能力实例。
 *  ctx.caps 是 cap 间协调查询器（getById 本批实例）——cap 间联动经注入，不 import
 *  本模块（组合根 import 全部 cap，反向 import 即成模块环，check-circular 卡点） */
export type SceneCapabilityFactory = (ctx: {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  caps?: SceneCapabilityLookup;
}) => SceneCapability;

/** 注册表：管理所有场景能力的工厂和实例 */
export class SceneCapabilityRegistry {
  private factories: SceneCapabilityFactory[] = [];
  private instances: SceneCapability[] = [];
  // 上次 createAll 的宿主引用（code review #8）：三引用全等 → 实例仍挂在同一
  // scene/renderer/camera 上，直接复用返回——修复「上一 session 未 fullCleanup
  // （并发/异常路径）时旧 cap 被中途拆掉」与「dispose 后立刻原样重建」的浪费
  // （sky/water/reflector 的 render target 反复建拆）。fullCleanup 路径先 dispose
  // 清空 instances，故正常开关预览的「保存→恢复→重套预设」语义不受影响。
  private lastCtx: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
  } | null = null;

  /** 逃生阀重载（测试 fake cap / 动态注册）：不经 CapabilityMap 绑定，生产代码请用键控版 */
  add(factory: SceneCapabilityFactory): void;
  /** 注册能力工厂：id 在注册处与返回类型绑定（CapabilityMap），运行时校验防拼错/漏挂漂移 */
  add<K extends CapabilityId>(
    id: K,
    factory: (ctx: Parameters<SceneCapabilityFactory>[0]) => CapabilityMap[K],
  ): void;
  add<K extends CapabilityId>(
    idOrFactory: K | SceneCapabilityFactory,
    factory?: (ctx: Parameters<SceneCapabilityFactory>[0]) => CapabilityMap[K],
  ): void {
    if (typeof idOrFactory === "string" && typeof factory === "function") {
      const id = idOrFactory;
      this.factories.push((ctx) => {
        const cap = factory(ctx);
        if (cap.id !== id) {
          throw new Error(`[scene-cap] 能力 id 不匹配：注册为 "${id}"，实例为 "${cap.id}"`);
        }
        return cap;
      });
    } else {
      this.factories.push(idOrFactory as SceneCapabilityFactory);
    }
  }

  /** 创建所有已注册能力（mount-preview-core 调用） */
  createAll(ctx: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
  }): SceneCapability[] {
    // 同宿主复用：instances 非空且 scene/renderer/camera 三引用全等 → 现有实例
    // 仍有效，跳过 dispose→重建→apply 整套（apply 状态已就位，loadAll 由调用方
    // 按需执行不影响正确性）
    const last = this.lastCtx;
    if (
      this.instances.length > 0 &&
      last &&
      last.scene === ctx.scene &&
      last.renderer === ctx.renderer &&
      last.camera === ctx.camera
    ) {
      return [...this.instances];
    }
    this.dispose(); // 清理旧实例
    this.lastCtx = ctx;
    this.instances = [];
    for (const factory of this.factories) {
      try {
        const cap = factory({ ...ctx, caps: { getById: (id) => this.getById(id) } });
        this.instances.push(cap);
      } catch (e) {
        ringLog("scene-cap", `能力创建失败: ${e}`, "warn");
      }
    }
    return [...this.instances];
  }

  /** 获取所有已创建的实例 */
  getAll(): SceneCapability[] {
    return [...this.instances];
  }

  /** 按 id 查找实例：字面量 id 走 CapabilityMap 收窄（类型由 CapabilityMap 绑定表保证），
   *  动态字符串 id 退化为 SceneCapability（mount 层透传/lookup 场景） */
  getById<K extends CapabilityId>(id: K): CapabilityMap[K] | undefined;
  getById(id: string): SceneCapability | undefined;
  getById(id: string): SceneCapability | undefined {
    return this.instances.find((c) => c.id === id);
  }

  /** 保存所有能力状态到 localStorage */
  saveAll(): void {
    for (const cap of this.instances) {
      try {
        cap.saveState();
      } catch (e) {
        ringLog("scene-cap", `${cap.id} 保存失败: ${e}`, "warn");
      }
    }
  }

  /** 从 localStorage 恢复所有能力状态 */
  loadAll(): void {
    for (const cap of this.instances) {
      try {
        cap.loadState();
      } catch (e) {
        ringLog("scene-cap", `${cap.id} 恢复失败: ${e}`, "warn");
      }
    }
  }

  /** 释放所有能力 */
  dispose(): void {
    for (const cap of this.instances) {
      try {
        cap.dispose();
      } catch (e) {
        ringLog("scene-cap", `${cap.id} 释放失败: ${e}`, "warn");
      }
    }
    this.instances = [];
    this.lastCtx = null; // 复用记忆同步清空（dispose 后必须重建）
  }

  /** 获取工厂数量（测试用） */
  getFactoryCount(): number {
    return this.factories.length;
  }
}

/** 全局单例（模块级单例 + 运行时状态隔离） */
export const sceneCapabilityRegistry = new SceneCapabilityRegistry();

// ============ 内置能力注册 ============
// 注意顺序：菜单渲染按注册顺序列出控件（天→地→水面→环境→雾→阴影→反光→后处理→灯光→渲染模式），
// 与用户"先环境后灯光"的心智一致。
sceneCapabilityRegistry.add("sky", (ctx) => new SkyCapability(ctx));
sceneCapabilityRegistry.add("ground", (ctx) => new GroundCapability(ctx));
sceneCapabilityRegistry.add("water", (ctx) => new WaterCapability(ctx));
sceneCapabilityRegistry.add("environment", (ctx) => new EnvironmentCapability(ctx));
sceneCapabilityRegistry.add("fog", (ctx) => new FogCapability(ctx));
sceneCapabilityRegistry.add("shadow", (ctx) => new ShadowCapability(ctx));
sceneCapabilityRegistry.add("reflector", (ctx) => new ReflectorCapability(ctx));
sceneCapabilityRegistry.add(
  "postprocessing",
  (ctx) =>
    new PostprocessingCapability({
      scene: ctx.scene,
      renderer: ctx.renderer,
      camera: ctx.camera,
    }),
);
sceneCapabilityRegistry.add("light", (ctx) => new LightCapability(ctx));
sceneCapabilityRegistry.add("renderMode", (ctx) => new RenderModeCapability({ scene: ctx.scene }));

/** sky 环境开关（跨组件查询属组合根职责；light ambient ×0.5 协调与截图镜像
 *  （skeleton-render）共用——原 light-capability 模块函数，上移断 registry↔light 环） */
export function isSkyEnvironmentOn(): boolean {
  return (
    (
      sceneCapabilityRegistry.getById("sky") as { isEnvironmentEnabled?: () => boolean } | null
    )?.isEnvironmentEnabled?.() ?? false
  );
}
