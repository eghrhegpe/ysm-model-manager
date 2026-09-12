// ===== 纹理显存字节估算（单一事实源）=====
// 用途：GPU 预算判定的 `textureBytes` 维度。
//
// 为什么抽成独立模块：两个消费方口径必须一致——
//   ① `texture-cache|getTotalBytes`（池内纹理：YSM / pack）
//   ② `scene-stats|collectSceneStats` + `register-built-scene`（场景图纹理：**含 MMD/VRM**）
// 分散写两份必然漂移（刀⑪ 的教训：字节维度曾对 MMD/VRM 恒 0，因为只看了池）。
//
// 口径：`w × h × 4 × mip 系数`（RGBA 未压缩 + mip 链）。误差方向**双向**，
// 只作相对比较与预算拦截，非精确计量：
// - 高估：压缩格式（KTX2 / 半浮点）实际远低于 RGBA 未压缩；
// - 低估：cube map 六面、3D 纹理深度等未建模；`image` 未就绪时按 0 计。

import type * as THREE from "three";
import { ALL_TEXTURE_KEYS } from "@/preview-3d/mesh/mesh.ts";

/** mip 链系数：three 默认 `generateMipmaps=true` → GPU 额外分配约 1/3 存储。 */
export const MIPMAP_CHAIN_FACTOR = 4 / 3;

/** 单张纹理的显存字节估算。图片未就绪（`image` 缺失 / 尺寸为 0，如占位纹理）按 0 计。 */
export function estimateTextureBytes(tex: THREE.Texture | null | undefined): number {
  if (!tex) return 0;
  const img = tex.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (w <= 0 || h <= 0) return 0;
  const mip = tex.generateMipmaps === false ? 1 : MIPMAP_CHAIN_FACTOR;
  return Math.round(w * h * 4 * mip);
}

/** 一组纹理的字节估算（**按实例去重**——共享同一 Texture 只计一次，
 *  调用方传数组/Set 均可，本函数内部保证去重语义与命名一致）。 */
export function estimateTextureSetBytes(textures: Iterable<THREE.Texture>): number {
  const seen = new Set<THREE.Texture>();
  for (const tex of textures) seen.add(tex);
  let total = 0;
  for (const tex of seen) total += estimateTextureBytes(tex);
  return total;
}

/** 从材质收集九贴图槽的纹理实例（口径与 `scene-stats` 的 textureCount、
 *  `mesh|disposeMaterial` 的 ALL_TEXTURE_KEYS 一致——单一事实源）。 */
export function collectMaterialTextures(mat: THREE.Material | null | undefined): THREE.Texture[] {
  if (!mat) return [];
  const anyMat = mat as unknown as Record<string, unknown>;
  const out: THREE.Texture[] = [];
  for (const key of ALL_TEXTURE_KEYS) {
    const tex = anyMat[key];
    if (tex && typeof (tex as THREE.Texture).isTexture === "boolean") {
      out.push(tex as THREE.Texture);
    }
  }
  return out;
}

/** 遍历场景图估算纹理字节（按实例去重）。
 *
 *  **这是唯一覆盖全格式的口径**：场景图里既有 YSM/pack（走 textureCache）也有
 *  MMD/VRM/FBX（自带 loader，**不进池**）——池口径对后者恒为 0（刀⑪ 审查 P3-1）。
 *
 *  含 cap 装饰纹理（天空/地面/水面）：它们确实占 GPU 显存，且相对固定且小，
 *  不影响「模型堆叠早拦」的语义。 */
export function estimateSceneTextureBytes(root: THREE.Object3D | null | undefined): number {
  if (!root) return 0;
  const seen = new Set<THREE.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as THREE.Mesh).isMesh) return;
    const matList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of matList) {
      for (const tex of collectMaterialTextures(m)) seen.add(tex);
    }
  });
  return estimateTextureSetBytes(seen);
}

// ===== 场景字节快照（供 GPU 预算门读取）=====
// `guardGpuBudget` 在 mount/switch 时同步判定，不可能当场 traverse 全场景
// （每次 mount 都扫一遍太重）——故由 `register-built-scene` 在构建后写一份快照。

let lastSceneTextureBytes = 0;

/** 写入最近一次构建后的场景纹理字节快照（`register-built-scene` 调用）。 */
export function setLastSceneTextureBytes(bytes: number): void {
  lastSceneTextureBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

/** 读取最近一次场景纹理字节快照（0 = 尚未采集过）。 */
export function getLastSceneTextureBytes(): number {
  return lastSceneTextureBytes;
}

/** 测试用：复位快照（模块级状态，isolate:false 共享模块图下需显式复位）。 */
export function __resetSceneTextureBytesForTest(): void {
  lastSceneTextureBytes = 0;
}

/** 生产重置：会话全清时调用——快照须随场景一同消亡，否则旧重模型的快照会
 *  在下个轻模型 mount 时被 GPU 预算门误读（假阳性拦截，code_review P2）。 */
export function resetSceneTextureBytes(): void {
  lastSceneTextureBytes = 0;
}
