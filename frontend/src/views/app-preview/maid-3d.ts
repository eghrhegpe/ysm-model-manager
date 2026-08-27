// ===== 车万女仆 3D 预览（Bedrock 通用模式）=====
// ADR-Bedrock 通用化：复用 YSM 适配器的 Bedrock 渲染管道，
// 以 mode="generic" 跳过 YSM 专属特性（动画扫描/语义骨骼/呼吸控制）。
// 女仆模型本质是标准 Bedrock Edition geometry，Go AnalyzeBedrockModel
// 已天然支持 .zip 解析（parseModelFromEntries 通用路径）。
import { mount3D, cleanupPreview, invalidatePreview } from "../../utils/3d/adapters/mount-preview-core.ts";
import { makeYsmAdapter } from "../../utils/3d/adapters/ysm-adapter.ts";
import { getApp } from "../../backend/app.ts";
import type { BedrockGeometry } from "./geometry.ts";
import { preloadModel } from "./model3d-loader.ts";
import { loadModelData } from "./loader.ts";
import { fillYsmModelPanel, fillYsmShotPanel, attachYsmBoneSelect } from "./ysm-controls.ts";
import { registerReRoute, withPreviewExtras } from "./preview-library.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { t } from "../../core/i18n/t.ts";
import { esc } from "../../utils/dom/html.ts";
import { promoteTitleIfPresent } from "../../utils/dom/tooltip.ts";
import { setActive3DClose } from "./skeleton.ts";
import { registerAndroidBackHandler } from "../../utils/dom/android-bridge.ts";
import type { PreviewCtx } from "./utils.ts";
import type { BedrockSubModel } from "./geometry.ts";
import type { YsmMetadata } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import { GenGuard } from "./gen-guard.ts";

/** 数据读取注入 */
async function readFileBytes(path: string): Promise<string | null> {
  const App = await getApp();
  return (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"](path);
}

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
  /** 打开时默认选中的子模型索引（多角色包内切换）。
   *  取值范围 [0, subModels.length)；越界或缺省 = 载入第 0 个（或未过滤的合并模型，后续接过滤）。 */
  subModelIdx?: number;
  /** 选中 subModel 的 zip 内相对路径（SubModel.SourcePath），有值时走 AnalyzeBedrockModelEntry 单模型解析。
   *  由调用方根据 subModelIdx 从 subModels[subModelIdx].sourcePath 推导并显式传入（因为 loader 是外部闭包，
   *  createMaid3D 内部拿不到 subModels 清单）。 */
  subPath?: string;
}

/**
 * 打开车万女仆 3D 预览（Bedrock generic 模式）。
 * 与 YSM 共享 spec→Three.js 渲染管道，跳过动画/语义骨骼等 YSM 专属特性。
 */
