// ===== 车万女仆 3D 预览（Bedrock 通用模式）=====
// ADR-Bedrock 通用化：复用 YSM 适配器的 Bedrock 渲染管道，
// 以 mode="generic" 跳过 YSM 专属特性（动画扫描/语义骨骼/呼吸控制）。
// 女仆模型本质是标准 Bedrock Edition geometry，Go AnalyzeBedrockModel
// 已天然支持 .zip 解析（parseModelFromEntries 通用路径）。
import { mount3D, cleanupPreview, invalidatePreview } from "../../preview-3d/adapters/mount-preview-core.ts";
import { makeYsmAdapter } from "../../preview-3d/adapters/ysm-adapter.ts";
import { getApp } from "../../backend/app.ts";
import type { BedrockGeometry } from "../../preview-3d/decoder/geometry.ts";
import { preloadModel, type ModelLike } from "./model3d-loader.ts";
import { loadModelData } from "./loader.ts";
import { fillYsmShotPanel, ysmShotNodes, registerYsmModelSchema } from "./ysm-controls.ts";
import { statsCardHTML, type StatsCardModel } from "./tpl.ts";
import { registerReRoute, withPreviewExtras } from "./preview-library.ts";
import { detailGen } from "./detail.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { promoteTitleIfPresent } from "../../utils/dom/tooltip.ts";
import { setActive3DClose } from "./skeleton.ts";
import { registerAndroidBackHandler } from "../../utils/dom/android-bridge.ts";
import type { PreviewCtx } from "./utils.ts";
import { componentCountsFromSpec } from "./skeleton-render.ts";
import type { YsmMetadata } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import { GenGuard } from "./gen-guard.ts";
import { readFileBytes } from "./view-shell.ts";

/** 跨类型换角色路由 */
async function openMaidFullscreen(path: string): Promise<void> {
  await createMaid3D(path, 0, {
    loader: async (p) =>
      (await loadModelData(p, { decodeYsmViaWasm: () => Promise.resolve(null), appendDebug: () => {} }, { skipWasm: true })).model,
  });
}
registerReRoute(RESOURCE_TYPES.MAID, openMaidFullscreen);

export interface MaidOpenOptions {
  loader: (path: string) => Promise<BedrockGeometry | null>;
  onClose?: () => void;
  siblings?: string[];
}

/**
 * 打开车万女仆 3D 预览（Bedrock generic 模式）。
 * 与 YSM 共享 spec→Three.js 渲染管道，跳过动画/语义骨骼等 YSM 专属特性。
 * 整包加载：3D spec = GetModel3DSpec(zip) 全量（组件 = 角色 geo 文件），
 * 角色切换在 3D 内「组件」下拉完成（ADR-160——详情页不再承载角色选择）。
 */
async function createMaid3D(
  path: string,
  texIdx = 0,
  opts: MaidOpenOptions,
): Promise<void> {
  const rebuild = (idx: number): void => {
    cleanupPreview();
    void createMaid3D(path, idx, opts);
  };
  cleanupPreview();
  await mount3D(
    makeYsmAdapter({
      mode: "generic",
      texIdx,
      loader: opts.loader,
      preload: (model) => preloadModel(model as ModelLike),
      onTextureChange: rebuild,
      onClose: opts.onClose,
      readTextFile: readFileBytes,
      panels: {
        fillShotPanel: fillYsmShotPanel,
        shotNodes: ysmShotNodes,
        // [doc:adr-126-p5] 受控 schema 注册（P5-A review P1）：maid 也走 buildYsmModelSchema
        // 注册 "ysm-model"——model 面板 schemaId 是唯一通道（无 fallback），不注册则静默空白。
        registerModelSchema: registerYsmModelSchema,
      },
    } as Parameters<typeof makeYsmAdapter>[0]),
    path,
    withPreviewExtras(opts.siblings != null ? { siblings: opts.siblings } : {}),
  );
}

/** 关闭活跃女仆 3D 预览 */
export function cleanupMaid3D(): void {
  cleanupPreview();
}

/** 作废在途女仆 3D 加载 */
export function invalidateMaidPreview(): void {
  invalidatePreview();
}

/** 详情预览共享局域状态（3D 打开并发防护） */
interface MaidPreviewState {
  loading3D: boolean;
  model3dGuard: GenGuard;
}

