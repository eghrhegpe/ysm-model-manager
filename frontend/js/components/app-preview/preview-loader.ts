// ===== 模型数据加载（唯一入口）=====
// 供给 preview-skeleton.ts 和 screenshot-renderer.ts 使用
import { cacheGet, cacheSet } from "../../utils/preview-cache.ts";
import type { PreviewCtx } from "./preview-utils.ts";
import type { BedrockGeometry } from "./utils.ts";

/**
 * 加载模型几何数据 + 纹理 + 作者信息
 * 统一路径：缓存 → WASM 解码 → Go AnalyzeBedrockModel 兜底
 */
export async function loadModelData(
  modelPath: string,
  ctx: Pick<PreviewCtx, "decodeYsmViaWasm" | "appendDebug">,
): Promise<{ model: BedrockGeometry | null; decodedBy: string }> {
  let model: BedrockGeometry | null = null;
  let _decodedBy = "";
  const isYsm = /\.ysm$/i.test(modelPath);
  let _wasmAuthors: string[] = [];
  let _wasmAvatars: Record<string, string> = {};

  // 查缓存
  const cached = cacheGet(modelPath);
  const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
  if (cachedGeo?.bones?.length) {
    model = cachedGeo;
    _decodedBy = cached?._decodedBy || "";
  }

  // .ysm/.json → 前端 WASM 解码（含 parseYsmJsonDirect 提取作者元数据）
  if (!model && isYsm) {
    const decoded = await ctx.decodeYsmViaWasm(modelPath);
    _wasmAuthors = decoded?.authors || [];
    _wasmAvatars = decoded?.avatars || {};
    if (decoded?.geometry?.bones?.length) {
      model = decoded.geometry;
      model._authors = _wasmAuthors;
      model._avatars = _wasmAvatars;
      _decodedBy = "🧠 WASM 内置解码";
      const cur = cacheGet(modelPath);
      if (cur) cacheSet(modelPath, { ...cur, _decodedBy });
    } else {
      ctx.appendDebug("[YSM] WASM 返回空或无骨骼，回退 Go");
    }
  }

  // 非 YSM/JSON 或 WASM 失败/空骨骼 → 走 Go
  if (!model?.bones?.length) {
    const { AnalyzeBedrockModel } =
      await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    model = (await AnalyzeBedrockModel(modelPath)) as BedrockGeometry | null;

    // .json 解压目录：用 WASM 解析出的 authors 填补（Go 不返回此字段）
    if (model && !model._authors && _wasmAuthors.length) {
      model._authors = _wasmAuthors;
      model._avatars = _wasmAvatars;
    }

    if (model && model.bones && model.bones.length) {
      let goClips: unknown[] = [];
      if (model.animations?.length) {
        const { parseBedrockAnimationJSON } =
          await import("../../utils/animation.ts");
        for (const jsonStr of model.animations as string[]) {
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
          file: modelPath.split(/[/\\]/).pop() || "",
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
        texture: model.texture as string | undefined,
        geometry: model,
        animations: goClips.length > 0 ? goClips : undefined,
        _decodedBy: "📦 Go 原生解析",
      });
      _decodedBy = "📦 Go 原生解析";
    }
  }

  // 统一补充：缓存中可能有 WASM 解析出的 authors 但未挂上 model
  if (model && !model._authors) {
    const cur = cacheGet(modelPath);
    if (cur?.authors?.length) {
      model._authors = cur.authors as string[];
      model._avatars = cur.avatars || {};
    }
  }

  if (model) model._modelPath = modelPath;

  return { model: model || null, decodedBy: _decodedBy };
}
