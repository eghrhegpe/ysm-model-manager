// ===== 模型数据加载（唯一入口）=====
// 供给 skeleton.ts 使用（ADR-136 第四刀后截图走 preview-3d/screenshot-render.ts）
import { cacheGet, cacheSet } from "../../preview-3d/decoder/cache.ts";
import { extOf } from "../../utils/resource/types.ts";
import { getApp } from "../../backend/app.ts";
import { parseBedrockAnimationJSON, type AnimationClip } from "../../utils/animation/animation.ts";
import type { YsmDecoder, PreviewDebugger } from "./utils.ts";
import type { BedrockGeometry } from "../../preview-3d/decoder/geometry.ts";

/** loadModelData 选项（Bedrock 通用模型加载控制） */
export interface LoadModelOpts {
  /** 跳过 WASM 解码（用于非 YSM 格式的 Bedrock 模型，如车万女仆） */
  skipWasm?: boolean;
  /** 单角色过滤：按 zip/7z 内 SubModel.SourcePath 只解析单模型 geometry（多角色包切角色用）。
   *  仅对 Go 兜底解析路径生效（.ysm 为二进制不可分 entry，忽略此字段）。
   *  AnalyzeBedrockModelEntry 未命中时自动回退 AnalyzeBedrockModel（全量合并）。 */
  subPath?: string;
}

/**
 * 加载模型几何数据 + 纹理（优先路径，阻塞渲染）
 * 统一路径：缓存 → WASM 解码（仅 .ysm）→ Go AnalyzeBedrockModel 兜底
 * 作者/头像延迟到 fillAuthorsAsync（不阻塞首帧渲染）
 *
 * ADR: .zip/.7z/.json 等通用 Bedrock 格式直接走 Go 解析路径，
 * WASM 仅用于 .ysm 二进制格式（YSM 专属）。非 YSM Bedrock 模型
 * （如车万女仆 .zip）可传 skipWasm 直接跳过 WASM 尝试。
 */
export async function loadModelData(
  modelPath: string,
  ctx: YsmDecoder & PreviewDebugger,
  opts: LoadModelOpts = {},
): Promise<{ model: BedrockGeometry | null; decodedBy: string }> {
  // 查缓存：subPath（L0 单角色）必须并入缓存键，否则切角色命中旧角色几何（审核 P2）
  const cacheKey = opts.subPath ? `${modelPath}#sub:${opts.subPath}` : modelPath;

  // ① 查缓存命中 → 直接回填动画回返
  const fromCache = loadModelFromCache(cacheKey);
  let model = fromCache.model;
  let decodedBy = fromCache.decodedBy;
  let wasmAuthors: NonNullable<BedrockGeometry["_authors"]> = [];
  let wasmAvatars: Record<string, string> = {};

  // ② .ysm → 前端 WASM 解码（仅未命中缓存时）
  if (!model) {
    const wasm = await loadModelViaWasm(ctx, modelPath, cacheKey, !!opts.skipWasm);
    model = wasm.model;
    decodedBy = wasm.decodedBy;
    wasmAuthors = wasm.authors;
    wasmAvatars = wasm.avatars;
  }

  // ③ 非 YSM/ZIP/JSON 或 WASM 失败/空骨骼 → 走 Go 兜底
  if (!model?.bones?.length) {
    const go = await loadModelViaGo(
      ctx,
      modelPath,
      opts,
      model,
      wasmAuthors,
      wasmAvatars,
    );
    model = go.model;
    decodedBy = go.decodedBy;
  }

  // ④ 统一补充：缓存中可能有 WASM 解析出的 authors 但未挂上 model
  if (model && !model._authors) {
    const cur = cacheGet(modelPath);
    if (cur?.authors?.length) {
      model._authors = cur.authors.filter(
        (a): a is NonNullable<BedrockGeometry["_authors"]>[number] =>
          typeof a === "object" && a !== null,
      );
      model._avatars = cur.avatars || {};
    }
  }

  if (model) model._modelPath = modelPath;

  return { model: model || null, decodedBy };
}