/** 逐组件统计（GetModel3DSpec spec.models 投影，与 3D「组件」下拉同一视图）。
 *  聚合大字 = 组件合计；spec 不可得时回落 AnalyzeBedrockModel 聚合口径。 */
type ComponentCount = { name: string; bones: number; cubes: number };

/** AnalyzeBedrockModel 返回的模型信息快照（纹理/尺寸/metadata/格式；
 *  骨/立方体由 spec 组件合计，见 showMaidPreview） */
type MaidModelInfo = {
  boneCount?: number;
  cubeCount?: number;
  format?: string | undefined;
  texWidth?: number | undefined;
  texHeight?: number | undefined;
  /** 纹理 base64 data URI 数组（与 YSM statsCard 同源，喂 statsCardHTML 用） */
  textures?: unknown[] | undefined;
  /** 纹理文件名（去扩展名），与 textures 同序 */
  textureNames?: string[] | undefined;
  /** 纹理分类：player = 角色皮肤可切换；projectile/vehicle 等 = 组件专属 */
  textureCategories?: string[] | undefined;
  metadata?: YsmMetadata | undefined;
} | null;

/** 车万女仆 → statsCardHTML 入参映射（复用 YSM 彩色统计卡渲染）。
 *  componentCounts 由 GetModel3DSpec spec.models 投影（与 3D「组件」下拉同构，
 *  ADR-160 单视图）——模型结构蓝卡静态渲染逐角色行，取代原交互式角色清单；
 *  subCount = 组件数（extraCount = texCount - subCount 口径）。 */
function toStatsCardModel(
  info: MaidModelInfo,
  componentCounts: ComponentCount[],
): StatsCardModel {
  return {
    boneCount: info?.boneCount ?? 0,
    cubeCount: info?.cubeCount ?? 0,
    ...(info?.texWidth !== undefined ? { texWidth: info.texWidth } : {}),
    ...(info?.texHeight !== undefined ? { texHeight: info.texHeight } : {}),
    ...(info?.textures != null ? { textures: info.textures } : {}),
    ...(info?.textureNames != null ? { textureNames: info.textureNames } : {}),
    ...(info?.textureCategories != null ? { textureCategories: info.textureCategories } : {}),
    subCount: componentCounts.length > 0 ? componentCounts.length : 1,
    ...(componentCounts.length > 0 ? { componentCounts } : {}),
  };
}

/**
 * 渲染补充详情（纯字符串拼接）：彩色分区（statsCardHTML）之外的补充信息——
 * format 版本、ysm.json metadata（name/license/tips/authors）。
 * 骨骼/立方体/纹理数/尺寸已由 statsCardHTML 彩色分区承载，此处不重复；
 * 逐角色行由蓝卡 componentCounts 静态渲染（ADR-160），不再有「选中角色」概念。
 */
