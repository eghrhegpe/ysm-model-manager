// ===== FogCapability：雾效能力（ADR-073 caps/ 能力模式）=====
// 复用 THREE.Fog / THREE.FogExp2（线性 / 指数），零 addon 依赖。
// 雾是 scene.fog 纯属性，不占 draw call；切换模式时重建新雾对象赋值到 scene.fog。
// dispose() 时还原构造前的 scene.fog，不泄漏到其它预览会话。
// 按模型类别套用预设（YSM 方块雾稍淡营造空间感，MMD toon 雾更薄避免褪高光）。

import * as THREE from "three";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

export type FogMode = "linear" | "exp2";

export interface FogParams {
  enabled: boolean;
  mode: FogMode;
  /** 雾颜色（默认取天空近地色 0xaac4e8） */
  color: number;
  /** 线性雾：近距开始雾化 */
  near: number;
  /** 线性雾：远距完全雾化 */
  far: number;
  /** 指数雾：密度（0.005~0.03 常见范围；越大越浓 */
  density: number;
}

export const DEFAULT_FOG_PARAMS: FogParams = {
  enabled: false,
  mode: "linear",
  color: 0xaac4e8,
  near: 10,
  far: 200,
  density: 0.015,
};

/** 模型类别雾预设：材质特性不同，雾浓度/远近做合理初始值 */
export const FOG_PRESETS: Record<string, Partial<FogParams>> = {
  default: { ...DEFAULT_FOG_PARAMS },
  ysm: {
    // 方块场景：近处清晰，远处轻雾（100 ~ 600 尺幅）
    enabled: false, mode: "linear", color: 0xb8d0ec, near: 20, far: 600, density: 0.006,
  },
  vrm: {
    // PBR 角色：半身近景，雾薄突出主体
    enabled: false, mode: "linear", color: 0xc5d4e8, near: 50, far: 400, density: 0.008,
  },
  mmd: {
    // toon 材质高光易被雾褪：整体更薄
    enabled: false, mode: "linear", color: 0xd6e0f0, near: 80, far: 500, density: 0.005,
  },
  "mmd-scene": {
    // 场景模型：大范围雾（80 ~ 1500），营造纵深感
    enabled: false, mode: "linear", color: 0xd0daed, near: 100, far: 1500, density: 0.003,
  },
  litematic: {
    // 体素大场景：线性雾营造距离感
    enabled: false, mode: "linear", color: 0xc0d4f0, near: 30, far: 800, density: 0.004,
  },
  resourcepack: {
    // MC 方块/物品：同 YSM 口径
    enabled: false, mode: "linear", color: 0xb8d0ec, near: 20, far: 600, density: 0.006,
  },
};

export class FogCapability implements SceneCapability {
  readonly id = "fog";
  readonly labelKey = "preview.fog";
  readonly icon = "🌫️";
  readonly descKey = "preview.fogDesc";

  private scene: THREE.Scene;
  private params: FogParams;
  private enabled: boolean;
  /** 构造前 scene.fog，dispose 时还原 */
  private prevFog: THREE.Fog | THREE.FogExp2 | null;
  /** 当前挂在 scene 上的雾对象（由 createFog() 创建或 null 禁用） */
  private currentFog: THREE.Fog | THREE.FogExp2 | null = null;

  constructor(opts: {
    scene: THREE.Scene;
    params?: Partial<FogParams>;
    enabled?: boolean;
  }) {
    this.scene = opts.scene;
    this.params = { ...DEFAULT_FOG_PARAMS, ...(opts.params ?? {}) };
    this.enabled = opts.enabled ?? this.params.enabled;
    this.prevFog = (this.scene.fog as THREE.Fog | THREE.FogExp2 | null) ?? null;
  }

  /* -------- 内部：按当前 params 创建雾对象（或 null）并写回 scene.fog -------- */

  private createFog(): THREE.Fog | THREE.FogExp2 | null {
    if (!this.enabled) return null;
    if (this.params.mode === "exp2") {
      const f = new THREE.FogExp2(this.params.color, this.params.density);
      return f;
    }
    return new THREE.Fog(this.params.color, this.params.near, this.params.far);
  }

