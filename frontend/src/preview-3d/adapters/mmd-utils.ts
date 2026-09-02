// ===== MMD 适配器纯辅助（从 mmd-adapter.ts 拆出）=====
// 无 mmdDiag / MmdDataPort 依赖的纯工具：纹理扩展名判定、TGA 检测、
// 材质纹理槽位读写、GPU 估算、有界并发映射。mmd-adapter 管线内部消费。
import type * as THREE from "three";

/** 同目录纹理候选扩展名（PMX/PMD 引用的贴图；.spa/.sph 特殊格式 Image 解不了，命中后降级无贴图） */
export const TEXTURE_EXTS = [".png", ".jpg", ".jpeg", ".bmp", ".tga", ".gif", ".webp"];

/** 假 TGA 检测：合法 TGA 头部第 3 字节（图像类型）∈ {1,2,3,9,10,11}；MMD 素材常有扩展名 .tga 但内容非法的占位文件，跳过避免 TGALoader 刷错 */
export function isLikelyTga(bytes: Uint8Array): boolean {
  if (bytes.length < 18) return false;
  const type = bytes[2];
  return type === 1 || type === 2 || type === 3 || type === 9 || type === 10 || type === 11;
}

/** 可释放的纹理字段名（MMDToonMaterial 特有 + 标准纹理，对齐 mesh.ts ALL_TEXTURE_KEYS 且扩 MMD 专属字段） */
export const DISPOSE_TEX_KEYS = [
  "map",
  "emissiveMap",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "lightMap",
  "alphaMap",
  "envMap",
  "sphereMap",
  "toonMap",
  "displacementMap",
  "bumpMap",
] as const;

// 材质纹理槽位读写：Three.js Material 类型不含 MMD 扩展贴图 key，
// 断言收敛到此处（原 3 处散落的 mat as unknown as Record<string, unknown>）
export type MatTexSlots = Record<string, unknown>;
export const matTexSlots = (mat: THREE.Material): MatTexSlots => mat as unknown as MatTexSlots;

/** 估算纹理 GPU 内存（字节），只计 RGBA 全尺寸；压缩纹理格式不在此列 */
export function estimateTexGpuBytes(tex: THREE.Texture): number {
  const img = tex.image as HTMLImageElement | undefined;
  if (!img?.width || !img?.height) return 0;
  // RGBA8888 = 4B/px（最普适场景）；其它格式估算偏保守
  return img.width * img.height * 4;
}

/**
 * 并发分片映射：将 items 按 chunkSize 分组，每组内 Promise.all 并发执行，
 * 组与组之间串行。fallback 批量读取的并发版——避免 N 次串行 await，
 * 又不一次性爆栈（ADR-101 配套前端优化，对齐后端 goroutine 池设计）。
 */
export async function concurrentMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  chunkSize = 4,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map((item) => fn(item)));
    for (let j = 0; j < chunkResults.length; j++) {
      results[i + j] = chunkResults[j];
    }
  }
  return results;
}
