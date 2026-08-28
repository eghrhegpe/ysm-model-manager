// ===== RenderModeCapability：统一渲染模式覆盖（ADR-073 caps/ 能力模式）=====
// 场景级渲染属性：线框 / 混合模式 / 深度测试 / 面剔除 / 深度写入。
// 遍历 scene 所有 Mesh.material，快照原始值 → 覆盖 → 还原（不 clone 材质）。
// 每个属性独立 override（null = 不覆盖原始值），组合生效。
// 纯属性切换零额外 GPU 开销——全是光栅化/管线级开关。

import * as THREE from "three";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

/* -------- 属性定义 -------- */

export interface RenderModeState {
  wireframe: boolean;
  blending: THREE.Blending;
  depthTest: boolean;
  side: THREE.Side;
  depthWrite: boolean;
}

/** 每个属性的 override：null = 不覆盖（保持原始值），value = 强制为该值 */
interface RenderModeOverrides {
  wireframe: boolean | null;
  blending: THREE.Blending | null;
  depthTest: boolean | null;
  side: THREE.Side | null;
  depthWrite: boolean | null;
}

/** 无 override 时的初始状态（全部 null = 保持原始值） */
const EMPTY_OVERRIDES: RenderModeOverrides = {
  wireframe: null,
  blending: null,
  depthTest: null,
  side: null,
  depthWrite: null,
};

/** 单个材质的原始值快照 */
interface MaterialSnapshot {
  wireframe: boolean;
  blending: THREE.Blending;
  depthTest: boolean;
  side: THREE.Side;
  depthWrite: boolean;
}

/* -------- 辅助：遍历所有材质 -------- */

function collectMaterials(scene: THREE.Scene): THREE.Material[] {
  const out: THREE.Material[] = [];
  scene.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) out.push(m);
  });
  return out;
}

/* -------- 主类 -------- */

export class RenderModeCapability implements SceneCapability {
  readonly id = "renderMode";
  readonly labelKey = "preview.renderMode";
  readonly icon = "🎨";
  readonly descKey = "preview.renderModeDesc";

  private scene: THREE.Scene;
  private overrides: RenderModeOverrides = { ...EMPTY_OVERRIDES };
  /** material uuid → 原始属性快照 */
  private snapshot = new Map<string, MaterialSnapshot>();

  constructor(opts: { scene: THREE.Scene }) {
    this.scene = opts.scene;
  }

  /* -------- 快照 / 应用 / 还原 -------- */

  private collectSnapshot(): void {
    this.snapshot.clear();
    for (const m of collectMaterials(this.scene)) {
      if (this.snapshot.has(m.uuid)) continue;
      const mat = m as THREE.MeshBasicMaterial;
      this.snapshot.set(m.uuid, {
        wireframe: mat.wireframe ?? false,
        blending: mat.blending ?? THREE.NormalBlending,
        depthTest: mat.depthTest ?? true,
        side: mat.side ?? THREE.FrontSide,
        depthWrite: mat.depthWrite ?? true,
      });
    }
  }

  private applyOverrides(): void {
    for (const m of collectMaterials(this.scene)) {
      const mat = m as THREE.MeshBasicMaterial;
      if (this.overrides.wireframe !== null) mat.wireframe = this.overrides.wireframe;
      if (this.overrides.blending !== null) mat.blending = this.overrides.blending;
      if (this.overrides.depthTest !== null) mat.depthTest = this.overrides.depthTest;
      if (this.overrides.side !== null) mat.side = this.overrides.side;
      if (this.overrides.depthWrite !== null) mat.depthWrite = this.overrides.depthWrite;
    }
  }

  private restoreSnapshot(): void {
    for (const m of collectMaterials(this.scene)) {
      const orig = this.snapshot.get(m.uuid);
      if (!orig) continue;
      const mat = m as THREE.MeshBasicMaterial;
      mat.wireframe = orig.wireframe;
      mat.blending = orig.blending;
      mat.depthTest = orig.depthTest;
      mat.side = orig.side;
      mat.depthWrite = orig.depthWrite;
    }
    this.snapshot.clear();
  }

  private hasAnyOverride(): boolean {
    return Object.values(this.overrides).some((v) => v !== null);
  }

  private sync(): void {
    if (this.hasAnyOverride()) {
      if (this.snapshot.size === 0) this.collectSnapshot();
      this.applyOverrides();
    } else if (this.snapshot.size > 0) {
      this.restoreSnapshot();
    }
  }

  /* -------- 单属性 setter/getter -------- */

  setWireframe(v: boolean | null): void { this.overrides.wireframe = v; this.sync(); }
  getWireframe(): boolean | null { return this.overrides.wireframe; }

