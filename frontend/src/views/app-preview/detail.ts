// ===== 模型/资源包详情面板 =====
// 从 index.ts 拆分：详情面板渲染逻辑。
// ADR-072 D3：3D 入口（showVrmMeta/showMmdPreview）已拆至 detail-3d.ts，
// 本文件保留 2D 详情（showModelDetail/showResourcePack/showSimplePreview/showShaderpack）；
// detailGen 导出供 detail-3d.ts 共享（跨文件快速切换时在途请求互相作废）。
import { summaryCardHTML, type YsmSummary } from "../../utils/format/summarize.ts";
import { renderFormattedText } from "../../utils/format/mc-format.ts";
import { esc } from "../../utils/dom/html.ts";
import { promoteTitleIfPresent } from "../../utils/dom/tooltip.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { getApp } from "../../backend/app.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import type { PreviewCtx } from "./utils.ts";
import { decodeYsmViaWasm } from "./wasm.ts";
import { loadModel2D } from "./skeleton.ts";
import { describeVersionRange } from "../../utils/format/pack-format.ts";
import { t } from "../../core/i18n/t.ts";
import { createPack3D } from "./pack-3d.ts";
import { GenGuard } from "./gen-guard.ts";
import { cacheGet } from "./cache.ts";

/** 跨文件共享代际（detail-3d.ts 等 3D 入口复用，保证快速切换时在途请求互相作废） */
export const detailGen = new GenGuard();

/** 显示模型详情（YSM 模型） */
export async function showModelDetail(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  const gen = detailGen.next();
  const savedTab = safeGet("ysm_previewTab") || "detail";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <div class="pv-tab-row">
    <button class="pv-tab ${savedTab === "detail" ? "pv-tab-active" : "pv-tab-inactive"}" data-tab="detail">📄 ${t("preview.detailTab")}</button>
    <button class="pv-tab ${savedTab === "skeleton" ? "pv-tab-active" : "pv-tab-inactive"}" data-tab="skeleton">🏗️ ${t("preview.tab.skeleton")}</button>
  </div>
  <div id="preview-detail"${savedTab !== "detail" ? ' style="display:none"' : ""}><h3>📄 ${t("preview.modelInfo")}</h3><div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">${t("preview.parsing")}...</div></div></div>
  <div id="preview-skeleton"${savedTab !== "skeleton" ? ' style="display:none"' : ""}></div>
</div>
<button class="preview-fab" id="btn-3d-preview" title="${t("preview.title3d")}" aria-label="${t("preview.title3d")}"><span class="preview-ic">&#x1F3A8;</span></button>`;

  const switchTab = (tab: string): void => {
    safeSet("ysm_previewTab", tab);
    ctx.root.querySelectorAll(".pv-tab").forEach((btn) => {
      const isActive = (btn as HTMLElement).dataset.tab === tab;
      btn.classList.toggle("pv-tab-active", isActive);
      btn.classList.toggle("pv-tab-inactive", !isActive);
    });
    const detail = ctx.root.getElementById("preview-detail");
    const skel = ctx.root.getElementById("preview-skeleton");
    if (detail) detail.style.display = tab === "detail" ? "" : "none";
    if (skel) skel.style.display = tab === "skeleton" ? "" : "none";
  };
  ctx.root.querySelectorAll(".pv-tab").forEach((btn) => {
    (btn as HTMLElement).onclick = (): void => switchTab((btn as HTMLElement).dataset.tab || "");
  });

  // 预热缩略图缓存（loadModel2D / 列表视图复用）
  await ctx.loadPreviewImage(path);
  if (detailGen.stale(gen)) return; // 用户已切换到其他预览

  try {
    const { ExtractYsmSummary, ExtractYSMHeader } =
      await getApp();
    const results = await Promise.allSettled([
      ExtractYsmSummary(path),
      ExtractYSMHeader(path),
    ]);
    if (detailGen.stale(gen)) return; // 解析期间用户已切换
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

    // 加密 .ysm：Go 仅返回基本摘要（无动画/配置/作者），补取自 WASM 解码缓存
    // （解密产物已含完整 ysm.json，属识别级统计，符合 ADR-026 边界）
    let enriched: YsmSummary | null = summary;
    if (!hasRealSummary) {
      const dec = await decodeYsmViaWasm(path);
      if (detailGen.stale(gen)) return;
      const decHasInfo = !!(
        dec?.animGroups?.length ||
        dec?.configMenus?.length ||
        dec?.authors?.length
      );
      if (decHasInfo) {
        enriched = {
          name: header?.name || summary?.name || basename.replace(/\.[^.]+$/, ""),
          authors: (dec.authors || []).map((a) => ({
            name: a.name,
            roles: a.role,
          })),
          animGroups: dec.animGroups || null,
          configMenus: dec.configMenus || null,
          tips: header?.tips || undefined,
          license: header?.license || undefined,
          links: header?.linkHome ? { home: header.linkHome } : undefined,
        };
      }
    }

    let cardHTML = "";
    const showSummary = hasRealSummary ? summary : enriched;
    if (showSummary || header) {
      const decodedBy = cacheGet(path)?._decodedBy || "";
      cardHTML = summaryCardHTML(showSummary, header, basename || "", decodedBy);
    } else {
      throw new Error(t("preview.cannotParse"));
    }
    // 顶部 ysm-author-avatars 小头像行已移除（2026-08-28）：作者头像/角色由详情卡底部
    // 统计卡（buildStatsCard）统一承载，顶部重复渲染无意义（原 detail.ts 注入容器）
    const detailDiv = ctx.root.getElementById("preview-detail");
    if (detailDiv) detailDiv.innerHTML = cardHTML;

    // 详情卡统计容器（方案 A：统计卡彩色分区 + 头像作者挂详情卡底部，骨骼 tab 只留图）
    const statsDiv = document.createElement("div");
    statsDiv.id = "preview-stats";
    statsDiv.style.cssText = "margin-top:10px";
    detailDiv?.appendChild(statsDiv);

    // 加载 2D 模型预览（骨架 tab 只留骨骼线条图；统计卡经 statsContainer 挂详情卡）
    // 进详情本身即触发 loadModel2D 异步解码，统计卡数据（骨骼/立方体/纹理/头像）无需额外请求
    loadModel2D(ctx, path, ctx.root.getElementById("preview-skeleton"), statsDiv).catch(
      (e) => console.warn("[preview] loadModel2D:", e),
    );
  } catch (err) {
    if (detailGen.stale(gen)) return;
    const detailDiv = ctx.root.getElementById("preview-detail");
    if (detailDiv) {
      detailDiv.innerHTML = `${t("preview.unknownError")} ${t("preview.parseFailed")}: ${esc(friendlyError(err))}`;
    }
  }
}