/** 缓存命中读取：含骨骼几何才视为命中，并回填动画 clips */
function loadModelFromCache(cacheKey: string): {
  model: BedrockGeometry | null;
  decodedBy: string;
} {
  const cached = cacheGet(cacheKey);
  const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
  if (!cachedGeo?.bones?.length) {
    return { model: null, decodedBy: "" };
  }
  // 缓存回填动画（此前 WASM/Go 解码时写入缓存的 clips）
  const cachedAnims = cached?.animations;
  if (!cachedGeo._animClips && Array.isArray(cachedAnims) && cachedAnims.length > 0) {
    cachedGeo._animClips = cachedAnims as AnimationClip[];
  }
  return { model: cachedGeo, decodedBy: cached?._decodedBy || "" };
}

/** .ysm → 前端 WASM 解码；空结果/空骨骼回退 Go（此处仅返回空壳，不落 Go） */
async function loadModelViaWasm(
  ctx: YsmDecoder & PreviewDebugger,
  modelPath: string,
  cacheKey: string,
  skipWasm: boolean,
): Promise<{
  model: BedrockGeometry | null;
  decodedBy: string;
  authors: NonNullable<BedrockGeometry["_authors"]>;
  avatars: Record<string, string>;
}> {
  // WASM 仅对 .ysm 二进制格式有意义；.zip/.7z/.json 通用格式走 Go
  const isWasmCapable = !skipWasm && extOf(modelPath) === ".ysm";
  if (!isWasmCapable) {
    return { model: null, decodedBy: "", authors: [], avatars: {} };
  }
  const decoded = await ctx.decodeYsmViaWasm(modelPath);
  const authors = (decoded?.authors || []) as NonNullable<BedrockGeometry["_authors"]>;
  const avatars = decoded?.avatars || {};
  if (decoded?.geometry?.bones?.length) {
    const model = decoded.geometry;
    model._authors = authors;
    model._avatars = avatars;
    // 内嵌动画：WASM 已把 .ysm 包内 animations/*.json 解析为 clips——
    // 单文件模型磁盘没有动画文件，这是动画数据的主来源（修复动作面板空列表）
    if (Array.isArray(decoded.animations) && decoded.animations.length > 0) {
      model._animClips = decoded.animations as AnimationClip[];
    }
    const decodedBy = "🧠 WASM 内置解码";
    cacheSet(cacheKey, {
      ...(cacheGet(cacheKey) || {}),
      geometry: model,
      _decodedBy: decodedBy,
    });
    return { model, decodedBy, authors, avatars };
  }
  ctx.appendDebug(null, "[YSM] WASM 返回空或无骨骼，回退 Go");
  return { model: null, decodedBy: "", authors, avatars };
}