  setBlending(v: THREE.Blending | null): void { this.overrides.blending = v; this.sync(); }
  getBlending(): THREE.Blending | null { return this.overrides.blending; }

  setDepthTest(v: boolean | null): void { this.overrides.depthTest = v; this.sync(); }
  getDepthTest(): boolean | null { return this.overrides.depthTest; }

  setSide(v: THREE.Side | null): void { this.overrides.side = v; this.sync(); }
  getSide(): THREE.Side | null { return this.overrides.side; }

  setDepthWrite(v: boolean | null): void { this.overrides.depthWrite = v; this.sync(); }
  getDepthWrite(): boolean | null { return this.overrides.depthWrite; }

  /* -------- SceneCapability 接口 -------- */

  apply(): void { this.sync(); }

  setEnabled(_v: boolean): void { /* 由各属性独立控制 */ }
  isEnabled(): boolean { return this.hasAnyOverride(); }

  /* -------- 菜单控件 -------- */

  getMenuControls(): MenuControlDef[] {
    const cap = this;
    const BLENDING_OPTIONS = [
      { value: String(THREE.NormalBlending), label: "正常" },
      { value: String(THREE.AdditiveBlending), label: "叠加" },
      { value: String(THREE.MultiplyBlending), label: "正片叠底" },
      { value: String(THREE.SubtractiveBlending), label: "减去" },
    ];
    const SIDE_OPTIONS = [
      { value: String(THREE.FrontSide), label: "正面" },
      { value: String(THREE.BackSide), label: "背面" },
      { value: String(THREE.DoubleSide), label: "双面" },
    ];
    return [
      // 📐 线框
      {
        id: "rm-wireframe",
        kind: "toggle",
        labelKey: "preview.wireframe",
        fallback: "线框",
        hintKey: "preview.wireframeDesc",
        settingsOrder: 30,
        getValue: () => cap.getWireframe() === true,
        setValue: (v) => cap.setWireframe(v ? true : null),
      },
      // 🌈 混合模式
      {
        id: "rm-blending",
        kind: "select",
        labelKey: "preview.renderModeBlending",
        fallback: "混合模式",
        settingsOrder: 31,
        select: BLENDING_OPTIONS,
        getValue: () => String(cap.getBlending() ?? THREE.NormalBlending),
        setValue: (v) => cap.setBlending(v as unknown as THREE.Blending),
      },
      // 💀 X光透视（深度测试关闭 = 可看穿模型）
      {
        id: "rm-depth-test",
        kind: "toggle",
        labelKey: "preview.renderModeXray",
        fallback: "X光透视",
        hintKey: "preview.renderModeXrayDesc",
        settingsOrder: 32,
        getValue: () => cap.getDepthTest() === false,
        setValue: (v) => cap.setDepthTest(v ? false : null),
      },
      // 🔄 面剔除
      {
        id: "rm-side",
        kind: "select",
        labelKey: "preview.renderModeSide",
        fallback: "面剔除",
        settingsOrder: 33,
        select: SIDE_OPTIONS,
        getValue: () => String(cap.getSide() ?? THREE.FrontSide),
        setValue: (v) => cap.setSide(v as unknown as THREE.Side),
      },
      // ⚡ 深度写入
      {
        id: "rm-depth-write",
        kind: "toggle",
        labelKey: "preview.renderModeDepthWrite",
        fallback: "深度写入",
        hintKey: "preview.renderModeDepthWriteDesc",
        settingsOrder: 34,
        getValue: () => cap.getDepthWrite() !== false,
        setValue: (v) => cap.setDepthWrite(v ? null : false),
      },
    ];
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      wireframe: this.overrides.wireframe,
      blending: this.overrides.blending,
      depthTest: this.overrides.depthTest,
      side: this.overrides.side,
      depthWrite: this.overrides.depthWrite,
    });
  }

  loadState(): void {
    const s = restoreState(this.id);
    if (!s) return;
    if (typeof s.wireframe === "boolean" || s.wireframe === null) this.overrides.wireframe = s.wireframe;
    if (typeof s.blending === "number" || s.blending === null) this.overrides.blending = s.blending as THREE.Blending | null;
    if (typeof s.depthTest === "boolean" || s.depthTest === null) this.overrides.depthTest = s.depthTest;
    if (typeof s.side === "number" || s.side === null) this.overrides.side = s.side as THREE.Side | null;
    if (typeof s.depthWrite === "boolean" || s.depthWrite === null) this.overrides.depthWrite = s.depthWrite;
    this.sync();
  }

  /* -------- 释放 -------- */

  dispose(): void {
    if (this.snapshot.size > 0) this.restoreSnapshot();
    this.overrides = { ...EMPTY_OVERRIDES };
    this.snapshot.clear();
  }
}
