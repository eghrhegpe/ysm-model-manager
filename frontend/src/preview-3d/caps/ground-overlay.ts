// ===== GroundOverlay：地面叠加层（格线叠加，锐评 2026-10-09 从 GroundCapability 拆出）=====
// 病灶：原 ground-capability.ts 915 行混装「网格 + 表面材质 + 叠加层 + 生命周期」四职责。
// 叠加层（refreshOverlay / rebuildOverlay / makeOverlayTexture）是其中**最独立**的一层——
// 不依赖网格/表面层、私有状态仅 overlayMat/overlayTex/overlaySpec。拆出后 cap 薄化、叠加层
// 独立可测，对齐既有 ground-surface-spec.ts「职责拆分」模式。
// ⚠️ 设计边界（本批**不拆**的部分）：surface 层与几何层**本质耦合**——syncGeometry 同时换装
// surface+overlay 两 mesh、createSurfaceMesh 构造内递归 refreshSurface，强行拆会引入跨模块
// 状态传递 + 间接层，收益边际递减，故 surface 层与网格层本批保留在 GroundCapability。

import * as THREE from "three";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import { envState } from "@/preview-3d/state/env-state.ts";
import {
  applyOverlayMaterial,
  buildGroundOverlaySpec,
  type GroundOverlaySpec,
  generateOverlayPixels,
  OVERLAY_TEX_SIZE,
  overlayNeedsRebuild,
  textureRepeat,
} from "./ground-surface-spec.ts";
import { GROUND_LAYER_OFFSETS } from "./layer-offsets.ts";

/** 地面叠加层：格线叠加 mesh + 材质/纹理生命周期。构造即建 mesh（visible=false）并套首帧 spec；
 *  cap 订阅 envState 变更后调 refresh()；getEnabled 用于叠加层显隐门控（能力开关 × 总开关）。 */
export class GroundOverlay {
  private overlay: THREE.Mesh;
  private overlayMat: THREE.MeshStandardMaterial | null = null;
  private overlayTex: THREE.Texture | null = null;
  private overlaySpec: GroundOverlaySpec | null = null;

  constructor(private readonly getEnabled: () => boolean) {
    const geo = new THREE.PlaneGeometry(envState.groundSize, envState.groundSize);
    const mesh = new THREE.Mesh(geo);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = GROUND_LAYER_OFFSETS.groundOverlay;
    mesh.name = "ysm-ground-overlay";
    mesh.visible = false;
    this.overlay = mesh;
    this.refresh();
  }

  /** 供 cap syncGeometry 换装（groundSize 变更）。 */
  get mesh(): THREE.Mesh {
    return this.overlay;
  }

  /** 唯一变更入口：判别重建/原地并落地（与 surface refreshSurface 同构）。 */
  refresh(): void {
    const next = buildGroundOverlaySpec({
      overlayStyle: envState.groundOverlay,
      overlayColor: envState.groundOverlayColor,
      overlaySize: envState.groundOverlaySize,
      overlayOpacity: envState.groundOverlayOpacity,
    });

    if (next.style === "none") {
      // 叠加层关闭：释放纹理，隐藏 mesh。仅在「曾激活 → none」的过渡分支做销毁——
      // 稳态 none 时每次 ground 组变更都会重入本方法，无谓置 needsUpdate 会强制材质重传。
      if (this.overlaySpec && this.overlaySpec.style !== "none") {
        if (this.overlayTex) {
          safeDispose(this.overlayTex);
          this.overlayTex = null;
        }
        if (this.overlayMat) {
          this.overlayMat.map = null;
          this.overlayMat.needsUpdate = true;
        }
      }
      this.overlay.visible = false;
      this.overlaySpec = next;
      return;
    }

    if (!this.overlaySpec || overlayNeedsRebuild(this.overlaySpec, next)) {
      this.rebuild(next);
    } else if (this.overlayMat) {
      this.overlayMat.opacity = next.opacity;
      // groundSize 变更（几何已由 syncGeometry 换装）且样式不变时走此原地分支：
      // 世界格重复密度必须跟着重算，否则「格线尺寸」与新地面脱锚。
      if (this.overlayTex) {
        const rep = textureRepeat(envState.groundSize, Math.max(1, next.size));
        this.overlayTex.repeat.set(rep, rep);
      }
      this.overlayMat.needsUpdate = true;
    }
    this.overlay.visible = this.getEnabled() && envState.groundVisible;
    this.overlaySpec = next;
  }

  private rebuild(spec: GroundOverlaySpec): void {
    if (this.overlayTex) {
      safeDispose(this.overlayTex);
      this.overlayTex = null;
    }
    this.overlayTex = this.makeTexture(spec);
    if (!this.overlayMat) {
      this.overlayMat = new THREE.MeshStandardMaterial();
    }
    applyOverlayMaterial(this.overlayMat, spec, this.overlayTex);
    this.overlay.material = this.overlayMat;
  }

  /** 叠加层纹理边长 / 世界格重复：与 surface 同口径（textureRepeat = meshSize/TILE/scale），
   *  让「叠加格数」滑杆与世界密度一致，而非只改贴图像素。 */
  private makeTexture(spec: GroundOverlaySpec): THREE.DataTexture | null {
    const px = generateOverlayPixels(spec.style, OVERLAY_TEX_SIZE, spec.color, spec.size);
    if (px.length === 0) return null;
    const tex = new THREE.DataTexture(px, OVERLAY_TEX_SIZE, OVERLAY_TEX_SIZE, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const rep = textureRepeat(envState.groundSize, Math.max(1, spec.size));
    tex.repeat.set(rep, rep);
    tex.needsUpdate = true;
    return tex;
  }

  /** 摘除 + 释放资源（cap dispose 用）。 */
  dispose(): void {
    if (this.overlay.parent) this.overlay.parent.remove(this.overlay);
    if (this.overlayTex) {
      safeDispose(this.overlayTex);
      this.overlayTex = null;
    }
    if (this.overlayMat) {
      this.overlayMat.dispose();
      this.overlayMat = null;
    }
    this.overlay.geometry.dispose();
    this.overlaySpec = null;
  }
}
