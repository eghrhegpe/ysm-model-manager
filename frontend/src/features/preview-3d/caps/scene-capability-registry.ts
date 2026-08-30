// ===== 场景能力注册表（ADR-073 扩展：能力注册表驱动）=====
// 所有场景能力（Sky/Ground/Light/后续 Fog/Shadow 等）由本注册表统一创建，
// 新增能力只需：
//   1. 实现 SceneCapability 接口
//   2. 在底部 add() 注册一行
// 菜单/持久化/生命周期全部由框架驱动，零手工 wiring。

import * as THREE from "three";
import { SkyCapability } from "./sky-capability.ts";
import { GroundCapability } from "./ground-capability.ts";
import { WaterCapability } from "./water-capability.ts";
import { LightCapability } from "./light-capability.ts";
import { FogCapability } from "./fog-capability.ts";
import { ShadowCapability } from "./shadow-capability.ts";
import { ReflectorCapability } from "./reflector-capability.ts";
import { EnvironmentCapability } from "./environment-capability.ts";
import { PostprocessingCapability } from "./postprocessing-capability.ts";
import { RenderModeCapability } from "./render-mode-capability.ts";
import type { SceneCapability, SceneCapabilityLookup } from "./scene-capability.ts";

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

  /** 注册能力工厂 */
  add(factory: SceneCapabilityFactory): void {
    this.factories.push(factory);
  }

  /** 创建所有已注册能力（mount-preview-core 调用） */
  createAll(ctx: {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
  }): SceneCapability[] {
    this.dispose(); // 清理旧实例
    this.instances = [];
    for (const factory of this.factories) {
      try {
        const cap = factory({ ...ctx, caps: { getById: (id) => this.getById(id) } });
        this.instances.push(cap);
      } catch (e) {
        console.warn("[scene-cap] 能力创建失败:", e);
      }
    }
    return [...this.instances];
  }

  /** 获取所有已创建的实例 */
  getAll(): SceneCapability[] {
    return [...this.instances];
  }

  /** 按 id 查找实例 */
  getById(id: string): SceneCapability | undefined {
    return this.instances.find((c) => c.id === id);
  }

  /** 保存所有能力状态到 localStorage */
  saveAll(): void {
    for (const cap of this.instances) {
      try {
        cap.saveState();
      } catch (e) {
        console.warn(`[scene-cap] ${cap.id} 保存失败:`, e);
      }
    }
  }

  /** 从 localStorage 恢复所有能力状态 */
  loadAll(): void {
    for (const cap of this.instances) {
      try {
        cap.loadState();
      } catch (e) {
        console.warn(`[scene-cap] ${cap.id} 恢复失败:`, e);
      }
    }
  }

  /** 释放所有能力 */
  dispose(): void {
    for (const cap of this.instances) {
      try {
        cap.dispose();
      } catch (e) {
        console.warn(`[scene-cap] ${cap.id} 释放失败:`, e);
      }
    }
    this.instances = [];
  }

  /** 获取工厂数量（测试用） */
  getFactoryCount(): number {
    return this.factories.length;
  }
}

/** 全局单例（模块级单例 + 运行时状态隔离） */
export const sceneCapabilityRegistry = new SceneCapabilityRegistry();

// ============ 内置能力注册 ============
// 注意顺序：菜单渲染按注册顺序列出控件（天→地→环境→雾→阴影→反光→后处理→灯光），
// 与用户"先环境后灯光"的心智一致。
sceneCapabilityRegistry.add((ctx) => new SkyCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new GroundCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new WaterCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new EnvironmentCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new FogCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new ShadowCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new ReflectorCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new PostprocessingCapability({
  scene: ctx.scene,
  renderer: ctx.renderer,
  camera: ctx.camera,
}));
sceneCapabilityRegistry.add((ctx) => new LightCapability(ctx));
sceneCapabilityRegistry.add((ctx) => new RenderModeCapability({ scene: ctx.scene }));

/** sky 环境开关（跨组件查询属组合根职责；light ambient ×0.5 协调与截图镜像
 *  （skeleton-render）共用——原 light-capability 模块函数，上移断 registry↔light 环） */
export function isSkyEnvironmentOn(): boolean {
  return (
    (sceneCapabilityRegistry.getById("sky") as { isEnvironmentEnabled?: () => boolean } | null)
      ?.isEnvironmentEnabled?.() ?? false
  );
}
