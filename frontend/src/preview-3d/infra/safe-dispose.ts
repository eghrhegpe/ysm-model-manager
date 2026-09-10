// ===== 3D 资源安全释放原语（零依赖，供各 adapter / caps 复用）=====
// 收敛全仓散落的 `try { x.dispose() } catch (_) {}` 防御性释放：
// 适配器各自实现 dispose，个别会抛错——安全释放保证「一个抛错不阻塞后续释放」。

import type * as THREE from "three";

/** 可释放对象的可选 dispose 形状（Three.js 的 Texture/Material/Geometry 等均满足） */
export interface SafeDisposable {
  dispose?: () => void;
}

/** 安全释放：dispose 抛错不阻塞后续释放（个别适配器 dispose 会抛） */
export function safeDispose(obj: SafeDisposable | null | undefined): void {
  try {
    obj?.dispose?.();
  } catch (e) {
    console.warn("[safeDispose]", obj?.constructor?.name, e);
  }
}

/**
 * 递归释放 Object3D 子树所有 geometry/material——uuid Set 去重，
 * 共享 geometry/material 的多 mesh（god rays / 光锥双交叉 plane）只 dispose 一次。
 * （锐评 P2：light-cone.ts:251 已验证的修复上收为共用原语，消灭 per-cap 分叉。）
 *
 * @param opts.detach 为 true 时先从父节点移除 root（默认 false，调用方自行管理挂载）；
 * @param opts.disposeMaterial 自定义材质释放器（如 light-cone 的 tryDisposeMat 需连带
 *   清理材质上的贴图槽位）；不传则用 safeDispose。注意贴图槽清扫必须 opt-in——
 *   map/envMap 等可能被子树外的对象共享（如 scene.environment），默认清扫会误伤。
 */
export function disposeObject3D(
  root: THREE.Object3D | null,
  opts: {
    detach?: boolean;
    disposeMaterial?: (mat: THREE.Material) => void;
  } = {},
): void {
  if (!root) return;
  if (opts.detach && root.parent) root.parent.remove(root);
  const seenGeo = new Set<string>();
  const seenMat = new Set<string>();
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.geometry) {
      if (!seenGeo.has(m.geometry.uuid)) {
        seenGeo.add(m.geometry.uuid);
        safeDispose(m.geometry);
      }
    }
    const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const mt of mats) {
        if (!mt) continue;
        if (!seenMat.has(mt.uuid)) {
          seenMat.add(mt.uuid);
          if (opts.disposeMaterial) opts.disposeMaterial(mt);
          else safeDispose(mt);
        }
      }
    }
  });
}
