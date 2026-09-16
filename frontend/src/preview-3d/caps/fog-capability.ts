// ===== FogCapability：雾效能力（ADR-196 迁移至 envState）=====
// 复用 THREE.Fog / THREE.FogExp2（线性 / 指数），零 addon 依赖。
// 雾是 scene.fog 纯属性，不占 draw call；模式不变时原地改字段，仅切模式才重建对象。
// dispose() 时还原构造前的 scene.fog，不泄漏到其它预览会话。

import * as THREE from "three";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import type { ModelType } from "@/preview-3d/state/model-defaults.ts";
import { pickModelDefaultFields } from "@/preview-3d/state/model-defaults.ts";
// ADR-216：监听器集合工厂提级共享原语（water 同源；fog 模式切换 notify 用）
import { createListenerSet } from "@/utils/base/primitives/listener-set.ts";
import { buildFogNodes } from "./fog-menu.ts";
import {
  oneOf,
  persistState,
  restoreFields,
  restoreState,
  type SceneCapability,
} from "./scene-capability.ts";

export type FogMode = "linear" | "exp2";

/** FogMode 合法值白名单（loadState 枚举校验用） */
const FOG_MODES = ["linear", "exp2"] as const satisfies readonly FogMode[];

export class FogCapability implements SceneCapability {
  readonly id = "fog";
  readonly labelKey = "preview.fog";
  readonly icon = "fog";
  readonly descKey = "preview.fogDesc";

  private scene: THREE.Scene;
  /** 本 cap 当前管理并写入 scene.fog 的雾对象（原地更新锚点；禁用/释放时置 null） */
  private currentFog: THREE.Fog | THREE.FogExp2 | null;
  /** 构造前 scene.fog，dispose 时还原 */
  private prevFog: THREE.Fog | THREE.FogExp2 | null;
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;
  /** 参数变更监听（menu 局部刷新用）：仅 fogMode 离散切换 notify（near/far × density 互斥显隐） */
  private readonly listenerSet = createListenerSet();

