// ===== YSM 预览数据装配流水线（模型几何 + 作者/头像 + 截图实参）=====
//
// 【归属：为什么在 preview-3d/adapters 而非 views（ADR-270-d5）】
// 本模块原住 `views/app-preview/loader.ts`，但它的内容 100% 是**引擎装配**：
// 缓存命中 → `.ysm` WASM 解码 → Go AnalyzeBedrockModel 兜底 → 动画 clips /
// 纹理映射日志挂载 → 作者头像回填；外加截图路径的解码实参组装。这些与视图接口、
// DOM、渲染无关——住在 views 只是历史惯性，其直接 import `preview-3d/decoder|model`
// 内部件是「它住在哪」的结果而非原因（R10 基线里 10 条 views→p3d 穿透边的一族）。
// 故整段迁入 `preview-3d/adapters/`（R10 入口面目录，views 经此消费合法）：
// 装配本领归引擎层，views 侧只留视图接口 / DOM / 渲染。
//
// 解码能力**自持**：流水线直接持有 `decoder/wasm-decode.ts`（p3d→p3d 下行合法），
// 因此调用方不再需要把 `decodeYsmViaWasm` 当 ctx 注入（原 ysm-3d.ts 的注入随之消失）。
// 注入缝保留：`ctx` 两个能力都可按需覆盖（单测注入假解码、女仆面板显式传空解码跳过 WASM）。
//
// ADR: ADR-270-d5（本迁移的法律依据）、ADR-270-d2（R10 入口面立法）、ADR-136（截图解码注入缝）。

import { getApp } from "@/backend/app.ts";
import type { BedrockGeometry } from "@/preview-3d/decoder/geometry.ts";
import { cacheGet, cacheSet } from "@/preview-3d/decoder/model-cache.ts";
import type { DecodedYsm } from "@/preview-3d/decoder/utils.ts";
import { decodeYsmViaWasm } from "@/preview-3d/decoder/wasm-decode.ts";
import { DECODE_SOURCE } from "@/preview-3d/infra/load-trace.ts";
import type { ScreenshotLights } from "@/preview-3d/screenshot/screenshot-lights.ts";
import type { RenderMultiAngleOptions } from "@/preview-3d/screenshot/screenshot-render.ts";
import { type AnimationClip, parseBedrockAnimationJSON } from "@/utils/animation/animation.ts";
import { extOf } from "@/utils/resource/types.ts";

/* ---------- 注入契约（随流水线迁入，views 从本模块 import 合法——adapters/ 在 R10 入口面）----------
 * 这两个接口描述的是**流水线的输入能力**，不再是视图自持能力：解码已归 p3d 自持，
 * 调试通道由视图实现后按需传入。views/utils.ts 的 PreviewCtx 仍 extends PreviewDebugger。 */

/** WASM 解码能力（可选覆盖；缺省 = 流水线自持 decoder/wasm-decode） */
export interface YsmDecoder {
  decodeYsmViaWasm(path: string): Promise<DecodedYsm | null>;
}

/** 调试输出能力（可选覆盖；缺省 = 丢弃，真正的调试面板实现仍在视图层） */
export interface PreviewDebugger {
  appendDebug(container: HTMLElement | null, msg: string): void;
}

/** 流水线 ctx：两项能力均可缺省（缺省 = 自持解码 + 丢弃调试输出） */
export type YsmModelLoadCtx = Partial<YsmDecoder & PreviewDebugger>;

