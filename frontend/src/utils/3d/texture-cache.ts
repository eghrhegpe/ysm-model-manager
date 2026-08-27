// ===== 纹理缓存池（P0 优化：同纹理只 upload 一次 GPU）=====
// 问题：switchToSession 切换模型时，相同纹理文件被重复 fetch + createImageBitmap + uploadTexture，
// 同目录纹理切换 10 次 = 10 份 GPU 副本。
// 方案：按 URL 缓存 Texture 实例，acquire 时引用 +1，release 时 -1，归零不立即释放
// （跨模型复用），session 结束 disposeAll 统一释放。
//
// 适用范围：YSM loadTextures（Image + Texture）、pack-model-adapter（TextureLoader）。
// MMD/VRM 走 blob URL + 内置 Loader，暂不接入（需改造 Loader 管线，ROI 低）。

import * as THREE from "three";
import { safeDispose } from "./safe-dispose.ts";

interface CacheEntry {
  tex: THREE.Texture;
  refs: number;
}

export class TextureCacheImpl {
  private cache = new Map<string, CacheEntry>();

  /**
   * 获取缓存纹理或创建新纹理。
   * @param url   纹理 URL / dataURL
   * @param make  创建器（url → Texture），仅缓存未命中时调用
   */
  acquire<T extends THREE.Texture>(url: string, make: (url: string) => T): T {
    let entry = this.cache.get(url);
    if (entry) {
      entry.refs++;
      return entry.tex as T;
    }
    const tex = make(url);
    this.cache.set(url, { tex, refs: 1 });
    return tex;
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
}

/** 全局单例（随 3D 会话生命周期；disposeAll 由 cleanup-3d.ts 调用） */
export const textureCache = new TextureCacheImpl();