function dpRenderDetail(
  modelInfo: MaidModelInfo,
): string {
  const rows: string[] = [];
  if (modelInfo?.format) rows.push(`<div class="dp-hint">📐 ${t("preview.formatVersion")}: ${esc(modelInfo.format)}</div>`);
  // ysm.json metadata 段（name/license/tips/authors，Modern YSM RawMetadata 对齐）
  const md = modelInfo?.metadata;
  if (md) {
    if (md.name) rows.push(`<div class="dp-hint" style="font-weight:600">🏷️ ${esc(md.name)}</div>`);
    if (md.license?.type) rows.push(`<div class="dp-hint">📜 ${t("preview.license")}: ${esc(md.license.type)}</div>`);
    if (md.tips) rows.push(`<div class="dp-hint" style="white-space:pre-line;font-size:11px">💬 ${esc(md.tips ?? "")}</div>`);
    if (md.authors && md.authors.length > 0) {
      rows.push(`<div class="dp-hint" style="font-weight:600;margin-top:6px">✒️ ${t("preview.authors")} (${md.authors.length})</div>`);
      for (const a of md.authors) {
        const contact =
          a.contact && Object.keys(a.contact).length > 0
            ? Object.entries(a.contact)
                .map(([p, u]) => {
                  const url = u ?? "";
                  // scheme 白名单（http/https/mailto）防 javascript: 等注入（code review P2 XSS）
                  return /^(https?:|mailto:)/i.test(url)
                    ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(p ?? "")}</a>`
                    : esc(p ?? "");
                })
                .join(" · ")
            : "";
        rows.push(
          `<div class="dp-hint" style="font-size:11px;color:var(--muted)">${esc(a.name ?? "")}${a.role ? `（${esc(a.role ?? "")}）` : ""}${contact ? ` — ${contact}` : ""}</div>`,
        );
      }
    }
  }
  return rows.join("");
}

/** 重绘主面板 + FAB 事件重绑 */
function dpRenderPanel(
  ctx: PreviewCtx,
  basename: string,
  modelInfo: MaidModelInfo,
  componentCounts: ComponentCount[],
  onToggle3d: () => void,
  previewUri?: string | null,
): void {
  // 彩色统计卡（模型结构蓝卡 / 纹理尺寸绿卡 / 文件信息橙卡）——复用 YSM statsCardHTML。
  // 数据源收敛（ADR-160）：逐角色行 = GetModel3DSpec spec.models 投影（与 3D「组件」下拉同构），
  // 不再走 AnalyzeBedrockModel + Entry 逐角色预取的交互清单。
  const statsHTML = modelInfo
    ? `<div class="pv-card">${statsCardHTML(toStatsCardModel(modelInfo, componentCounts), basename)}</div>`
    : "";
  const detail = dpRenderDetail(modelInfo);
  // 封面缩略图（loadPreviewImage 产物）：有图时替换 🧸 大图标，无图回退 🧸 装饰。
  // 样式对齐资源包详情（detail.ts:171）：96px、圆角、边框、pixelated。
  const coverHtml = previewUri
    ? `<img src="${esc(previewUri)}" alt="" style="width:96px;height:96px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">`
    : `<div class="big-icon">🧸</div>`;
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>🧸 ${t("preview.modelInfo")}</h3>
  <div class="dp-placeholder dp-placeholder--head">
    ${coverHtml}
    <div class="dp-hint" style="font-weight:600">${esc(basename)}</div>
    <div class="dp-hint">Bedrock Edition Model</div>
  </div>
  ${statsHTML}
  ${detail ? `<div class="pv-card" style="margin-top:8px">${detail}</div>` : !statsHTML ? `<div class="dp-hint" style="margin-top:8px;font-size:11px;color:var(--txt-dim)">⚠️ 无法读取模型数据</div>` : ""}
</div>
<button class="preview-fab" id="btn-3d-preview" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">&#x1F3A8;</span></button>`;

  // FAB 接线（进整包 3D；角色切换在 3D 内「组件」下拉）
  const btn3d = ctx.root.getElementById("btn-3d-preview");
  if (btn3d) {
    promoteTitleIfPresent(btn3d);
    btn3d.onclick = () => { void onToggle3d(); };
  }
}

/** 进入 3D 预览（并发防护：loading3D/model3dGuard 放 state 随预览实例隔离）。
 *  整包加载（ADR-160）：3D spec = GetModel3DSpec(zip) 全量，组件下拉即角色切换——
 *  不再按详情页选中角色传 subPath 单 entry。 */
async function dpToggle3D(
  state: MaidPreviewState,
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  if (state.loading3D) return;
  state.loading3D = true;
  const gen = state.model3dGuard.next();
  let unsubAndroidBack: (() => void) | null = null;
  const close3D = (): void => {
    cleanupMaid3D();
    state.model3dGuard.invalidate();
    setActive3DClose(null);
    if (unsubAndroidBack) { unsubAndroidBack(); unsubAndroidBack = null; }
    const idx = ctx.unsubs?.indexOf(close3D);
    if (idx !== undefined && idx > -1) ctx.unsubs?.splice(idx, 1);
  };
  const onClose = (): void => {
    setActive3DClose(null);
    if (unsubAndroidBack) { unsubAndroidBack(); unsubAndroidBack = null; }
  };
  ctx.unsubs?.push(close3D);
  setActive3DClose(() => close3D());
  unsubAndroidBack = registerAndroidBackHandler(() => { close3D(); return true; });
  try {
    await createMaid3D(path, 0, {
      loader: async (p) =>
        (
          await loadModelData(p, ctx, {
            skipWasm: true,
          })
        ).model,
      onClose,
    });
  } catch (e) {
    if (state.model3dGuard.stale(gen)) return;
    console.error("[maid-3d] 加载失败:", e);
  }
  state.loading3D = false;
}

/**
 * 车万女仆详情预览（基本信息卡 + 详细数据 + FAB 进 3D）。
 * 调用 Go 端 AnalyzeBedrockModel 获取骨骼数、方块数、纹理等详细信息。
 * FAB 接线复用 skeleton 的 3D overlay 管理（_active3DClose / android-back）。
 */
export async function showMaidPreview(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  // 跨文件快速切换守卫：与 detail 域共享 detailGen——切到其他文件（detail/simple/maid）
  // 会推进代数，本函数 await 续体（loadPreviewImage/AnalyzeBedrockModel）回来后
  // stale 即丢弃在途渲染，避免旧面板画回新文件上。
  const gen = detailGen.next();
  const basename = path.split(/[/\\]/).pop() || path;
  // 先显示加载状态
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>🧸 ${t("preview.modelInfo")}</h3>
  <div class="dp-placeholder dp-placeholder--head">
    <div class="big-icon">🧸</div>
    <div class="dp-hint">${esc(basename)}</div>
    <div class="dp-hint">${t("preview.bedrockModel")}</div>
    <div class="dp-hint" style="margin-top:8px;font-size:11px;color:var(--txt-dim)">⏳ ${t("preview.analyzingModel")}</div>
  </div>
</div>
<button class="preview-fab" id="btn-3d-preview" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">&#x1F3A8;</span></button>`;

  // 数据获取（ADR-160 单视图收敛）：
  //  ① AnalyzeBedrockModel —— 聚合纹理/尺寸/格式/metadata（纹理绿卡/文件信息/补充详情用）
  //  ② GetModel3DSpec —— 逐组件统计唯一源：spec.models[] 与 3D「组件」下拉同一视图，
  //     模型结构蓝卡静态渲染逐角色行；spec 不可得（拆分失败）时回落 ① 聚合口径。
  let baseModelInfo: MaidModelInfo = null;
  let componentCounts: ComponentCount[] = [];
  try {
    const { AnalyzeBedrockModel, GetModel3DSpec } = await getApp();
    const model = await AnalyzeBedrockModel(path);
    if (model) {
      baseModelInfo = {
        boneCount: model.boneCount,
        cubeCount: model.cubeCount,
        format: model.format as string | undefined,
        texWidth: model.texWidth as number | undefined,
        texHeight: model.texHeight as number | undefined,
        textures: model.textures as unknown[] | undefined,
        textureNames: model.textureNames as string[] | undefined,
        textureCategories: model.textureCategories as string[] | undefined,
        metadata: model.metadata ?? undefined,
      };
    }
    const spec = await GetModel3DSpec(path);
    if (spec) {
      componentCounts = componentCountsFromSpec(spec);
      // 纹理尺寸优先 spec 首组件声明值（对齐 3D 面板 / YSM buildStatsCard 口径）
      const m0 = (spec as { models?: Array<{ textureWidth?: number; textureHeight?: number }> }).models?.[0];
      if (m0 && baseModelInfo) {
        baseModelInfo.texWidth = m0.textureWidth ?? baseModelInfo.texWidth;
        baseModelInfo.texHeight = m0.textureHeight ?? baseModelInfo.texHeight;
      }
    }
  } catch (e) {
    console.warn("[maid-preview] 模型数据分析:", e);
  }
  // 大字口径：spec 组件合计优先（YSM 详情同款）；spec 空/失败回落 AnalyzeBedrockModel 聚合值
  if (baseModelInfo && componentCounts.length > 0) {
    baseModelInfo.boneCount = componentCounts.reduce((s, c) => s + c.bones, 0);
    baseModelInfo.cubeCount = componentCounts.reduce((s, c) => s + c.cubes, 0);
  }

  // 共享局域 state：3D 打开并发防护 + 封面预览图 URI
  const state: MaidPreviewState & { previewUri?: string | null } = {
    loading3D: false,
    model3dGuard: new GenGuard(),
    previewUri: null,
  };
  const render = (): void => {
    dpRenderPanel(
      ctx,
      basename,
      baseModelInfo,
      componentCounts,
      () => { void dpToggle3D(state, ctx, path); },
      state.previewUri,
    );
  };

  // 封面预览图（缓存 → WASM → Go 兜底，统一入口）：
  // 先渲染无图态（统计卡立即可见），异步取图后若命中再重绘替换 🧸。
  // 不 await 阻塞首帧——取图走 Go 解析 zip 可能数百 ms，用户无需等图才见统计卡。
  render();

  const cover = await ctx.loadPreviewImage(path);
  if (detailGen.stale(gen)) return; // 用户已切走，丢弃在途封面
  if (cover && cover !== state.previewUri) {
    state.previewUri = cover;
    render();
  }
}