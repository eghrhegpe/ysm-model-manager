// ===== 3D 资源安全释放原语（零依赖，供各 adapter / caps 复用）=====
// 收敛全仓散落的 `try { x.dispose() } catch (_) {}` 防御性释放：
// 适配器各自实现 dispose，个别会抛错——安全释放保证「一个抛错不阻塞后续释放」。
// safeDisposeMat 补回 cleanup-3d.ts 拆分时的幽灵注释承诺（ADR-066 P3 注释提到但从未实现）。

/** 可释放对象的最小形状（Three.js 的 Texture/Material/Geometry 等均满足） */
export interface Disposable {
  dispose?: () => void;
}

/** 安全释放：dispose 抛错不阻塞后续释放（个别适配器 dispose 会抛） */
export function safeDispose(obj: Disposable | null | undefined): void {
  try {
    obj?.dispose?.();
  } catch {
    /* 防御性：个别适配器 dispose 抛错不阻塞 */
  }
}

/** 材质 + 纹理安全释放：先释放 map/emissiveMap 纹理，再释放材质本身 */
export function safeDisposeMat(mat: {
  dispose: () => void;
  map?: Disposable | null;
  emissiveMap?: Disposable | null;
} | null | undefined): void {
  if (!mat) return;
  safeDispose(mat.map);
  safeDispose(mat.emissiveMap);
  safeDispose(mat);
}
