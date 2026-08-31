// ===== 3D 渲染器资源清理（从 model3d.ts 拆出，ADR-040 P1 第2轮）=====
// disposeDebugGroup / disposeSceneMeshes / disposeRenderer —— handle.cleanup 中的
// Three.js 资源释放逻辑已迁移至此，避免 renderModel3D 闭包膨胀。
import * as THREE from "three";
import { disposeMaterial } from "./mesh.ts";

/** 类型联合：Mesh / Line / Sprite，用于遍历 debugGroup */
type DebugObj = THREE.Mesh | THREE.Line | THREE.Sprite;

/**
 * 释放 debug 叠加层中的所有 Three.js 资源（geometry / material / texture）。
 * 调用后 debugGroup 必须已从 scene 移除。
 */
export function disposeDebugGroup(debugGroup: THREE.Group | null): void {
  if (!debugGroup) return;
  debugGroup.traverse((c) => {
    const obj = c as DebugObj;
    if ((obj as THREE.Mesh).isMesh) {
      (obj as THREE.Mesh).geometry?.dispose();
      const m = (obj as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => disposeMaterial(x));
      else disposeMaterial(m);
    } else if ((obj as THREE.Line).isLine) {
      (obj as THREE.Line).geometry?.dispose();
      const lm = (obj as THREE.Line).material;
      if (Array.isArray(lm)) lm.forEach((x) => x.dispose());
      else lm?.dispose();
    } else if ((obj as THREE.Sprite).isSprite) {
      disposeMaterial((obj as THREE.Sprite).material);
    }
  });
}

/**
 * 遍历场景图释放所有 Mesh 的 geometry 和 material。
 * 接受任意 Object3D 子树（Scene / Group / 单 mesh），供统一核心 shared 模式
 * 释放内容层（ysm-object removeFromScene）与自建壳（renderModel3D cleanup）复用。
 * 调用前需确保场景图中的 Object3D 引用已清理。
 */
export function disposeSceneMeshes(
  root: THREE.Object3D,
  options: { disposeTextures?: boolean } = {},
): void {
  const disposeTextures = options.disposeTextures ?? true;
  root.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material))
        mesh.material.forEach((m) => disposeMaterial(m, disposeTextures));
      else disposeMaterial(mesh.material, disposeTextures);
    }
  });
}
