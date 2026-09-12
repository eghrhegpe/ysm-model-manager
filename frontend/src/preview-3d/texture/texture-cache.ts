// ===== 纹理缓存池（P0 优化：同纹理只 upload 一次 GPU）=====
// 问题：switchToSession 切换模型时，相同纹理文件被重复 fetch + createImageBitmap + uploadTexture，
// 同目录纹理切换 10 次 = 10 份 GPU 副本。
// 方案：按 URL 缓存 Texture 实例，acquire 时引用 +1，release 时 -1，归零不立即释放
// （跨模型复用），session 结束 disposeAll 统一释放。
//
// 适用范围：YSM loadTextures（Image + Texture）、pack-model-adapter（TextureLoader）。
// MMD/VRM 走 blob URL + 内置 Loader，暂不接入（需改造 Loader 管线，ROI 低）。

import type * as THREE from "three";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";

/** mip 链系数：three 默认 `generateMipmaps=true` → GPU 额外分配约 1/3 存储。 */
const MIPMAP_CHAIN_FACTOR = 4 / 3;

interface CacheEntry {
  tex: THREE.Texture;
  refs: number;
}

export class TextureCacheImpl {
  private cache = new Map<string, CacheEntry>();

  /**
   * @param maxEntries 容量上限（审核 P3-3）：归零条目在超限时按最久未用（LRU）
   *   淘汰并 dispose，防单一长会话浏览大量不同模型时 GPU 常驻纹理单调增长；
   *   仍被引用（refs>0）的条目永不淘汰，跨模型复用语义不变。
   */
  constructor(private maxEntries = 200) {}

  /**
   * 获取缓存纹理或创建新纹理。
   * @param url   纹理 URL / dataURL
   * @param make  创建器（url → Texture），仅缓存未命中时调用
   */
  acquire<T extends THREE.Texture>(url: string, make: (url: string) => T): T {
    const entry = this.cache.get(url);
    if (entry) {
      entry.refs++;
      // LRU：命中即刷新访问序（Map 迭代序 = 插入序，delete+set 移到最新）
      this.cache.delete(url);
      this.cache.set(url, entry);
      return entry.tex as T;
    }
    this.evictZeroRefIfNeeded();
    const tex = make(url);
    this.cache.set(url, { tex, refs: 1 });
    return tex;
  }

  /** 超容量时淘汰最久未用的归零条目（Map 头部 = 最旧）；无可淘汰则放行超限 */
  private evictZeroRefIfNeeded(): void {
    if (this.cache.size < this.maxEntries) return;
    for (const [k, e] of this.cache) {
      if (this.cache.size < this.maxEntries) break;
      if (e.refs === 0) {
        safeDispose(e.tex);
        this.cache.delete(k);
      }
    }
  }

  /**
   * 释放对 url 的引用（引用 -1，归零不 dispose——跨模型复用）。
   * session 结束时由 disposeAll 统一释放。
   */
  release(url: string): void {
    const entry = this.cache.get(url);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    // 归零保留缓存（下次 acquire 可复用），由 disposeAll 清理
  }

  /** Remove a failed/corrupt texture immediately so the next acquire can retry. */
  invalidate(url: string): void {
    const entry = this.cache.get(url);
    if (!entry) return;
    safeDispose(entry.tex);
    this.cache.delete(url);
  }

  /** session 结束时释放所有缓存纹理 */
  disposeAll(): void {
    for (const [, entry] of this.cache) {
      safeDispose(entry.tex);
    }
    this.cache.clear();
  }

  /** 当前缓存数量（测试/调试用） */
  get size(): number {
    return this.cache.size;
  }

  /**
   * 当前缓存纹理的显存字节**估算**（供 GPU 预算判定用）。
   *
   * 口径：`width × height × 4 × mip 系数` 累加（RGBA 未压缩 + mip 链）。
   * 误差方向**双向**，故只作相对比较与预算拦截，非精确计量：
   * - 高估：压缩格式（KTX2 / 半浮点）实际远低于 RGBA 未压缩；
   * - 低估：已由本函数补上 mipmap 系数（three 默认 `generateMipmaps=true`
   *   会额外分配约 1/3 存储）；未补前 `w×h×4` 恰好让「4 张 4K」踩在 256MB
   *   默认上限线上（严格 `>` 不触发），补后「4 张 4K」确定超线。
   *
   * ⚠️ **覆盖盲区（勿误读这一刀已落全）**：本池只收 `texture-loader|loadTextures`
   * （YSM）与 pack 适配器的纹理；**MMD / VRM 走 blob URL + 内置 Loader，不进本池**
   * ——它们的该维度恒为 0，即 `textureBytes` 对 MMD/VRM **无效**。对这两类格式，
   * 只有 `textures`（数量）维度在起作用。真覆盖需把 MMD/VRM loader 接进同一
   * 引用计数池（另立项），或依赖 `renderer.info.memory.textures` 交叉提示。
   *
   * 图片未就绪（`image` 缺失 / 尺寸为 0，如占位纹理）按 0 计，不误报。
   */
  getTotalBytes(): number {
    let total = 0;
    for (const [, entry] of this.cache) {
      const tex = entry.tex;
      const img = tex.image as { width?: number; height?: number } | undefined;
      const w = img?.width ?? 0;
      const h = img?.height ?? 0;
      if (w <= 0 || h <= 0) continue;
      const mip = tex.generateMipmaps === false ? 1 : MIPMAP_CHAIN_FACTOR;
      total += Math.round(w * h * 4 * mip);
    }
    return total;
  }
}

/** 全局单例（随 3D 会话生命周期；disposeAll 由 mount-preview-core fullCleanup 调用） */
export const textureCache = new TextureCacheImpl();
