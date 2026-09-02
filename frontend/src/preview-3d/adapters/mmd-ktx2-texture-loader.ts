// ===== KTX2 直载纹理 loader（方案 A）=====
// 通过 LoadingManager.addHandler 注册到 MMDLoader 的 manager，拦截 loadTextureResource
// 的 loader 选择（three-mmd dist/index.js:2202 `ctx.manager.getHandler(fullPath)`）：
// 纹理 URL → resolveHash 查 KTX2 缓存 → 命中则 KTX2Loader 直载压缩纹理，
// 未命中/失败回退原 TextureLoader（PNG 原路径）。
//
// 收益：材质构建阶段直接拿到 CompressedTexture，PNG 解码从加载路径消失
// （二次加载 Decode Image 不再出现，texture 阶段 2900ms → 数百 ms）。
//
// 一致性契约：load() 同步返回占位纹理（材质/ctx.textures 引用它），
// 异步填充后 onLoad 收到同一对象——与 three-mmd 的 loadTextureResource
// 缓存语义（ctx.textures[fullPath]）兼容。
//
// toon 排除：toon 贴图会走 getRotatedImage(t.image)（canvas 旋转），
// CompressedTexture 的 image 是 mipmap 数组无法 drawImage——toon 不直载
// （由 resolveHash 返回 undefined 实现，本 loader 不感知 toon）。
import * as THREE from "three";
import { b64ToBytes } from "../base64.ts";

/** 拦截 loader 依赖注入（装配方提供） */
export interface Ktx2TextureLoaderDeps {
  /** URL(fullPath) → 缓存 hash；返回 undefined = 不直载（回退原 loader） */
  resolveHash: (url: string) => string | undefined;
  /** 读取 KTX2 缓存（Go RPC），返回 base64 或 null */
  getCachedTextureByHash: (hash: string) => Promise<string | null>;
  /** KTX2 解码器（需 detectSupport(renderer) 后传入） */
  ktx2Loader: { loadAsync: (url: string) => Promise<THREE.CompressedTexture> };
  /** 回退 loader（原 TextureLoader，同 manager 继承 URLModifier） */
  fallbackLoader: THREE.TextureLoader;
}

/**
 * 将 CompressedTexture 的关键字段合并到占位纹理（保持对象身份一致）。
 * P3-10（审核）：补齐 colorSpace / wrapS / wrapT / anisotropy / flipY——原实现只合
 * image/mipmaps/format/type/filters，靠 three-mmd onLoad 回调（dist/index.js:2210-2213
 * 统一设 flipY=false / wrap=T / colorSpace=SRGB）隐性兜底；本 loader 一旦脱离 three-mmd
 * 上下文复用/直测即产出错误颜色与寻址的纹理。补齐后与 mergePlainInto 字段面一致。
 */
function mergeCompressedInto(placeholder: THREE.Texture, src: THREE.CompressedTexture): void {
  placeholder.image = src.image;
  (placeholder as unknown as { mipmaps: unknown[] }).mipmaps = src.mipmaps;
  placeholder.format = src.format;
  placeholder.type = src.type;
  placeholder.minFilter = src.minFilter;
  placeholder.magFilter = src.magFilter;
  placeholder.generateMipmaps = src.generateMipmaps;
  // P3-10：从压缩源补拷字段（KTX2Loader 已正确设置 colorSpace/wrap 等）
  placeholder.colorSpace = src.colorSpace;
  placeholder.wrapS = src.wrapS;
  placeholder.wrapT = src.wrapT;
  placeholder.anisotropy = src.anisotropy;
  placeholder.flipY = src.flipY;
  // 压缩纹理上传路径开关：three WebGLTextures 按 isCompressedTexture 分支
  (placeholder as unknown as { isCompressedTexture: boolean }).isCompressedTexture = true;
  placeholder.needsUpdate = true;
}

/** 将普通纹理（fallback PNG）的关键字段合并到占位纹理 */
function mergePlainInto(placeholder: THREE.Texture, src: THREE.Texture): void {
  placeholder.image = src.image;
  placeholder.format = src.format;
  placeholder.type = src.type;
  placeholder.colorSpace = src.colorSpace;
  placeholder.flipY = src.flipY;
  placeholder.wrapS = src.wrapS;
  placeholder.wrapT = src.wrapT;
  placeholder.minFilter = src.minFilter;
  placeholder.magFilter = src.magFilter;
  (placeholder as unknown as { isCompressedTexture: boolean }).isCompressedTexture = false;
  placeholder.needsUpdate = true;
}

export class Ktx2TextureLoader extends THREE.Loader {
  constructor(private readonly deps: Ktx2TextureLoaderDeps) {
    super();
  }

  /**
   * 与 TextureLoader.load 同签名：同步返回占位纹理（材质/ctx.textures 引用它），
   * 异步填充后 onLoad 收到同一对象——直载与回退两条路径都合并进占位，
   * 保证 three-mmd 的 loadTextureResource（`texture = loader.load(...)` 返回值即材质 map）
   * 拿到的始终是有数据的对象，避免"空占位被材质引用 → 纹理丢失"。
   */
  load(
    url: string,
    onLoad?: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: unknown) => void,
  ): THREE.Texture {
    const hash = this.deps.resolveHash(url);
    // 未命中缓存候选 → 原样回退
    if (!hash) {
      return this.deps.fallbackLoader.load(url, onLoad, onProgress, onError);
    }

    // 占位用普通 Texture（非 CompressedTexture）：fallback 合并 PNG 字段天然兼容；
    // 直载成功时置 isCompressedTexture=true 切换上传路径
    const placeholder = new THREE.Texture();
    const fallback = (): void => {
      // 回退：原 loader 加载 PNG，结果合并进占位（保持同一对象身份）
      this.deps.fallbackLoader.load(
        url,
        (t) => {
          mergePlainInto(placeholder, t);
          onLoad?.(placeholder);
        },
        onProgress,
        onError,
      );
    };

    this.deps
      .getCachedTextureByHash(hash)
      .then(async (b64) => {
        if (!b64) {
          fallback();
          return;
        }
        const ktxBytes = b64ToBytes(b64);
        const blob = new Blob([ktxBytes as unknown as BlobPart], { type: "image/ktx2" });
        const blobUrl = URL.createObjectURL(blob);
        try {
          const compressed = await this.deps.ktx2Loader.loadAsync(blobUrl);
          mergeCompressedInto(placeholder, compressed);
          onLoad?.(placeholder);
        } catch {
          fallback();
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      })
      .catch(() => fallback());

    return placeholder;
  }
}