async function createMaid3D(
  path: string,
  texIdx = 0,
  opts: MaidOpenOptions,
): Promise<void> {
  const rebuild = (idx: number, subIdx?: number): void => {
    cleanupPreview();
    void createMaid3D(path, idx, { ...opts, subModelIdx: subIdx ?? opts.subModelIdx });
  };
  cleanupPreview();
  await mount3D(
    makeYsmAdapter(path, {
      mode: "generic",
      texIdx,
      loader: opts.loader,
      preload: (model) => preloadModel(model as never),
      onTextureChange: rebuild,
      onClose: opts.onClose,
      readTextFile: readFileBytes,
      panels: {
        fillModelPanel: fillYsmModelPanel,
        fillShotPanel: fillYsmShotPanel,
        attachBoneSelect: attachYsmBoneSelect,
      },
      subModelIdx: opts.subModelIdx ?? 0,
    } as Parameters<typeof makeYsmAdapter>[1]),
    path,
    withPreviewExtras({ siblings: opts.siblings }),
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

/** 详情预览共享局域状态（选中子模型索引 + 3D 打开并发防护） */
interface MaidPreviewState {
  selSubIdx: number;
  loading3D: boolean;
  model3dGuard: GenGuard;
}

/** AnalyzeBedrockModel 返回的模型信息快照 */
type MaidModelInfo = {
  boneCount?: number;
  cubeCount?: number;
  textureCount?: number;
  format?: string;
  texWidth?: number;
  texHeight?: number;
  subModels?: BedrockSubModel[];
  metadata?: YsmMetadata;
} | null;

/** 渲染详细信息（纯字符串拼接；对 subs>1 的包摘要显示选中 subModel 的 texSlot/名字） */
function dpRenderDetail(
  modelInfo: MaidModelInfo,
  subs: BedrockSubModel[],
  selSubIdx: number,
): string {
  const rows: string[] = [];
  if (modelInfo?.format) rows.push(`<div class="dp-hint">📐 ${t("preview.formatVersion")}: ${esc(modelInfo.format)}</div>`);
  const sel = subs[selSubIdx];
  if (subs.length > 1 && sel) {
    rows.push(`<div class="dp-hint">🧸 ${t("preview.selectedCharacter")}: <b>${esc(sel.name)}</b></div>`);
  }
  if (modelInfo?.boneCount !== undefined) rows.push(`<div class="dp-hint">🦴 ${t("preview.boneCount")}: ${modelInfo.boneCount}</div>`);
  if (modelInfo?.cubeCount !== undefined) rows.push(`<div class="dp-hint">📦 ${t("preview.cubeCount")}: ${modelInfo.cubeCount}</div>`);
  if (modelInfo?.textureCount !== undefined && modelInfo.textureCount > 0) {
    rows.push(`<div class="dp-hint">🎨 ${t("preview.textureCount")}: ${modelInfo.textureCount}</div>`);
    if (modelInfo.texWidth && modelInfo.texHeight) {
      rows.push(`<div class="dp-hint">📏 ${t("preview.textureSize")}: ${modelInfo.texWidth}×${modelInfo.texHeight}</div>`);
    }
  }
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

/** 渲染子模型选择列表（纯字符串拼接；>1 才显示，能力驱动） */
function dpRenderSubList(subs: BedrockSubModel[], selSubIdx: number): string {
  if (subs.length <= 1) return "";
  const chips = subs
    .map((s, i) => {
      const active = i === selSubIdx ? ' class="active"' : "";
      return `<li data-idx="${i}"${active}><span class="chip-name">${esc(s.name)}</span>${s.texSlot !== undefined ? `<span class="chip-slot">🎨${s.texSlot}</span>` : ""}</li>`;
    })
    .join("");
  return `<div class="dp-submodels">
    <div class="dp-hint" style="font-weight:600;margin-bottom:8px">🧩 ${t("preview.l0Roles")} (${subs.length})</div>
    <ul class="dp-sublist" role="listbox">${chips}</ul>
  </div>`;
}

/** 重绘主面板 + 事件重绑（sublist 选中 / FAB 进 3D） */
function dpRenderPanel(
  ctx: PreviewCtx,
  basename: string,
  modelInfo: MaidModelInfo,
  subs: BedrockSubModel[],
  selSubIdx: number,
  onSelect: (idx: number) => void,
  onToggle3d: () => void,
): void {
  const detail = dpRenderDetail(modelInfo, subs, selSubIdx);
  const subList = dpRenderSubList(subs, selSubIdx);
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>🧸 ${t("preview.modelInfo")}</h3>
  <div class="dp-placeholder">
    <div class="big-icon">🧸</div>
    <div class="dp-hint" style="font-weight:600">${esc(basename)}</div>
    <div class="dp-hint">Bedrock Edition Model</div>
    ${detail ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:4px">${detail}</div>` : `<div class="dp-hint" style="margin-top:8px;font-size:11px;color:var(--txt-dim)">⚠️ 无法读取模型数据</div>`}
    ${subList ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">${subList}</div>` : ""}
  </div>
</div>
<button class="preview-fab" id="btn-3d-preview" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">&#x1F3A8;</span></button>`;

  // subModel 选中点击
  ctx.root.querySelectorAll<HTMLLIElement>(".dp-sublist li").forEach((li) => {
    li.onclick = () => {
      const idx = Number(li.getAttribute("data-idx"));
      if (!Number.isFinite(idx) || idx < 0 || idx >= subs.length) return;
      onSelect(idx);
    };
  });
  // FAB 接线（含选中的 subModelIdx + 默认 texSlot）
  const btn3d = ctx.root.getElementById("btn-3d-preview");
  if (btn3d) {
    promoteTitleIfPresent(btn3d);
    btn3d.onclick = () => { void onToggle3d(); };
  }
}

/** 进入 3D 预览（并发防护：loading3D/model3dGuard 放 state 随预览实例隔离） */
async function dpToggle3D(
  state: MaidPreviewState,
  ctx: PreviewCtx,
  path: string,
  modelInfo: MaidModelInfo,
  subs: BedrockSubModel[],
  selSubIdx: number,
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
    const sel = subs[selSubIdx];
    // subPath：选中角色的 zip 内相对路径，用于 Go AnalyzeBedrockModelEntry 单模型解析
    // 若 subModel.sourcePath 未声明（L1 兜底清单），则不走单 entry 路径，回退全量合并。
    const subPath = subs.length > 1 ? sel?.sourcePath : undefined;
    // texIdx 优先级：选中角色的 texSlot（若声明）→ 默认 0
    const texStart = sel && typeof sel.texSlot === "number" && modelInfo?.textureCount
      ? Math.min(sel.texSlot, modelInfo.textureCount - 1)
      : 0;
    await createMaid3D(path, texStart, {
      loader: async (p) =>
        (
          await loadModelData(p, ctx, {
            skipWasm: true,
            subPath,
          })
        ).model,
      onClose,
      subModelIdx: subs.length > 1 ? selSubIdx : undefined,
      subPath,
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
  const basename = path.split(/[/\\]/).pop() || path;
  // 先显示加载状态
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>🧸 ${t("preview.modelInfo")}</h3>
  <div class="dp-placeholder">
    <div class="big-icon">🧸</div>
    <div class="dp-hint">${esc(basename)}</div>
    <div class="dp-hint">${t("preview.bedrockModel")}</div>
    <div class="dp-hint" style="margin-top:8px;font-size:11px;color:var(--txt-dim)">⏳ ${t("preview.analyzingModel")}</div>
  </div>
</div>
<button class="preview-fab" id="btn-3d-preview" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">&#x1F3A8;</span></button>`;

  // 调用 Go 端分析模型数据（含 subModels L0 清单）
  let modelInfo: MaidModelInfo = null;
  try {
    const { AnalyzeBedrockModel } = await getApp();
    const model = await AnalyzeBedrockModel(path);
    if (model) {
      modelInfo = {
        boneCount: model.boneCount,
        cubeCount: model.cubeCount,
        textureCount: (model.textures as unknown[] | undefined)?.length || (model.texture ? 1 : 0),
        format: model.format as string | undefined,
        texWidth: model.texWidth as number | undefined,
        texHeight: model.texHeight as number | undefined,
        subModels: model.subModels as BedrockSubModel[] | undefined,
        metadata: model.metadata ?? undefined,
      };
    }
  } catch (e) {
    console.warn("[maid-preview] AnalyzeBedrockModel:", e);
  }

  const subs = modelInfo?.subModels && modelInfo.subModels.length > 0 ? modelInfo.subModels : [];
  // 共享局域 state：选中子模型索引 + 3D 打开并发防护
  const state: MaidPreviewState = { selSubIdx: 0, loading3D: false, model3dGuard: new GenGuard() };
  const render = (): void => {
    dpRenderPanel(
      ctx,
      basename,
      modelInfo,
      subs,
      state.selSubIdx,
      (idx) => { state.selSubIdx = idx; render(); },
      () => { void dpToggle3D(state, ctx, path, modelInfo, subs, state.selSubIdx); },
    );
  };

  await ctx.loadPreviewImage(path);
  render();
}