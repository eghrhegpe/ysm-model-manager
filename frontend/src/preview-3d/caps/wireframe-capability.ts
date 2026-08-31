// ===== WireframeCapability：线框模式（ADR-073 caps/ 能力模式）=====
// 场景级渲染模式：遍历 scene 所有 Mesh，切换 material.wireframe。
// 保存原始 wireframe 状态，dispose/关闭时逐个还原（不依赖材质 clone）。
// 纯属性切换零 GPU 开销——wireframe 是 Three.js 内建光栅化模式，不走额外 draw call。

import * as THREE from "three";
import {
  type SceneCapability,
  type MenuControlDef,
  persistState,
  restoreState,
} from "./scene-capability.ts";

export class WireframeCapability implements SceneCapability {
  readonly id = "wireframe";
  readonly labelKey = "preview.wireframe";
  readonly icon = "📐";
  readonly descKey = "preview.wireframeDesc";

  private scene: THREE.Scene;
  private on = false;
  /** 原始 wireframe 快照：material uuid → 原始值 */
  private snapshot = new Map<string, boolean>();

  constructor(opts: { scene: THREE.Scene }) {
    this.scene = opts.scene;
  }

  /* -------- 核心：遍历 + 切换 -------- */

  /** 递归遍历收集所有 Mesh.material 的当前 wireframe 状态（首次启用时快照） */
  private collectMaterials(): void {
    this.snapshot.clear();
    this.scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!this.snapshot.has(m.uuid)) {
          this.snapshot.set(m.uuid, (m as THREE.MeshBasicMaterial).wireframe ?? false);
        }
      }
    });
  }

  /** 将 wireframe 值写入场景所有 Mesh.material */
  private applyToAll(value: boolean): void {
    this.scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        (m as THREE.MeshBasicMaterial).wireframe = value;
      }
    });
  }

  /** 关闭时从快照还原原始 wireframe 状态 */
  private restoreAll(): void {
    this.scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const orig = this.snapshot.get(m.uuid);
        if (orig !== undefined) {
          (m as THREE.MeshBasicMaterial).wireframe = orig;
        }
      }
    });
    this.snapshot.clear();
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    if (this.on) this.applyToAll(true);
  }

  setEnabled(v: boolean): void {
    if (v && !this.on) {
      this.collectMaterials();
      this.applyToAll(true);
    } else if (!v && this.on) {
      this.restoreAll();
    }
    this.on = v;
  }

  isEnabled(): boolean {
    return this.on;
  }

  /* -------- 菜单控件 -------- */

  getMenuControls(): MenuControlDef[] {
    return [
      {
        id: "wireframe-toggle",
        kind: "toggle",
        labelKey: "preview.wireframe",
        fallback: "线框模式",
        // [doc:adr-125] 自动并入设置面板（画质分组），取代原先在
        // preview-menu/settings.ts 手写的 bsBuildWireframeToggle 重复真值来源
        settingsOrder: 30,
        getValue: () => this.on,
        setValue: (v) => this.setEnabled(v as boolean),
      },
    ];
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, { on: this.on });
  }

  loadState(): void {
    const state = restoreState(this.id);
    if (!state) return;
    if (typeof state.on === "boolean") this.setEnabled(state.on);
  }

  /* -------- 释放 -------- */

  dispose(): void {
    if (this.on) this.restoreAll();
    this.on = false;
    this.snapshot.clear();
  }
}
