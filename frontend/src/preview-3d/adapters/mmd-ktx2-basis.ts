// ===== MMD KTX2 Basis 编码核心（主线程与 Worker 共用）=====
// 本地 basis_encoder WASM 加载 + KTX2 编码。
//
// ⚠️ 不使用 @loaders.gl/textures 的 KTX2BasisWriter.encode：
// 其 4.4.4 实现返回 `basisFileData.subarray(0, n).buffer`——subarray 是视图，
// `.buffer` 是整个底层 ArrayBuffer（原始 RGBA 大小），导致缓存写入"原始大小 +
// 零填充"的假 KTX2（魔数合法但体积虚胖）。这里直接调 BasisEncoder API，
// 用 `slice(0, n)` 复制出真实长度的压缩数据。
//
// 本模块只用 fetch + new Function（无 DOM 依赖），Worker 内同样可用。

/** BasisEncoder 实例的最小接口（embind 运行时提供） */
export interface BasisEncoderLike {
  setCreateKTX2File(v: boolean): void;
  setKTX2UASTCSupercompression(v: boolean): void;
  setKTX2SRGBTransferFunc(v: boolean): void;
  setSliceSourceImage(slice: number, data: Uint8Array, w: number, h: number, premultiply: boolean): void;
  setPerceptual(v: boolean): void;
  setMipSRGB(v: boolean): void;
  setQualityLevel(v: number): void;
  setUASTC(v: boolean): void;
  setMipGen(v: boolean): void;
  /** 编码到 dst，返回写入的字节数（负数=失败） */
  encode(dst: Uint8Array): number;
  delete(): void;
}

/** 初始化后的 basis 模块（含 BasisEncoder 构造器） */
export interface BasisModuleLike {
  BasisEncoder: new () => BasisEncoderLike;
  initializeBasis(): void;
}

let basisModulePromise: Promise<BasisModuleLike> | null = null;

/**
 * 加载并初始化本地 basis_encoder（缓存单例）。
 * fetch 项目 public/basis/ 下的 js + wasm，执行 Emscripten 模块工厂。
 */
async function loadBasisModule(): Promise<BasisModuleLike> {
  if (basisModulePromise) return basisModulePromise;
  basisModulePromise = (async () => {
    const [jsText, wasmBinary] = await Promise.all([
      (await fetch("/basis/basis_encoder.js")).text(),
      (await fetch("/basis/basis_encoder.wasm")).arrayBuffer(),
    ]);
    // Emscripten UMD 产物：`var BASIS = (function(){...})()` 定义模块工厂。
    // 用 Function 执行并在末尾返回工厂（避开浏览器 script 全局注入，测试环境同样可用）。
    const factory = new Function(`${jsText}\nreturn typeof BASIS !== "undefined" ? BASIS : undefined;`) as () => unknown;
    const BASIS = factory() as (opts: { wasmBinary: ArrayBuffer }) => Promise<BasisModuleLike>;
    const module = await BASIS({ wasmBinary });
    module.initializeBasis();
    return module;
  })();
  // 失败后允许下次重试
  basisModulePromise.catch(() => { basisModulePromise = null; });
  return basisModulePromise;
}

/**
 * 单纹理像素上限：超过则跳过 KTX2 编码。
 * Node 实证：4096²（64MB RGBA）可编码，8192²（256MB RGBA）在 WASM 编码时
 * 内存峰值超限 → abort(undefined)。跳过超大纹理避免编码崩溃（PNG 仍正常渲染）。
 */
export const MAX_KTX2_PIXELS = 4096 * 4096;

/** 超大纹理跳过编码的标记错误（encodeAndCacheTexture 据此记 warn 而非 fail） */
export class TextureTooLargeError extends Error {
  constructor(width: number, height: number) {
    super(`纹理过大 ${width}x${height}，跳过 KTX2 编码（上限 ${MAX_KTX2_PIXELS} 像素）`);
    this.name = "TextureTooLargeError";
  }
}

/**
 * 将 RGBA ImageData 编码为 KTX2（Basis Universal ETC1S）。
 * 直接调 BasisEncoder API 并用 `slice(0, n)` 复制真实长度。
 * 注意：WASM encode 是同步调用，大纹理（4096²）单次 ~10s——主线程调用会阻塞 UI，
 * 生产路径应走 Worker（mmd-ktx2-worker.ts）；本函数供 Worker 与同步降级 fallback 使用。
 */
export async function encodeToKTX2Basis(img: { data: Uint8Array; width: number; height: number }): Promise<ArrayBuffer> {
  // 超大纹理直接跳过（不加载 WASM、不 abort），PNG 原样渲染
  if (img.width * img.height > MAX_KTX2_PIXELS) {
    throw new TextureTooLargeError(img.width, img.height);
  }
  const module = await loadBasisModule();
  const enc = new module.BasisEncoder();
  try {
    enc.setCreateKTX2File(true);
    enc.setKTX2UASTCSupercompression(true);
    enc.setKTX2SRGBTransferFunc(true);
    enc.setSliceSourceImage(0, img.data, img.width, img.height, false);
    enc.setPerceptual(false);
    enc.setMipSRGB(false);
    enc.setQualityLevel(128); // 质量 1-255，128 是平衡值
    enc.setUASTC(false); // ETC1S（更小，兼容性更好）
    enc.setMipGen(false); // 预览不需要 mipmap
    const out = new Uint8Array(img.width * img.height * 4);
    const n = enc.encode(out);
    if (n <= 0) throw new Error(`BasisEncoder.encode 返回 ${n}`);
    // slice 复制真实压缩数据（subarray 是视图，.buffer 会带整个底层 ArrayBuffer）
    return out.slice(0, n).buffer as ArrayBuffer;
  } finally {
    enc.delete();
  }
}
