// ===== YSM 预览缓存所有者（淘汰回填 + 缓存感知的缩略图/摘要解码）=====
//
// 【归属：为什么在 preview-3d/adapters 而非 views（ADR-270-d5）】
// 缓存读写、淘汰回调注册是**缓存所有者**的职责，不是视图职责。原实现散落两处：
// `views/app-preview/index.ts`（顶层 `cacheSetEvictHandler` 注册 + loadPreviewImage 的
// 「查缓存 → WASM 解码 → Go 兜底 → 回写」）与 `views/app-preview/detail.ts`（摘要补全时
// 的 decode + 读旧缓存 + 写回）——两处都让视图层直接 import `decoder/model-cache` 与
// `decoder/wasm-decode` 内部件（R10 穿透）。此处收口成缓存所有者模块：views 只经本模块
// 消费缓存能力（缩略图、摘要解码），淘汰回调随本模块 import 自动就位。
//
// ADR: ADR-270-d5（本迁移的法律依据）、ADR-270-d2（R10 入口面立法）。

import { getApp } from "@/backend/app.ts";
import type { BedrockGeometry } from "@/preview-3d/decoder/geometry.ts";
import {
  cacheGet,
  cacheSet,
  cacheSetEvictHandler,
  collectBlobUrls,
} from "@/preview-3d/decoder/model-cache.ts";
import type { DecodedYsm } from "@/preview-3d/decoder/utils.ts";
import { decodeYsmViaWasm } from "@/preview-3d/decoder/wasm-decode.ts";
import { isYsmWasmPreview } from "@/utils/resource/types.ts";

// 注册缓存淘汰回调：释放 blob URL（Set 去重：重复 URL 只 revoke 一次，revoke 幂等无害）
// 由本模块 import 即生效——视图层不再需要自己注册（缓存所有者自持，ADR-270-d5）。
cacheSetEvictHandler((_key, val) => {
  if (!val) return;
  const urls = collectBlobUrls(val);
  for (const u of urls) {
    if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  }
});

/** 自动匹配缩略图：查缓存 → .ysm/.json 走 WASM → Go 兜底（缓存所有者提供的唯一入口） */
export async function loadYsmPreviewImage(modelPath: string): Promise<string | null> {
  // 查缓存（模块级，跨组件生命周期持久）
  const cached = cacheGet(modelPath);
  if (cached?.texture) return cached.texture;
  const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
  if (cachedGeo?.texture) return cachedGeo.texture;

  // .ysm 或 .json（解压的 ysm.json）走前端 WASM 解码；.zip/.7z 容器由下方 Go 兜底（ADR-066 解墙）
  if (isYsmWasmPreview(modelPath)) {
    const decoded = await decodeYsmViaWasm(modelPath);
    if (decoded?.texture) {
      cacheSet(modelPath, { ...decoded });
      return decoded.texture;
    }
    if (decoded?.geometry) {
      // 有 geometry 数据（含 _ysmMeta）但无纹理，缓存以备 _loadModel2D 使用
      cacheSet(modelPath, { ...decoded });
    }
    // WASM 完全失败 → 不缓存空条目，直接走 Go 兜底
  }
  try {
    const { FindPreviewImage, ExtractPreviewTexture } = await getApp();
    const loose = await FindPreviewImage(modelPath);
    if (loose) {
      cacheSet(modelPath, { texture: loose });
      return loose;
    }
    const tex = await ExtractPreviewTexture(modelPath);
    if (tex) cacheSet(modelPath, { texture: tex });
    return tex || null;
  } catch (_) {
    return null;
  }
}

/** 摘要补全的解码结果：`hasInfo` = 解码是否含实义信息（动画组/配置菜单/作者任一） */
export interface YsmSummaryDecode {
  dec: DecodedYsm | null;
  hasInfo: boolean;
}

/**
 * 加密 .ysm 的摘要补全：Go 仅返回基本摘要（无动画/配置/作者）时，补取 WASM 解出的
 * ysm.json 信息（解密产物已含完整 ysm.json，属识别级统计，符合 ADR-026 边界）。
 *
 * 缓存占用（读旧值原样写回）只在解码含实义信息**且** `shouldCommit()` 为真时落实——
 * 调用方传代际守卫，解码期间用户已切走则不再触碰缓存（保持原 detail.ts 内联顺序：
 * 解码 → 代际校验 → 缓存写回）。
 */
export async function loadYsmSummaryMeta(
  modelPath: string,
  shouldCommit: () => boolean = () => true,
): Promise<YsmSummaryDecode> {
  const dec = await decodeYsmViaWasm(modelPath);
  const hasInfo = !!(dec?.animGroups?.length || dec?.configMenus?.length || dec?.authors?.length);
  if (hasInfo && shouldCommit()) {
    cacheSet(modelPath, cacheGet(modelPath) || {});
  }
  return { dec, hasInfo };
}
