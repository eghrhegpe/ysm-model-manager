// ===== RenderModeCapability：统一渲染模式覆盖（ADR-196 迁移至 envState）=====
// 场景级渲染属性：线框 / 混合模式 / 深度测试 / 面剔除 / 深度写入。
// 遍历 scene 所有 Mesh.material，快照原始值 → 覆盖 → 还原（不 clone 材质）。
// 每个属性独立 override（null = 不覆盖原始值），组合生效。
// 纯属性切换零额外 GPU 开销——全是光栅化/管线级开关。

import * as THREE from "three";
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";
import { registerEnvCallback } from "@/preview-3d/state/env-dispatcher.ts";
// ADR-196：统一状态层
import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { buildRenderModeNodes } from "./render-mode-menu.ts";
import { persistState, restoreState, type SceneCapability } from "./scene-capability.ts";

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
  /** material uuid → 原始属性快照 */
  private snapshot = new Map<string, MaterialSnapshot>();
  /** 本次覆盖会话中曾被 override 的属性 */
  private coveredProps = new Set<string>();
  /** ADR-196：取消订阅函数 */
  private unsubscribeEnv: () => void;

  constructor(opts: { scene: THREE.Scene }) {
    this.scene = opts.scene;

    // ADR-196：订阅 envState 变更（只接收 renderMode 组的键，dispatcher 前置过滤）
    this.unsubscribeEnv = registerEnvCallback(
      this,
      () => {
        // 任何 renderMode 组字段变更都触发 sync（dispatcher 已过滤）
        this.sync();
      },
      "renderMode",
    );
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
      const orig = this.snapshot.get(m.uuid);
      this.applyProp("wireframe", mat, envState.renderModeWireframe, orig, (v: boolean) => {
        mat.wireframe = v;
      });
      this.applyProp(
        "blending",
        mat,
        envState.renderModeBlending as THREE.Blending | null,
        orig,
        (v: THREE.Blending) => {
          mat.blending = v;
        },
      );
      this.applyProp("depthTest", mat, envState.renderModeDepthTest, orig, (v: boolean) => {
        mat.depthTest = v;
      });
      this.applyProp(
        "side",
        mat,
        envState.renderModeSide as THREE.Side | null,
        orig,
        (v: THREE.Side) => {
          mat.side = v;
        },
      );
      this.applyProp("depthWrite", mat, envState.renderModeDepthWrite, orig, (v: boolean) => {
        mat.depthWrite = v;
      });
    }
  }

  /** 单属性应用：override 非 null → 用它；override null 且曾被覆盖 → 回落快照；从未覆盖 → 保持现值 */
  private applyProp<T>(
    key: string,
    _mat: THREE.MeshBasicMaterial,
    ov: T | null,
    orig: MaterialSnapshot | undefined,
    set: (v: T) => void,
  ): void {
    if (ov !== null) {
      this.coveredProps.add(key);
      set(ov as T);
      return;
    }
    if (this.coveredProps.has(key)) {
      this.coveredProps.delete(key);
      if (orig !== undefined) set(orig[key as keyof MaterialSnapshot] as unknown as T);
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
    this.coveredProps.clear();
  }

  private hasAnyOverride(): boolean {
    return (
      envState.renderModeWireframe !== null ||
      envState.renderModeBlending !== null ||
      envState.renderModeDepthTest !== null ||
      envState.renderModeSide !== null ||
      envState.renderModeDepthWrite !== null
    );
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

  setWireframe(v: boolean | null): void {
    setEnvState({ renderModeWireframe: v }, { source: "manual" });
  }
  getWireframe(): boolean | null {
    return envState.renderModeWireframe;
  }

  setBlending(v: THREE.Blending | null): void {
    setEnvState({ renderModeBlending: v as number | null }, { source: "manual" });
  }
  getBlending(): THREE.Blending | null {
    return envState.renderModeBlending as THREE.Blending | null;
  }

  setDepthTest(v: boolean | null): void {
    setEnvState({ renderModeDepthTest: v }, { source: "manual" });
  }
  getDepthTest(): boolean | null {
    return envState.renderModeDepthTest;
  }

  setSide(v: THREE.Side | null): void {
    setEnvState({ renderModeSide: v as number | null }, { source: "manual" });
  }
  getSide(): THREE.Side | null {
    return envState.renderModeSide as THREE.Side | null;
  }

  setDepthWrite(v: boolean | null): void {
    setEnvState({ renderModeDepthWrite: v }, { source: "manual" });
  }
  getDepthWrite(): boolean | null {
    return envState.renderModeDepthWrite;
  }

  /* -------- SceneCapability 接口 -------- */

  apply(): void {
    this.sync();
  }

  setEnabled(_v: boolean): void {
    /* 由各属性独立控制 */
  }
  isEnabled(): boolean {
    return this.hasAnyOverride();
  }

  /* -------- ADR-195 刀2：cap 直产节点（getMenuNodes）-------- */

  getMenuNodes(): PreviewMenuNode[] {
    return buildRenderModeNodes(this);
  }

  /* -------- 持久化 -------- */

  saveState(): void {
    persistState(this.id, {
      wireframe: envState.renderModeWireframe,
      blending: envState.renderModeBlending,
      depthTest: envState.renderModeDepthTest,
      side: envState.renderModeSide,
      depthWrite: envState.renderModeDepthWrite,
    });
  }

  loadState(): void {
    const s = restoreState(this.id);
    if (!s) return;
    // 5 次条件 setEnvState 合并为单次
    // dispatch——逐字段各调一次会跑 5 遍全场景材质遍历（回调 sync）+ 5 次派发到
    // 所有已注册 cap 回调；合并 partial 后回调单次 sync 即覆盖全部字段，行为不变
    const partial: Record<string, number | boolean | null> = {};
    if (typeof s.wireframe === "boolean" || s.wireframe === null)
      partial.renderModeWireframe = s.wireframe;
    if (typeof s.blending === "number" || s.blending === null)
      partial.renderModeBlending = s.blending as number | null;
    if (typeof s.depthTest === "boolean" || s.depthTest === null)
      partial.renderModeDepthTest = s.depthTest;
    if (typeof s.side === "number" || s.side === null)
      partial.renderModeSide = s.side as number | null;
    if (typeof s.depthWrite === "boolean" || s.depthWrite === null)
      partial.renderModeDepthWrite = s.depthWrite;
    if (Object.keys(partial).length > 0) setEnvState(partial, { source: "manual" });
    this.sync();
  }

  /* -------- 释放 -------- */

  dispose(): void {
    this.unsubscribeEnv();
    if (this.snapshot.size > 0) this.restoreSnapshot();
    setEnvState(
      {
        renderModeWireframe: null,
        renderModeBlending: null,
        renderModeDepthTest: null,
        renderModeSide: null,
        renderModeDepthWrite: null,
      },
      { source: "manual" },
    );
    this.snapshot.clear();
    this.coveredProps.clear();
  }
}
