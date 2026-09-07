// ===== FogCapability：雾效能力（ADR-196 迁移至 envState）=====
// 复用 THREE.Fog / THREE.FogExp2（线性 / 指数），零 addon 依赖。
// 雾是 scene.fog 纯属性，不占 draw call；切换模式时重建新雾对象赋值到 scene.fog。
// dispose() 时还原构造前的 scene.fog，不泄漏到其它预览会话。

import * as THREE from "three";
import type { PreviewMenuNode } from "@/preview-3d/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";
import { MODEL_DEFAULTS } from "@/preview-3d/state/model-defaults.ts";
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
  readonly icon = "🌫️";
  readonly descKey = "preview.fogDesc";

  private scene: THREE.Scene;
  private enabled: boolean;
  /** 构造前 scene.fog，dispose 时还原 */
  private prevFog: THREE.Fog | THREE.FogExp2 | null;
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;

  constructor(opts: {
    scene: THREE.Scene;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.enabled = opts.enabled ?? true;
    this.prevFog = (this.scene.fog as THREE.Fog | THREE.FogExp2 | null) ?? null;

    // ADR-196：订阅 envState 变更
    this.unsubscribeEnv = registerEnvCallback(this, (changed, _state) => {
      if (
        changed.has("fogEnabled") ||
        changed.has("fogMode") ||
        changed.has("fogColor") ||
        changed.has("fogNear") ||
        changed.has("fogFar") ||
        changed.has("fogDensity")
      ) {
        this.applyFog();
      }
    });
  }

  /* -------- 内部：按当前 envState 创建雾对象（或 null）并写回 scene.fog -------- */

  private createFog(): THREE.Fog | THREE.FogExp2 | null {
    if (!this.enabled || !envState.fogEnabled) return null;
    if (envState.fogMode === "exp2") {
      const f = new THREE.FogExp2(envState.fogColor, envState.fogDensity);
      return f;
    }
    return new THREE.Fog(envState.fogColor, envState.fogNear, envState.fogFar);
  }

  private applyFog(): void {
    const f = this.createFog();
    // 禁用时还原构造前 scene.fog（与 dispose() 行为一致），而非置 null
    this.scene.fog = f ?? this.prevFog;
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.applyFog();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    // code_review df84baefb #2/#10（P1）：master toggle（fog-menu.ts set: cap.setEnabled）
    // 必须打通 envState.fogEnabled gate——createFog 的 `!envState.fogEnabled` 使旧实现
    // toggle ON 后 scene.fog 仍 null（fogEnabled 唯一写者 setEnabledFog 无生产调用方）。
    // setEnvState 同步 dispatch → env 回调（changed.has("fogEnabled")）applyFog 一次。
    // ADR-196 收口：渲染应用（applyFog）统一走 callback，不再双写。
    setEnvState({ fogEnabled: v }, { source: "manual" });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 按模型类别套用预设；持久化状态优先（applyModelPreset 仅做合理默认） */
  applyModelPreset(modelType: string): void {
    const preset =
      MODEL_DEFAULTS[modelType as keyof typeof MODEL_DEFAULTS] ?? MODEL_DEFAULTS.default;
    const partial: Partial<EnvState> = {};
    for (const key of [
      "fogEnabled",
      "fogMode",
      "fogColor",
      "fogNear",
      "fogFar",
      "fogDensity",
    ] as const) {
      if ((preset as Record<string, unknown>)[key] !== undefined)
        (partial as Record<string, unknown>)[key] = (preset as Record<string, unknown>)[key];
    }
    if (Object.keys(partial).length > 0) setEnvState(partial, { source: "auto-model" });
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
      enabled: this.enabled && envState.fogEnabled,
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
      enabled: this.enabled,
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
    // code_review df84baefb #13（P2）：legacy 旧键迁移——ADR-196 前 fog 持久化为
    // {enabled, mode, color, near, far, density}（无前缀），迁移后只读前缀键且
    // migrateEnvState 为空透传 → 升级用户的自定义雾设置静默回默认。判据用
    // fogMode（saveState 恒写的前缀代表键）缺失 + 任一旧键存在 → 纯旧形态；
    // 只映射实际存在的旧键（防 undefined 覆盖混合形态的新前缀键）。
    const legacyKeys = ["mode", "enabled", "color", "near", "far", "density"] as const;
    const s = state as Record<string, unknown>; // 非空副本（下方重新赋值会丢失 if 收窄）
    if (!("fogMode" in s) && legacyKeys.some((k) => k in s)) {
      state = {
        ...("enabled" in s ? ({ fogEnabled: s.enabled as boolean } as object) : {}),
        ...("mode" in s ? ({ fogMode: s.mode } as object) : {}),
        ...("color" in s ? ({ fogColor: s.color } as object) : {}),
        ...("near" in s ? ({ fogNear: s.near } as object) : {}),
        ...("far" in s ? ({ fogFar: s.far } as object) : {}),
        ...("density" in s ? ({ fogDensity: s.density } as object) : {}),
      };
    }
    restoreFields(state, {
      enabled: {
        boolean: (v) => {
          this.enabled = v;
        },
      },
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
    // 还原构造前 scene.fog（可能为 null）
    this.scene.fog = this.prevFog;
  }
}
