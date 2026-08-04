// ===== 模型/资源包详情面板 =====
// 从 index.ts 拆分：详情面板渲染逻辑
import { summaryCardHTML } from "../../utils/format/summarize.ts";
import { renderFormattedText } from "../../utils/format/mc-format.ts";
import { esc } from "../../utils/dom/dom.ts";
import { getApp } from "../../wails/app.ts";
import type { PreviewCtx } from "./preview-utils.ts";

/** 详情面板 generation：每次展示新预览自增，慢请求返回后比对，过期结果不回写 DOM */
let _detailGen = 0;

/** 显示模型详情（YSM 模型） */
export async function showModelDetail(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  const gen = ++_detailGen;
  const savedTab = localStorage.getItem("ysm_previewTab") || "detail";
  ctx._root.innerHTML = `<div class="content" id="preview-content">
  <div class="ysm-tab-row">
    <button class="preview-tab ysm-tab ${savedTab === "detail" ? "ysm-tab-active" : "ysm-tab-inactive"}" data-tab="detail">📄 详情</button>
    <button class="preview-tab ysm-tab ${savedTab === "skeleton" ? "ysm-tab-active" : "ysm-tab-inactive"}" data-tab="skeleton">🏗️ 骨骼</button>
    <button class="ysm-tab ysm-tab-inactive" id="btn-3d-preview" title="3D 预览">🎨 3D</button>
  </div>
  <div id="preview-detail"${savedTab !== "detail" ? ' style="display:none"' : ""}><h3>📄 模型信息</h3><div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">正在解析模型文件...</div></div></div>
  <div id="preview-skeleton"${savedTab !== "skeleton" ? ' style="display:none"' : ""}></div>
</div>`;

  const switchTab = (tab: string): void => {
    localStorage.setItem("ysm_previewTab", tab);
    ctx._root.querySelectorAll(".preview-tab").forEach((btn) => {
      const isActive = (btn as HTMLElement).dataset.tab === tab;
      btn.classList.toggle("ysm-tab-active", isActive);
      btn.classList.toggle("ysm-tab-inactive", !isActive);
    });
    const detail = ctx._root.getElementById("preview-detail");
    const skel = ctx._root.getElementById("preview-skeleton");
    if (detail) detail.style.display = tab === "detail" ? "" : "none";
    if (skel) skel.style.display = tab === "skeleton" ? "" : "none";
  };
  ctx._root.querySelectorAll(".preview-tab").forEach((btn) => {
    (btn as HTMLElement).onclick = (): void => switchTab((btn as HTMLElement).dataset.tab || "");
  });

  // 预热缩略图缓存（loadModel2D / 列表视图复用）
  await ctx._loadPreviewImage(path);
  if (gen !== _detailGen) return; // 用户已切换到其他预览

  try {
    const { ExtractYsmSummary, ExtractYSMHeader } =
      await getApp();
    const results = await Promise.allSettled([
      ExtractYsmSummary(path),
      ExtractYSMHeader(path),
    ]);
    if (gen !== _detailGen) return; // 解析期间用户已切换
    const summary = results[0].status === "fulfilled" ? results[0].value : null;
    const header = results[1].status === "fulfilled" ? results[1].value : null;
    const basename = path.split(/[/\\]/).pop() || "";
    const hasRealSummary =
      !!summary &&
      ((summary.stats?.textures ?? 0) > 0 ||
        (summary.stats?.models ?? 0) > 0 ||
        (summary.stats?.animations ?? 0) > 0 ||
        (summary.stats?.texWidth ?? 0) > 0 ||
        (summary.authors?.length ?? 0) > 0 ||
        !!summary.license);

    let cardHTML = "";
    if (hasRealSummary || header) {
      cardHTML = summaryCardHTML(
        hasRealSummary ? summary : null,
        header,
        basename || "",
      );
    } else {
      throw new Error("无法解析此文件");
    }
    cardHTML = cardHTML.replace(
      '<div class="content" id="preview-content">',
      '<div class="content" id="preview-content"><div id="ysm-author-avatars"></div>',
    );
    const detailDiv = ctx._root.getElementById("preview-detail");
    if (detailDiv) detailDiv.innerHTML = cardHTML;

    // 加载 2D 模型预览（骨架 tab）；loadModel2D 内部已兜底渲染错误，此处仅防未处理拒绝
    const { loadModel2D } = await import("./preview-skeleton.js");
    loadModel2D(ctx, path, ctx._root.getElementById("preview-skeleton")).catch(
      (e) => console.warn("[preview] loadModel2D:", e),
    );
  } catch (err) {
    if (gen !== _detailGen) return;
    const detailDiv = ctx._root.getElementById("preview-detail");
    if (detailDiv) {
      detailDiv.innerHTML = `未知错误解析失败: ${esc(err instanceof Error ? err.message : String(err))}`;
    }
  }
}

/** 显示资源包信息（pack.mcmeta + pack.png） */
export async function showResourcePack(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  const gen = ++_detailGen;
  try {
    const { ReadPackMeta } = await getApp();
    const jsonStr = await ReadPackMeta(path);
    if (gen !== _detailGen) return;
    const meta = JSON.parse(jsonStr) as {
      description?: string;
      thumbnail?: string;
      pack_format?: number;
      supported_formats?: number[];
      min_format?: number | number[];
      max_format?: number | number[];
    };
    const basename = path.split(/[/\\]/).pop() || "";
    const desc = renderFormattedText(meta.description || "");
    const { describeVersionRange } = await import("../../utils/format/pack-format.ts");
    if (gen !== _detailGen) return;
    const rv = describeVersionRange(meta);
    ctx._root.innerHTML = `<div class="content" id="preview-content">
  <h3>🎨 资源包</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    ${meta.thumbnail ? `<img src="${esc(meta.thumbnail)}" alt="pack" style="width:128px;height:128px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">` : `<div style="width:128px;height:128px;border-radius:6px;border:1px solid var(--bd);align-self:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:var(--surf)"><div style="font-size:40px;line-height:1">❌</div><div style="font-size:var(--fs-sm);color:var(--muted)">无pack.png</div></div>`}
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    ${desc ? `<div style="color:var(--muted);line-height:1.6">${desc}</div>` : ""}
    <div style="color:var(--muted);font-size:var(--fs-xs)">pack_format: ${rv.format}${rv.version ? "（" + rv.version + "）" : ""}</div>
  </div>
</div>`;
  } catch (e) {
    if (gen !== _detailGen) return;
    ctx._root.innerHTML = `<div class="content" id="preview-content"><h3>🎨 资源包</h3><div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">读取失败: ${esc(e instanceof Error ? e.message : String(e))}</div></div></div>`;
  }
}

/** 显示简单类型预览（仅图标 + 名称），用于光影包/蓝图/MMD/VRChat 等 */
export async function showShaderPack(
  ctx: PreviewCtx,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  ++_detailGen; // 无 await 也要作废在途的慢请求回写
  const icon = (opts && opts.icon) || "☀️";
  const label = (opts && opts.label) || "光影包";
  const basename = path.split(/[/\\]/).pop() || "";
  ctx._root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
  </div>
</div>`;
}