/** Go AnalyzeBedrockModel 兜底：subPath 单角色优先，再回退全量；挂 authors/animClips/texMappingLog */
async function loadModelViaGo(
  ctx: YsmDecoder & PreviewDebugger,
  modelPath: string,
  opts: LoadModelOpts,
  current: BedrockGeometry | null,
  wasmAuthors: NonNullable<BedrockGeometry["_authors"]>,
  wasmAvatars: Record<string, string>,
): Promise<{ model: BedrockGeometry | null; decodedBy: string }> {
  const app = await getApp();
  // current 可能是缓存命中但无骨骼的对象：subPath 未命中时不覆盖它（沿用原有无骨骼对象语义）
  let model = current;
  const cacheKey = opts.subPath ? `${modelPath}#sub:${opts.subPath}` : modelPath;
  let subPathUsed = false;

  // subPath 模式：先试单条目解析（多角色包切角色），再回退全量
  if (opts.subPath && typeof app.AnalyzeBedrockModelEntry === "function") {
    const entryModel = (await app.AnalyzeBedrockModelEntry(modelPath, opts.subPath)) as
      | BedrockGeometry
      | null
      | undefined;
    if (entryModel?.bones?.length) {
      model = entryModel;
      subPathUsed = true;
      ctx.appendDebug(null, `[L0] 单角色解析：${opts.subPath}`);
    }
  }
  if (!model) {
    const { AnalyzeBedrockModel } = app;
    model = (await AnalyzeBedrockModel(modelPath)) as BedrockGeometry | null;
  }

  // WASM 无几何但带 authors → 由 WASM authors 填补（Go 无 authors 字段）
  if (model && !model._authors && wasmAuthors.length) {
    model._authors = wasmAuthors;
    model._avatars = wasmAvatars;
  }

  if (model && model.bones && model.bones.length) {
    let goClips: unknown[] = [];
    if (model.animations?.length) {
      for (const jsonStr of model.animations as string[]) {
        const { clips } = parseBedrockAnimationJSON(jsonStr);
        if (clips.length > 0) goClips.push(...clips);
      }
    }
    // Go 兜底路径同样挂载（文件夹/zip 模型的 .animation.json 由 Go 收集透传）
    if (goClips.length > 0) model._animClips = goClips as AnimationClip[];
    const goTexCount = model.textures?.length || 0;
    model._texMappingLog = [
      {
        file: modelPath.split(/[/\\]/).pop() || "",
        texKey: goTexCount > 0 ? "texture[0]" : "—",
        texIdx: 0,
        pngSize: "—",
        geoSize: model.texWidth ? `${model.texWidth}×${model.texHeight}` : "—",
        uvSize: "—",
        finalSize: model.texWidth ? `${model.texWidth}×${model.texHeight}` : "—",
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
    const decodedBy = subPathUsed ? "📦 Go 单角色（L0 清单）" : "📦 Go 原生解析";
    cacheSet(cacheKey, {
      ...(cacheGet(cacheKey) || {}),
      ...(model.texture !== undefined ? { texture: model.texture } : {}),
      geometry: model,
      ...(goClips.length > 0 ? { animations: goClips } : {}),
      _decodedBy: decodedBy,
    });
    return { model, decodedBy };
  }

  return { model, decodedBy: "" };
}

/**
 * 异步补全作者/头像信息（不阻塞首帧渲染）
 * 在几何渲染完成后调用，后台补齐作者名 + 头像 URL
 */
export async function fillAuthorsAsync(
  modelPath: string,
  model: BedrockGeometry,
): Promise<void> {
  if (!model) return;
  // 确保 _authors 数组存在（loadModelData 可能未初始化）
  if (!model._authors) model._authors = [];

  // 作者名缺失 → 从 Go 摘要补齐
  if (model._authors.length === 0) {
    try {
      const { ExtractYsmSummary } = await getApp();
      const goSummary = await ExtractYsmSummary(modelPath);
      const goAuthors = goSummary?.authors ?? [];
      if (goAuthors.length > 0) {
        model._authors = goAuthors.map((a) => ({
          name: a.name || "",
          role: a.roles || "",
          avatarUrl: null,
          avatarPath: "",
          // 保留作者 bilibili 主页（统计卡作者列表渲染 📺 链接用；2026-08-28 修复链路丢失）
          bilibili: a.bilibili || "",
        }));
      }
    } catch {
      /* 不影响几何渲染 */
    }
  }

  // 任一作者缺头像 → 经 Go 后端缓存回填
  if (model._authors.length > 0 && model._authors.some((a) => !a.avatarUrl)) {
    try {
      const { CacheModelAvatars, CachedCreatorAvatar } = await getApp();
      await CacheModelAvatars(modelPath);
      // 并行请求所有作者头像（原实现串行 N 次 Go 调用 → 现并行 1 次 Promise.all）
      const avatarTasks = model._authors
        .filter((au): au is typeof au & { name: string } => !au.avatarUrl && !!au.name)
        .map(async (au) => {
          const uri = await CachedCreatorAvatar(au.name);
          if (uri) au.avatarUrl = uri;
        });
      await Promise.all(avatarTasks);
    } catch {
      /* 不影响几何渲染 */
    }
  }
}