  private applyFog(): void {
    const f = this.createFog();
    this.currentFog = f;
    this.scene.fog = f;
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.applyFog();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.params.enabled = v;
    this.applyFog();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** 按模型类别套用预设；持久化状态优先（setPreset 仅做合理默认） */
  setPreset(modelType: string): void {
    const preset = FOG_PRESETS[modelType] ?? FOG_PRESETS.default;
    this.params = { ...this.params, ...preset };
    // 预设只调合理默认，不强制开启（避免覆盖用户明确的开关选择）
    this.applyFog();
  }

  /* -------- 参数变更 API -------- */

  setMode(mode: FogMode): void {
    this.params.mode = mode;
    this.applyFog();
  }

  setColor(hex: number): void {
    this.params.color = hex;
    if (this.currentFog) this.currentFog.color.setHex(hex);
    else this.applyFog();
  }

  getColor(): number {
    return this.params.color;
  }

  /** 线性雾：near / far；传任一即可 */
  setLinearRange(near?: number, far?: number): void {
    if (near !== undefined) this.params.near = near;
    if (far !== undefined) this.params.far = far;
    if (this.currentFog && this.currentFog instanceof THREE.Fog) {
      this.currentFog.near = this.params.near;
      this.currentFog.far = this.params.far;
    } else {
      this.applyFog();
    }
  }

  /** 指数雾：density */
  setDensity(d: number): void {
    this.params.density = d;
    if (this.currentFog && this.currentFog instanceof THREE.FogExp2) {
      this.currentFog.density = d;
    } else {
      this.applyFog();
    }
  }

  getParams(): FogParams {
    return { ...this.params, enabled: this.enabled };
  }

  getMode(): FogMode {
    return this.params.mode;
  }

  /* -------- 菜单控件（声明式驱动）-------- */

  getMenuControls(): MenuControlDef[] {
    return [...fcBuildMain(this), ...fcBuildLinearGroup(this)];
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      enabled: this.enabled,
      mode: this.params.mode,
      color: this.params.color,
      near: this.params.near,
      far: this.params.far,
      density: this.params.density,
    });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.enabled === "boolean") { this.enabled = state.enabled; this.params.enabled = state.enabled; }
    if (state.mode === "linear" || state.mode === "exp2") this.params.mode = state.mode;
    if (typeof state.color === "number") this.params.color = state.color;
    if (typeof state.near === "number") this.params.near = state.near;
    if (typeof state.far === "number") this.params.far = state.far;
    if (typeof state.density === "number") this.params.density = state.density;
    this.applyFog();
  }

  /* -------- 生命周期：还原 prevFog -------- */

  dispose(): void {
    // 还原构造前 scene.fog（可能为 null）
    this.scene.fog = this.prevFog;
    this.currentFog = null;
  }
}

function fcBuildMain(cap: FogCapability): MenuControlDef[] {
  const self = cap as unknown as {
    params: { density: number };
  };
  return [
    {
      id: "fog-enabled",
      kind: "toggle",
      labelKey: "preview.fog",
      fallback: "雾效",
      getValue: () => cap.isEnabled(),
      setValue: (v) => cap.setEnabled(v as boolean),
    },
    {
      id: "fog-color",
      kind: "color",
      labelKey: "preview.fogColor",
      fallback: "雾色",
      group: "preview.fogGroupParams",
      getValue: () => cap.getColor(),
      setValue: (v) => cap.setColor(v as number),
    },
    {
      id: "fog-mode",
      kind: "select",
      labelKey: "preview.fogMode",
      fallback: "雾型",
      group: "preview.fogGroupParams",
      select: [
        { value: "linear", label: "线性" },
        { value: "exp2", label: "指数" },
      ],
      getValue: () => cap.getMode(),
      setValue: (v) => cap.setMode(v as FogMode),
    },
    {
      id: "fog-density",
      kind: "slider",
      labelKey: "preview.fogDensity",
      fallback: "密度",
      group: "preview.fogGroupParams",
      slider: { min: 0.001, max: 0.1, step: 0.001 },
      getValue: () => self.params.density,
      setValue: (v) => cap.setDensity(v as number),
    },
  ];
}

function fcBuildLinearGroup(cap: FogCapability): MenuControlDef[] {
  const self = cap as unknown as {
    params: { near: number; far: number };
  };
  return [
    {
      id: "fog-near",
      kind: "slider",
      labelKey: "preview.fogNear",
      fallback: "近距",
      group: "preview.fogGroupParams",
      slider: { min: 0, max: 500, step: 1, unit: "" },
      getValue: () => self.params.near,
      setValue: (v) => cap.setLinearRange(v as number, undefined),
    },
    {
      id: "fog-far",
      kind: "slider",
      labelKey: "preview.fogFar",
      fallback: "远距",
      group: "preview.fogGroupParams",
      slider: { min: 10, max: 2000, step: 10, unit: "" },
      getValue: () => self.params.far,
      setValue: (v) => cap.setLinearRange(undefined, v as number),
    },
  ];
}
