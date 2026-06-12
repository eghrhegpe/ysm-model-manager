// ===== 模型数据加载 =====
// 从 index.js _loadModel2D 拆分：缓存查询 → WASM 解码 → Go 兜底
import { cacheGet, cacheSet } from "../../utils/preview-cache.js";

/**
 * 加载模型几何数据 + 纹理
 * @param {string} modelPath - 模型文件路径
 * @param {object} ctx - 上下文 { decodeYsmViaWasm(path), appendDebug(msg) }
 * @returns {Promise<{model: object|null, decodedBy: string}>}
 */
export async function loadModelData(modelPath, ctx) {
  let model;
  let _decodedBy = "";
  const isYsm = /\.ysm$/i.test(modelPath);

  // 查缓存（_loadPreviewImage 可能已经存过）
  const cached = cacheGet(modelPath);
  if (cached?.geometry?.bones?.length) {
    model = cached.geometry;
    _decodedBy = cached._decodedBy || "";
    console.log(`[YSM] 缓存命中: _decodedBy=${_decodedBy}`);
  } else {
    console.log(
      `[YSM] 缓存未命中: cached=${!!cached}, geometry=${!!cached?.geometry}, bones=${cached?.geometry?.bones?.length}`,
    );
  }

  // .ysm → 前端 WASM 解码
  if (!model && isYsm) {
    const decoded = await ctx.decodeYsmViaWasm(modelPath);
    if (decoded?.geometry) {
      model = decoded.geometry;
      _decodedBy = "🧠 WASM 内置解码";
      const cur = cacheGet(modelPath);
      if (cur) cacheSet(modelPath, { ...cur, _decodedBy });
    } else {
      ctx.appendDebug("[YSM] WASM 返回空，回退 Go");
    }
  }

  // 非 .ysm 或 WASM 失败 → 走 Go
  if (!model) {
    const { AnalyzeBedrockModel } =
      await import("../../../wailsjs/go/main/App.js");
    model = await AnalyzeBedrockModel(modelPath);
    if (model?.bones?.length) {
      let goClips = [];
      if (model.animations?.length) {
        const { parseBedrockAnimationJSON } =
          await import("../../utils/animation.js");
        for (const jsonStr of model.animations) {
          const { clips } = parseBedrockAnimationJSON(jsonStr);
          for (const clip of clips) {
            if (clip.hasMolang) {
              /* skip */
            }
          }
          if (clips.length > 0) goClips.push(...clips);
        }
      }
      const goTexCount = model.textures?.length || 0;
      model._texMappingLog = [
        {
          file: modelPath.split("/").pop().split("\\").pop(),
          texKey: goTexCount > 0 ? "texture[0]" : "—",
          texIdx: 0,
          pngSize: "—",
          geoSize: model.texWidth
            ? `${model.texWidth}×${model.texHeight}`
            : "—",
          uvSize: "—",
          finalSize: model.texWidth
            ? `${model.texWidth}×${model.texHeight}`
            : "—",
        },
      ];
      if (goTexCount > 1) {
        model._texMappingLog.push({
          file: "(+多纹理)",
          texKey: `+${goTexCount - 1}`,
          texIdx: 0,
          pngSize: "—",
          geoSize: "—",
          uvSize: "—",
          finalSize: "—",
        });
      }
      cacheSet(modelPath, {
        texture: model.texture,
        geometry: model,
        animations: goClips.length > 0 ? goClips : undefined,
        _decodedBy: isYsm ? "⚙️ CLI 外置解码" : "📦 Go 原生解析",
      });
      _decodedBy = isYsm ? "⚙️ CLI 外置解码" : "📦 Go 原生解析";
    }
  }

  return { model: model || null, decodedBy: _decodedBy };
}