/** 自持缺省 ctx：解码归 p3d（views 不再自持解码实现，ADR-270-d5） */
const YSM_SELF_CTX: YsmDecoder & PreviewDebugger = {
  decodeYsmViaWasm,
  appendDebug: () => {},
};

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
  ctx: YsmModelLoadCtx = {},
  opts: LoadModelOpts = {},
): Promise<BedrockGeometry | null> {
  const useCtx: YsmDecoder & PreviewDebugger = { ...YSM_SELF_CTX, ...ctx };
  // 查缓存：subPath（L0 单角色）必须并入缓存键，否则切角色命中旧角色几何（审核 P2）
  const cacheKey = opts.subPath ? `${modelPath}#sub:${opts.subPath}` : modelPath;

  // ① 查缓存命中 → 直接回填动画回返
  const fromCache = loadModelFromCache(cacheKey);
  let model = fromCache;
  let wasmAuthors: NonNullable<BedrockGeometry["_authors"]> = [];
  let wasmAvatars: Record<string, string> = {};

  // ② .ysm → 前端 WASM 解码（仅未命中缓存时）
  if (!model) {
    const wasm = await loadModelViaWasm(useCtx, modelPath, cacheKey, !!opts.skipWasm);
    model = wasm.model;
    wasmAuthors = wasm.authors;
    wasmAvatars = wasm.avatars;
  }

  // ③ 非 YSM/ZIP/JSON 或 WASM 失败/空骨骼 → 走 Go 兜底
  if (!model?.bones?.length) {
    model = await loadModelViaGo(useCtx, modelPath, opts, model, wasmAuthors, wasmAvatars);
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

  return model || null;
}

/** 缓存命中读取：含骨骼几何才视为命中，并回填动画 clips */
function loadModelFromCache(cacheKey: string): BedrockGeometry | null {
  const cached = cacheGet(cacheKey);
  const cachedGeo = cached?.geometry as BedrockGeometry | undefined;
  if (!cachedGeo?.bones?.length) {
    return null;
  }
  // 缓存回填动画（此前 WASM/Go 解码时写入缓存的 clips）
  const cachedAnims = cached?.animations;
  if (!cachedGeo._animClips && Array.isArray(cachedAnims) && cachedAnims.length > 0) {
    cachedGeo._animClips = cachedAnims as AnimationClip[];
  }
  // 从缓存恢复解码器标记（模型对象本身已带 _decodedBy，此处仅作兜底）
  if (cached?._decodedBy) cachedGeo._decodedBy = cached._decodedBy;
  return cachedGeo;
}

/** .ysm → 前端 WASM 解码；空结果/空骨骼回退 Go（此处仅返回空壳，不落 Go） */
async function loadModelViaWasm(
  ctx: YsmDecoder & PreviewDebugger,
  modelPath: string,
  cacheKey: string,
  skipWasm: boolean,
): Promise<{
  model: BedrockGeometry | null;
  authors: NonNullable<BedrockGeometry["_authors"]>;
  avatars: Record<string, string>;
}> {
  // WASM 仅对 .ysm 二进制格式有意义；.zip/.7z/.json 通用格式走 Go
  const isWasmCapable = !skipWasm && extOf(modelPath) === ".ysm";
  if (!isWasmCapable) {
    return { model: null, authors: [], avatars: {} };
  }
  const decoded = await ctx.decodeYsmViaWasm(modelPath);
  const authors = (decoded?.authors || []) as NonNullable<BedrockGeometry["_authors"]>;
  const avatars = decoded?.avatars || {};
  if (decoded?.geometry?.bones?.length) {
    const model = decoded.geometry;
    model._decodedBy = decoded._decodedBy || DECODE_SOURCE.wasm;
    model._authors = authors;
    model._avatars = avatars;
    // 内嵌动画：WASM 已把 .ysm 包内 animations/*.json 解析为 clips——
    // 单文件模型磁盘没有动画文件，这是动画数据的主来源（修复动作面板空列表）
    if (Array.isArray(decoded.animations) && decoded.animations.length > 0) {
      model._animClips = decoded.animations as AnimationClip[];
    }
    cacheSet(cacheKey, {
      ...(cacheGet(cacheKey) || {}),
      geometry: model,
    });
    return { model, authors, avatars };
  }
  ctx.appendDebug(null, "[YSM] WASM 返回空或无骨骼，回退 Go");
  return { model: null, authors, avatars };
}

/** Go 解析：subPath 单角色优先（AnalyzeBedrockModelEntry 可用时），未命中/无骨骼回退全量 */
async function resolveGoModel(
  ctx: YsmDecoder & PreviewDebugger,
  app: Awaited<ReturnType<typeof getApp>>,
  modelPath: string,
  opts: LoadModelOpts,
  current: BedrockGeometry | null,
): Promise<BedrockGeometry | null> {
  let model = current;
  // subPath 模式：先试单条目解析（多角色包切角色），再回退全量
  if (opts.subPath && typeof app.AnalyzeBedrockModelEntry === "function") {
    const entryModel = (await app.AnalyzeBedrockModelEntry(modelPath, opts.subPath)) as
      | BedrockGeometry
      | null
      | undefined;
    if (entryModel?.bones?.length) {
      model = entryModel;
      ctx.appendDebug(null, `[L0] 单角色解析：${opts.subPath}`);
    }
  }
  if (!model) {
    const { AnalyzeBedrockModel } = app;
    model = (await AnalyzeBedrockModel(modelPath)) as BedrockGeometry | null;
  }
  return model;
}

/** WASM 无几何但带 authors → 由 WASM authors 填补（Go 无 authors 字段） */
function fillWasmAuthors(
  model: BedrockGeometry | null,
  wasmAuthors: NonNullable<BedrockGeometry["_authors"]>,
  wasmAvatars: Record<string, string>,
): void {
  if (model && !model._authors && wasmAuthors.length) {
    model._authors = wasmAuthors;
    model._avatars = wasmAvatars;
  }
}

/** Go 兜底动画：逐条解析 .animation.json → clips（文件夹/zip 模型的 .animation.json 由 Go 收集透传） */
function collectGoClips(model: BedrockGeometry): unknown[] {
  const goClips: unknown[] = [];
  if (model.animations?.length) {
    for (const jsonStr of model.animations as string[]) {
      const { clips } = parseBedrockAnimationJSON(jsonStr);
      if (clips.length > 0) goClips.push(...clips);
    }
  }
  return goClips;
}

/** Go 兜底元数据挂载：_decodedBy + _texMappingLog（单纹理/多纹理两条目） */
function attachGoModelMeta(
  model: BedrockGeometry,
  goClips: unknown[],
  opts: LoadModelOpts,
  modelPath: string,
): void {
  // Go 兜底路径同样挂载（文件夹/zip 模型的 .animation.json 由 Go 收集透传）
  if (goClips.length > 0) model._animClips = goClips as AnimationClip[];
  model._decodedBy = opts.subPath ? DECODE_SOURCE.goSingle : DECODE_SOURCE.go;
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
}

/** Go AnalyzeBedrockModel 兜底：subPath 单角色优先，再回退全量；挂 authors/animClips/texMappingLog */
async function loadModelViaGo(
  ctx: YsmDecoder & PreviewDebugger,
  modelPath: string,
  opts: LoadModelOpts,
  current: BedrockGeometry | null,
  wasmAuthors: NonNullable<BedrockGeometry["_authors"]>,
  wasmAvatars: Record<string, string>,
): Promise<BedrockGeometry | null> {
  const app = await getApp();
  // current 可能是缓存命中但无骨骼的对象：subPath 未命中时不覆盖它（沿用原有无骨骼对象语义）
  const cacheKey = opts.subPath ? `${modelPath}#sub:${opts.subPath}` : modelPath;
  const model = await resolveGoModel(ctx, app, modelPath, opts, current);

  // WASM 无几何但带 authors → 由 WASM authors 填补（Go 无 authors 字段）
  fillWasmAuthors(model, wasmAuthors, wasmAvatars);

  if (model?.bones?.length) {
    const goClips = collectGoClips(model);
    attachGoModelMeta(model, goClips, opts, modelPath);
    cacheSet(cacheKey, {
      ...(cacheGet(cacheKey) || {}),
      ...(model.texture !== undefined ? { texture: model.texture } : {}),
      geometry: model,
      ...(goClips.length > 0 ? { animations: goClips } : {}),
    });
  }

  return model;
}

/**
 * 异步补全作者/头像信息（不阻塞首帧渲染）
 * 在几何渲染完成后调用，后台补齐作者名 + 头像 URL
 */
export async function fillAuthorsAsync(modelPath: string, model: BedrockGeometry): Promise<void> {
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

/* ---------- 截图路径的解码实参组装（ADR-136 注入缝的唯一合法组装点）----------
 * `renderMultiAngle` 需要 WASM 解码兜底通道才能重建空 spec 的几何；该能力是 p3d 内部件，
 * views 不得直接穿透（R10），故由流水线组装成渲染实参交给截图编排——视图只提供纹理/灯光
 * 等视图侧数据，不再触碰 decoder。 */

/** 截图渲染所需的模型面（纹理清单来自已加载模型，非视图状态） */
export interface YsmShotModel {
  texture?: string | null;
  textures?: string[] | null;
  componentTextures?: Record<string, string[]>;
  _modelPath?: string;
}

/** renderMultiAngle 的两段式实参：纹理槽清单 + 渲染选项（含自持解码缝） */
export interface YsmShotRenderArgs {
  texUrls: string[];
  options: RenderMultiAngleOptions;
}

/**
 * 组装截图渲染实参。
 * 纹理槽 = 模型全量纹理清单（多纹理才用数组，单纹理回落 `[texture]`，空纹理占位 `""`）；
 * 渲染选项带上 WASM 解码缝（空 spec 时重建几何的唯一通道）。
 */
export function buildYsmShotRenderArgs(
  model: YsmShotModel,
  base: { size?: number; lights?: ScreenshotLights | null } = {},
): YsmShotRenderArgs {
  const texUrls =
    model.textures && model.textures.length > 1 ? model.textures : [model.texture || ""];
  const options: RenderMultiAngleOptions = {
    ...(base.size != null ? { size: base.size } : {}),
    ...(model.componentTextures != null ? { componentTextures: model.componentTextures } : {}),
    ...(base.lights != null ? { lights: base.lights } : {}),
    decodeYsm: decodeYsmViaWasm,
  };
  return { texUrls, options };
}