  constructor(opts: {
    scene: THREE.Scene;
  }) {
    this.scene = opts.scene;
    this.currentFog = null;
    this.prevFog = (this.scene.fog as THREE.Fog | THREE.FogExp2 | null) ?? null;

    // ADR-196：订阅 envState 变更（只接收 fog 组的键，dispatcher 前置过滤）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      (changed) => {
        // 任何 fog 组字段变更都触发 applyFog（dispatcher 已过滤，无需再判断 changed）
        this.applyFog();
        // 仅模式切换是影响菜单可见性的离散操作（near/far × density 互斥显隐经
        // visibleWhen 消费 env.fogMode）；高频滑块不得 notify（subscribe 契约）。
        if (changed.has("fogMode")) this.notify();
      },
      "fog",
    );
  }

  /** 参数变更订阅（菜单侧局部刷新）：仅 fogMode 离散切换触发（对齐 water.subscribe） */
  subscribe(listener: () => void): () => void {
    return this.listenerSet.subscribe(listener);
  }

  private notify(): void {
    this.listenerSet.notify();
  }

  /* -------- 内部：按当前 envState 落地 scene.fog（模式不变则原地改字段） -------- */

  private applyFog(): void {
    if (!envState.fogEnabled) {
      this.currentFog = null;
      // 禁用时还原构造前 scene.fog（与 dispose() 行为一致），而非置 null
      this.scene.fog = this.prevFog;
      return;
    }
    const wantExp2 = envState.fogMode === "exp2";
    const cur = this.currentFog;
    // 模式未变且对象类型匹配 → 原地改字段，不重建（调色/拖滑块不再 new 雾对象）
    if (cur && cur instanceof THREE.FogExp2 === wantExp2) {
      cur.color.setHex(envState.fogColor);
      if (cur instanceof THREE.FogExp2) {
        cur.density = envState.fogDensity;
      } else {
        cur.near = envState.fogNear;
        cur.far = envState.fogFar;
      }
    } else {
      this.currentFog = wantExp2
        ? new THREE.FogExp2(envState.fogColor, envState.fogDensity)
        : new THREE.Fog(envState.fogColor, envState.fogNear, envState.fogFar);
    }
    this.scene.fog = this.currentFog;
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.applyFog();
  }

  setEnabled(v: boolean): void {
    // 单一 gate：能力启停 === 雾开关，真值源唯一 envState.fogEnabled。
    // 旧私有 enabled 生产链路恒 true（registry ctx 无该字段），造成 master toggle
    // 显示 ON 而 scene.fog 恒 null 的脱节——本次删私有态收口。
    // setEnvState 同步 dispatch → env 回调（changed.has("fogEnabled")）applyFog 一次。
    setEnvState({ fogEnabled: v }, { source: "manual" });
  }

  isEnabled(): boolean {
    return envState.fogEnabled;
  }

  /** 按模型类别套用预设；持久化状态优先（applyModelPreset 仅做合理默认） */
  applyModelPreset(modelType: ModelType): void {
    const picked = pickModelDefaultFields(modelType, [
      "fogEnabled",
      "fogMode",
      "fogColor",
      "fogNear",
      "fogFar",
      "fogDensity",
    ]);
    if (Object.keys(picked).length > 0) setEnvState(picked, { source: "auto-model" });
  }

  /* -------- 参数变更 API -------- */

  setEnabledFog(v: boolean): void {
    setEnvState({ fogEnabled: v }, { source: "manual" });
  }

  setMode(mode: FogMode): void {
    setEnvState({ fogMode: mode }, { source: "manual" });
  }

  setColor(hex: number): void {
    // ADR-196 收口：纯写 envState；applyFog（重建雾对象）由 callback 落地。
    setEnvState({ fogColor: hex }, { source: "manual" });
  }

  getColor(): number {
    return envState.fogColor;
  }

  /** 线性雾：near / far；传任一即可 */
  setLinearRange(near?: number, far?: number): void {
    const partial: Partial<EnvState> = {};
    if (near !== undefined) partial.fogNear = near;
    if (far !== undefined) partial.fogFar = far;
    // ADR-196 收口：纯写 envState；applyFog 由 callback 落地。
    setEnvState(partial, { source: "manual" });
  }

  /** 指数雾：density */
  setDensity(d: number): void {
    // ADR-196 收口：纯写 envState；applyFog 由 callback 落地。
    setEnvState({ fogDensity: d }, { source: "manual" });
  }

  /* 菜单 getter（对齐 getMode/getColor 口径） */
  getDensity(): number {
    return envState.fogDensity;
  }
  getNear(): number {
    return envState.fogNear;
  }
  getFar(): number {
    return envState.fogFar;
  }

  getMode(): FogMode {
    return envState.fogMode as FogMode;
  }

  /** 返回完整 params 浅拷贝（UI 面板 / 测试断言用） */
  getParams() {
    return {
      enabled: envState.fogEnabled,
      mode: envState.fogMode,
      color: envState.fogColor,
      near: envState.fogNear,
      far: envState.fogFar,
      density: envState.fogDensity,
    };
  }

  /* -------- ADR-195 刀3：getMasterNodeId（替代 getMasterToggle）-------- */

  /** 能力总开关节点 id：env 面板据此升 header + body 剔除同源 */
  getMasterNodeId(): string {
    return "fog-enabled";
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  /** 完整参数面板节点树（能力总开关 + 参数组 folder） */
  getMenuNodes(): PreviewMenuNode[] {
    return buildFogNodes(this);
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      fogEnabled: envState.fogEnabled,
      fogMode: envState.fogMode,
      fogColor: envState.fogColor,
      fogNear: envState.fogNear,
      fogFar: envState.fogFar,
      fogDensity: envState.fogDensity,
    });
  }

  loadState(): void {
    let state = restoreState(this.id);
    if (!state) return;
    let s = state as Record<string, unknown>;
    // 兼容：ADR-196 前的 `enabled` 是 cap 私有态，与 fogEnabled 语义合一（本次已删私有态）。
    // 旧存档纯旧形态/混合形态只要缺 fogEnabled 键，就用 enabled 回填——防升级用户丢开关。
    if (!("fogEnabled" in s) && typeof s.enabled === "boolean") {
      state = { ...s, fogEnabled: s.enabled };
      s = state as Record<string, unknown>;
    }
    // code_review df84baefb #13（P2）：legacy 旧键迁移——ADR-196 前 fog 持久化为
    // {enabled, mode, color, near, far, density}（无前缀），迁移后只读前缀键且
    // migrateEnvState 为空透传 → 升级用户的自定义雾设置静默回默认。判据用
    // fogMode（saveState 恒写的前缀代表键）缺失 + 任一旧键存在 → 纯旧形态；
    // 只映射实际存在的旧键（防 undefined 覆盖混合形态的新前缀键）。
    // c1f4e4adb 误删本块，本次随锐评收口恢复。
    const legacyKeys = ["mode", "color", "near", "far", "density"] as const;
    if (!("fogMode" in s) && legacyKeys.some((k) => k in s)) {
      state = {
        ...s,
        ...("mode" in s ? { fogMode: s.mode } : {}),
        ...("color" in s ? { fogColor: s.color } : {}),
        ...("near" in s ? { fogNear: s.near } : {}),
        ...("far" in s ? { fogFar: s.far } : {}),
        ...("density" in s ? { fogDensity: s.density } : {}),
      };
    }
    restoreFields(state, {
      fogEnabled: { boolean: (v) => setEnvState({ fogEnabled: v }, { source: "manual" }) },
      fogMode: oneOf(FOG_MODES, (v) => setEnvState({ fogMode: v }, { source: "manual" })),
      fogColor: { number: (v) => setEnvState({ fogColor: v }, { source: "manual" }) },
      fogNear: { number: (v) => setEnvState({ fogNear: v }, { source: "manual" }) },
      fogFar: { number: (v) => setEnvState({ fogFar: v }, { source: "manual" }) },
      fogDensity: { number: (v) => setEnvState({ fogDensity: v }, { source: "manual" }) },
    });
    this.applyFog();
  }

  /* -------- 生命周期：还原 prevFog -------- */

  dispose(): void {
    this.unsubscribeEnv();
    this.currentFog = null;
    // 还原构造前 scene.fog（可能为 null）
    this.scene.fog = this.prevFog;
  }
}