/** 显示资源包信息（pack.mcmeta + pack.png） */
export async function showResourcePack(
  ctx: PreviewCtx,
  path: string,
): Promise<void> {
  const gen = detailGen.next();
  try {
    const { ReadPackMeta } = await getApp();
    const jsonStr = await ReadPackMeta(path);
    if (detailGen.stale(gen)) return;
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
    if (detailGen.stale(gen)) return;
    const rv = describeVersionRange(meta);
    ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>🎨 ${t("preview.resourcePack")}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    ${meta.thumbnail ? `<img src="${esc(meta.thumbnail)}" alt="pack" style="width:128px;height:128px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">` : `<div style="width:128px;height:128px;border-radius:6px;border:1px solid var(--bd);align-self:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:var(--surf)"><div style="font-size:40px;line-height:1">❌</div><div style="font-size:var(--fs-sm);color:var(--muted)">${t("preview.noPackPng")}</div></div>`}
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    ${desc ? `<div style="color:var(--muted);line-height:1.6">${desc}</div>` : ""}
    <div style="color:var(--muted);font-size:var(--fs-xs)">pack_format: ${rv.format}${rv.version ? "（" + rv.version + "）" : ""}</div>
  </div>
</div>
<button class="preview-fab" id="btn-pack-model-3d" title="${t("preview.blockItemModel3d")}" aria-label="${t("preview.blockItemModel3d")}"><span class="preview-ic">&#x1F3D7;&#xFE0F;</span></button>`;
    const fab = ctx.root.querySelector("#btn-pack-model-3d") as HTMLButtonElement;
    if (fab) {
      promoteTitleIfPresent(fab);
      fab.onclick = (): void => { createPack3D(path).catch((e) => console.warn("[preview] pack3D:", e)); };
    }
  } catch (e) {
    if (detailGen.stale(gen)) return;
    ctx.root.innerHTML = `<div class="content" id="preview-content"><h3>🎨 ${t("preview.resourcePack")}</h3><div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">${t("preview.readFailed")}: ${esc(safeErrorMessage(e))}</div></div></div>`;
  }
}

/** 显示简单类型预览（仅图标 + 名称），用于光影包/蓝图/MMD/VRChat 等 */
export async function showSimplePreview(
  ctx: PreviewCtx,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  detailGen.invalidate(); // 无 await 也要作废在途的慢请求回写
  const icon = (opts && opts.icon) || "☀️";
  const label = (opts && opts.label) || t("preview.shaderPack");
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
  </div>
</div>`;
}

/** 显示光影包详情（lang/en_US.lang 提取显示名 + 配置项简介），对齐资源管理器渲染口径 */
export async function showShaderpack(
  ctx: PreviewCtx,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  const gen = detailGen.next();
  const icon = (opts && opts.icon) || "☀️";
  const label = (opts && opts.label) || t("preview.shaderPack");
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">${t("preview.parsing")}...</div></div>
</div>`;
  try {
    const { ReadShaderpackLang } = await getApp();
    const jsonStr = await ReadShaderpackLang(path);
    if (detailGen.stale(gen)) return; // 过期守卫：await 期间用户已切走
    const spMeta = JSON.parse(jsonStr || "{}") as { name?: string; entries?: Record<string, string> };
    const displayName = spMeta.name || basename;
    const entries = spMeta.entries || {};
    // 取前几条 option 描述作为简介（与 app-resource-manager 同口径，去 § 格式码）
    const descs = Object.entries(entries)
      .filter(([k]) => k.includes(".comment"))
      .slice(0, 3)
      .map(([, v]) => v.replace(/§[0-9a-fklmnor]/g, ""))
      .filter(Boolean);
    const desc = descs.length
      ? descs.join("\n")
      : `📦 光影包 (${Object.keys(entries).length} 项配置)`;
    ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(displayName)}</strong></div>
    <div style="color:var(--muted);line-height:1.6;white-space:pre-wrap">${esc(desc)}</div>
  </div>
</div>`;
  } catch (e) {
    if (detailGen.stale(gen)) return;
    ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div class="dp-placeholder"><div class="big-icon">⚠️</div><div class="dp-hint">${t("preview.readFailed")}: ${esc(safeErrorMessage(e))}</div></div>
</div>`;
  }
}
// ADR-072 D3：showVrmMeta / showMmdPreview 已拆至 detail-3d.ts（3D 入口与 2D 详情分离）
