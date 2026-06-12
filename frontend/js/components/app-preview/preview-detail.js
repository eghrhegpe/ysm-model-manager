// ===== 模型/材质包详情面板 =====
// 从 index.js 拆分：详情面板渲染逻辑
import { summaryCardHTML } from "../../utils/summarize.js";
import { devLog } from "./preview-utils.js";

const esc = (s) =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 显示模型详情（YSM 模型） */
export async function showModelDetail(ctx, path) {
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

  const switchTab = (tab) => {
    localStorage.setItem("ysm_previewTab", tab);
    ctx._root.querySelectorAll(".preview-tab").forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("ysm-tab-active", isActive);
      btn.classList.toggle("ysm-tab-inactive", !isActive);
    });
    const detail = ctx._root.getElementById("preview-detail");
    const skel = ctx._root.getElementById("preview-skeleton");
    detail.style.display = tab === "detail" ? "" : "none";
    skel.style.display = tab === "skeleton" ? "" : "none";
  };
  ctx._root.querySelectorAll(".preview-tab").forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  const previewSrc = await ctx._loadPreviewImage(path);

  try {
    const { ExtractYsmSummary, ExtractYSMHeader } =
      await import("../../../wailsjs/go/main/App.js");
    const results = await Promise.allSettled([
      ExtractYsmSummary(path),
      ExtractYSMHeader(path),
    ]);
    const summary = results[0].status === "fulfilled" ? results[0].value : null;
    const header = results[1].status === "fulfilled" ? results[1].value : null;
    const basename = path.split("/").pop().split("\\").pop();
    const hasRealSummary =
      summary &&
      (summary.stats?.textures > 0 ||
        summary.stats?.models > 0 ||
        summary.stats?.animations > 0 ||
        summary.stats?.texWidth > 0 ||
        summary.authors?.length > 0 ||
        summary.license);

    let cardHTML = "";
    if (hasRealSummary || header) {
      cardHTML = summaryCardHTML(
        hasRealSummary ? summary : null,
        header,
        basename,
      );
    } else {
      throw new Error("无法解析此文件");
    }
    if (previewSrc) {
      cardHTML = cardHTML.replace(
        '<div class="content" id="preview-content">',
        `<div style="float:right;width:70px;margin:0 0 6px 6px"><img src="${previewSrc}" alt="预览" onerror="this.style.display='none'" style="width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid var(--bd)"></div>`,
      );
    }
    const detailDiv = ctx._root.getElementById("preview-detail");
    detailDiv.innerHTML = cardHTML;

    // 加载 2D 模型预览（骨架 tab）
    const { loadModel2D } = await import("./preview-skeleton.js");
    loadModel2D(ctx, path, ctx._root.getElementById("preview-skeleton"));
  } catch (err) {
    const detailDiv = ctx._root.getElementById("preview-detail");
    if (detailDiv) {
      detailDiv.innerHTML = `未知错误解析失败: ${err?.message || err}`;
    }
  }
}

/** 显示材质包信息（pack.mcmeta + pack.png） */
export async function showResourcePack(ctx, path) {
  try {
    const { ReadPackMeta } = await import("../../../wailsjs/go/main/App.js");
    const jsonStr = await ReadPackMeta(path);
    const meta = JSON.parse(jsonStr);
    const basename = path.split("/").pop().split("\\").pop();
    const desc = (meta.description || "").replace(/§[0-9a-fklmnor]/g, "");
    ctx._root.innerHTML = `<div class="content" id="preview-content">
  <h3>🎨 材质包</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    ${meta.thumbnail ? `<img src="${meta.thumbnail}" alt="pack" style="width:128px;height:128px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">` : ""}
    <div><strong>${esc(basename)}</strong></div>
    ${desc ? `<div style="color:var(--muted);line-height:1.6">${esc(desc)}</div>` : ""}
    <div style="color:var(--muted);font-size:var(--fs-xs)">pack_format: ${meta.pack_format || "?"}</div>
  </div>
</div>`;
  } catch (e) {
    ctx._root.innerHTML = `<div class="content" id="preview-content"><h3>🎨 材质包</h3><div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">读取失败: ${esc(e.message)}</div></div></div>`;
  }
}
