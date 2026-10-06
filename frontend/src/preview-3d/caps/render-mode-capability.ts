// ===== RenderModeCapability：统一渲染模式覆盖（ADR-196 迁移至 envState）=====
// 场景级渲染属性：线框 / 混合模式 / 深度测试 / 面剔除 / 深度写入。
// 遍历 scene 所有 Mesh.material，快照原始值 → 覆盖 → 还原（不 clone 材质）。
// 每个属性独立 override（null = 不覆盖原始值），组合生效。
// 纯属性切换零额外 GPU 开销——全是光栅化/管线级开关。

import * as THREE from "three";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";
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
  readonly icon = "appearance";
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

  /** 单材质拍快照（已存在则跳过）——collectSnapshot 首批与 applyOverrides 补拍共用 */
  private collectOne(mat: THREE.MeshBasicMaterial): void {
    if (this.snapshot.has(mat.uuid)) return;
    this.snapshot.set(mat.uuid, {
      wireframe: mat.wireframe ?? false,
      blending: mat.blending ?? THREE.NormalBlending,
      depthTest: mat.depthTest ?? true,
      side: mat.side ?? THREE.FrontSide,
      depthWrite: mat.depthWrite ?? true,
    });
  }

  private collectSnapshot(): void {
    this.snapshot.clear();
    for (const m of collectMaterials(this.scene)) {
      this.collectOne(m as THREE.MeshBasicMaterial);
    }
  }

  private applyOverrides(): void {
    for (const m of collectMaterials(this.scene)) {
      const mat = m as THREE.MeshBasicMaterial;
      // 覆盖生效期间新加入场景的材质（多模型同框 / switchTo 追加）不在首批快照里。
      // 若不补拍：本函数会**覆盖它**，而 restoreSnapshot 因无 uuid 跳过它 ⇒
      // cap 亲手写的覆盖值永久残留（2026-09 实测复现的真 bug）。
      // 补拍时机即「首次被本函数触及」，此刻的值就是它的原始值。
      this.collectOne(mat);
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

  /** 单属性应用：override 非 null → 用它；override null 且**该材质**曾被覆盖 → 回落快照；从未覆盖 → 保持现值 */
  private applyProp<T>(
    key: string,
    mat: THREE.MeshBasicMaterial,
    ov: T | null,
    orig: MaterialSnapshot | undefined,
    set: (v: T) => void,
  ): void {
    // [锐评 X-1 2026-10-04] 覆盖账本必须按 **(材质, 属性)** 记账，不能只按属性名：
    // 原实现用全局 `Set<属性名>`，首个材质回落后就 `delete(key)`，其余材质 `has(key)` 变 false
    // ⇒ 多 mesh 场景下「关线框」只有一个 mesh 回退（画面直接错）。
    // 测试盲区 = 部分清除用例只用了单材质；多材质用例走的是全清路径（restoreSnapshot 遍历全部）。
    const propKey = `${mat.uuid}:${key}`;
    if (ov !== null) {
      this.coveredProps.add(propKey);
      set(ov as T);
      return;
    }
    if (this.coveredProps.has(propKey)) {
      this.coveredProps.delete(propKey);
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

  /**
   * 菜单 select 值归一（刀⑳ 真 bug 修复）。
   *
   * `menu/cap-controls.ts` 的 select 渲染层恒传 **string**（`sel.value` 本就是 string，
   * 且 options 由 `String(THREE.AdditiveBlending)` 构造），而 `mat.blending` / `mat.side`
   * 只认 **number**。原实现直接 `v as number | null` 断言落库（`as number` 本身即是
   * 「类型其实不是 number」的信号），运行期 string 原样存进 envState → `mat.blending = "2"`
   * → three 的 WebGLState.setBlending 是数值 switch/case，字符串不匹配任何 case，
   * 落 `default: error('WebGLState: Invalid blending')` ⇒ 用户点「叠加」「双面」**毫无反应**。
   *
   * 归一收口在此（cap 是「控件基元 → 领域值」的边界），渲染层与其它 cap 不必各自处理。
   * 非法输入回落 null（= 不覆盖），与 select 未选中的语义一致。
   */
  private static normalizeEnum(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  setBlending(v: THREE.Blending | null): void {
    setEnvState(
      { renderModeBlending: RenderModeCapability.normalizeEnum(v) },
      { source: "manual" },
    );
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
    setEnvState({ renderModeSide: RenderModeCapability.normalizeEnum(v) }, { source: "manual" });
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
    // [锐评 F-2] 恢复路径来源纪律（fog F-2 / light L-1 / ground / reflector 同口径）：
    // 存档恢复是**程序化动作**，非用户手改 → auto-model。原实现写 manual 把 renderMode
    // 组 5 键的 lastWriteSource 冻成最高优先级，此后同轨 auto-model 写入被
    // shouldOverwrite 静默吞掉（值不变、无报错）。dispose 同理（见下方 dispose）：
    // 同样不得写 manual，否则下会话 loadState 的 auto-model 恢复被本会话残留戳静默拒
    // ——这是 W1 跨会话污染的唯一来源，现已一并收口。
    if (Object.keys(partial).length > 0) setEnvState(partial, { source: "auto-model" });
    this.sync();
  }

  /* -------- 释放 -------- */

  dispose(): void {
    this.unsubscribeEnv();
    if (this.snapshot.size > 0) this.restoreSnapshot();
    // [W1 修复] 清回默认须走 auto-model + force，不得 manual：
    // ① dispose 是「程序化清回默认」，与 loadState 同源（恢复路径来源纪律）；
    // ② 本会话用户可能手改过该键（prev="manual"），不 force 会被 shouldOverwrite 静默拒、
    //    override 值残留到下会话；force 才真把值清回 null；
    // ③ force 写入把 _writeSource 戳置为 auto-model（而非 manual）——否则下会话
    //   loadState 的 auto-model 恢复被本会话残留戳静默拒（renderMode 覆盖关预览再开
    //   不复现，是 W1 跨会话污染的唯一来源：全仓仅此一处 dispose 写 envState manual）。
    setEnvState(
      {
        renderModeWireframe: null,
        renderModeBlending: null,
        renderModeDepthTest: null,
        renderModeSide: null,
        renderModeDepthWrite: null,
      },
      { source: "auto-model", force: true },
    );
    this.snapshot.clear();
    this.coveredProps.clear();
  }
}
