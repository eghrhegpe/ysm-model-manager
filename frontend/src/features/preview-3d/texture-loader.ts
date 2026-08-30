// ===== 纹理加载器（ADR-136 第四刀归位）=====
// 原 views/app-preview/model3d-loader.ts:53 loadTextures 归位 features/preview-3d——
// 99% 领域工具（只用 textureCache，textureCache 已在 features），不该住视图层。
// 并行加载纹理 URL 列表，返回 THREE.Texture 数组（P0 优化：纹理缓存池，同 URL 复用）
import * as THREE from "three";

import { textureCache } from "./texture-cache.ts";

export async function loadTextures(urls?: string[]): Promise<(THREE.Texture | null)[]> {
  if (!urls?.length) return [];
  const texArr: (THREE.Texture | null)[] = urls.map((url) => {
    if (!url) return null;
    return textureCache.acquire(url, (u) => {
      // 缓存未命中：创建新纹理
      const img = new Image();
      // 同步创建，异步填充——acquire 需要立即返回 Texture 实例
      const tex = new THREE.Texture(img);
      tex.flipY = false;
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      // 异步加载图片并更新纹理
      img.onload = (): void => {
        tex.needsUpdate = true;
        tex.userData.imgWidth = img.naturalWidth;
        tex.userData.imgHeight = img.naturalHeight;
      };
      img.onerror = (): void => {
        tex.userData.loadError = true;
      };
      img.src = u;
      return tex;
    });
  });
  // 等待所有图片加载完成（确保 needsUpdate 已触发）
  await Promise.all(
    texArr.map((tex, i) =>
      tex && urls[i]
        ? new Promise<void>((resolve) => {
            const img = tex.image;
            if (img && typeof (img as HTMLImageElement).complete === "boolean" && (img as HTMLImageElement).complete) { resolve(); return; }
            const check = (): void => {
              if (img && typeof (img as HTMLImageElement).complete === "boolean" && (img as HTMLImageElement).complete) resolve();
              else setTimeout(check, 50);
            };
            check();
          })
        : Promise.resolve(),
    ),
  );
  for (let i = 0; i < texArr.length; i++) {
    if (texArr[i]?.userData.loadError) {
      if (urls[i]) textureCache.invalidate(urls[i]);
      texArr[i] = null;
    }
  }
  if (texArr.every((t) => t === null))
    console.warn("[3D] 纹理加载失败，模型将显示为 fallback 颜色");
  return texArr;
}
