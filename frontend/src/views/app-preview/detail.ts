// ===== 模型/资源包详情面板 =====
// 从 index.ts 拆分：详情面板渲染逻辑。
// ADR-072 D3：3D 入口（showVrmMeta/showMmdPreview）已拆至 detail-3d.ts，
// 本文件保留 2D 详情（showModelDetail/showResourcePack/showSimplePreview/showShaderpack）。
// detailGen 已迁至 AppPreview 实例（多实例隔离防串扰，快速切换时各实例在途请求互不影响）。

import { t } from "@/core/i18n/t.ts";
import { cacheGet, cacheSet } from "@/preview-3d/decoder/model-cache.ts";
import { decodeYsmViaWasm } from "@/preview-3d/decoder/wasm-decode.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { promoteTitleIfPresent } from "@/utils/dom/tooltip.ts";
import { describeVersionRange } from "@/utils/format/pack-format.ts";
import { esc } from "@/utils/html/html.ts";
import { renderFormattedText } from "@/utils/html/mc-format.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { type AppBindings, backendGetApp } from "@/views/backend-deps.ts";
import { showCard } from "./card-shell.ts";
import { createPack3D } from "./pack-3d.ts";
import { openModel3DFullscreen } from "./preview-library.ts";
import { loadModel2D } from "./skeleton.ts";
import { summaryCardHTML, type YsmSummary } from "./tpl-summary.ts";
import type { DetailGenGuard, PreviewCtx } from "./utils.ts";

/** 显示模型详情（YSM 模型） */
export async function showModelDetail(
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
): Promise<void> {
  const gen = ctx.detailGen.next();
  const savedTab = safeGet("ysm_previewTab") || "detail";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <div class="pv-tab-row">
    <button class="pv-tab ${savedTab === "detail" ? "pv-tab-active" : "pv-tab-inactive"}" data-tab="detail">${UI_ICONS.file} ${t("preview.detailTab")}</button>
    <button class="pv-tab ${savedTab === "skeleton" ? "pv-tab-active" : "pv-tab-inactive"}" data-tab="skeleton">${UI_ICONS.build} ${t("preview.tab.skeleton")}</button>
  </div>
  <div id="preview-detail"${savedTab !== "detail" ? ' style="display:none"' : ""}><h3>${UI_ICONS.file} ${t("preview.modelInfo")}</h3><div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">${t("preview.parsing")}...</div></div></div>
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
  if (ctx.detailGen.stale(gen)) return; // 用户已切换到其他预览

  try {
    const { ExtractYsmSummary, ExtractYSMHeader } = await backendGetApp();
    const results = await Promise.allSettled([ExtractYsmSummary(path), ExtractYSMHeader(path)]);
    if (ctx.detailGen.stale(gen)) return; // 解析期间用户已切换
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
      if (ctx.detailGen.stale(gen)) return;
      const decHasInfo = !!(
        dec?.animGroups?.length ||
        dec?.configMenus?.length ||
        dec?.authors?.length
      );
      if (decHasInfo) {
        // 写入缓存，供详情卡 decodedBy 徽标展示（与 loadModelData → skeleton.ts 的缓存写入路径对齐）
        const existing = cacheGet(path) || {};
        cacheSet(path, { ...existing, _decodedBy: "🧠 WASM 内置解码" });
        enriched = {
          name: header?.name || summary?.name || basename.replace(/\.[^.]+$/, ""),
          authors: (dec.authors || []).map((a) => ({
            name: a.name,
            ...(a.role != null ? { roles: a.role } : {}),
          })),
          animGroups: dec.animGroups || null,
          configMenus: dec.configMenus || null,
          ...(header?.tips ? { tips: header.tips } : {}),
          ...(header?.license ? { license: header.license } : {}),
          ...(header?.linkHome ? { links: { home: header.linkHome } } : {}),
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
    statsDiv.className = "dp-stats"; // 规则在 css.ts previewCSS(shadow adopted)
    detailDiv?.appendChild(statsDiv);

    // 加载 2D 模型预览（骨架 tab 只留骨骼线条图；统计卡经 statsContainer 挂详情卡）
    // 进详情本身即触发 loadModel2D 异步解码，统计卡数据（骨骼/立方体/纹理/头像）无需额外请求
    loadModel2D(ctx, path, ctx.root.getElementById("preview-skeleton"), statsDiv).catch((e) =>
      logWarn("preview", "loadModel2D 失败", e),
    );
  } catch (err) {
    if (ctx.detailGen.stale(gen)) return;
    const detailDiv = ctx.root.getElementById("preview-detail");
    if (detailDiv) {
      detailDiv.innerHTML = `${t("preview.unknownError")} ${t("preview.parseFailed")}: ${esc(friendlyError(err))}`;
    }
  }
}

/** 显示资源包信息（pack.mcmeta + pack.png + 模型清单）
 * ADR-253 D4：收编进统一卡片壳 showCard（消除最后一个手写详情壳）。
 * 附带修复：FAB 改由壳在渲染期同步绑定（原实现若 ReadPackMeta 抛错则 FAB 死点击）。 */
export async function showResourcePack(ctx: PreviewCtx, path: string): Promise<void> {
  return showCard(ctx, path, {
    icon: UI_ICONS.appearance,
    label: t("preview.resourcePack"),
    fetchMeta: async (_ctx, path, app) => {
      const meta = await app.ReadPackMeta(path);
      if (!meta) throw new Error("资源包信息为空");
      return meta;
    },
    renderCard: (_ctx, path, meta) => {
      const m = meta as NonNullable<Awaited<ReturnType<AppBindings["ReadPackMeta"]>>>;
      const basename = path.split(/[/\\]/).pop() || "";
      const desc = renderFormattedText(m.description || "");
      const rv = describeVersionRange(m);
      // ADR-131 P3：模型清单（path + 方块数，封顶 200，total 全量）——list 组件占位，
      // 数据经 ListPackModelsDetail 异步取（Go 绑定 / web-fs 镜像同构）
      return `<div class="content" id="preview-content">
  <h3>${UI_ICONS.appearance} ${t("preview.resourcePack")}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    ${m.thumbnail ? `<img src="${esc(m.thumbnail)}" alt="pack" style="width:128px;height:128px;object-fit:contain;border-radius:var(--radius-md);border:1px solid var(--bd);align-self:center;image-rendering:pixelated">` : `<div style="width:128px;height:128px;border-radius:var(--radius-md);border:1px solid var(--bd);align-self:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:var(--surf)"><div style="font-size:var(--fs-xl);line-height:1">${UI_ICONS.error}</div><div style="font-size:var(--fs-sm);color:var(--muted)">${t("preview.noPackPng")}</div></div>`}
    <div><strong>${renderFormattedText(basename || "")}</strong></div>
    ${desc ? `<div style="color:var(--muted);line-height:1.6">${desc}</div>` : ""}
    <div style="color:var(--muted);font-size:var(--fs-xs)">pack_format: ${rv.format}${rv.version ? `（${rv.version}）` : ""}</div>
    <div id="pack-model-list"></div>
  </div>
</div>
<button class="preview-fab" id="btn-pack-model-3d" data-fab title="${t("preview.blockItemModel3d")}" aria-label="${t("preview.blockItemModel3d")}"><span class="preview-ic">&#x1F3D7;&#xFE0F;</span></button>`;
    },
    wireFab: (ctx2, path2, fab) => {
      if (!fab) return;
      const cleanup = promoteTitleIfPresent(fab);
      if (cleanup && ctx2.unsubs) ctx2.unsubs.push(cleanup);
      fab.onclick = (): void => {
        createPack3D(path2).catch((e) => logWarn("preview", "pack3D 失败", e));
      };
    },
    // 模型清单区（异步取数，失败/无模型静默隐藏；详情卡降级约定）
    postRender: (ctx3, path3, gen) => {
      void renderPackModelListAsync(ctx3, gen, path3);
    },
  });
}

/** 取 App 后渲染资源包模型清单区（postRender 签名不传 App，此处自取——backendGetApp 为缓存访问器） */
async function renderPackModelListAsync(ctx: PreviewCtx, gen: number, path: string): Promise<void> {
  try {
    const App = await backendGetApp();
    await renderPackModelList(ctx, gen, App, path);
  } catch {
    /* 取 App 失败静默：基础卡不受影响（详情卡降级约定） */
  }
}

/** 渲染资源包模型清单区（ADR-131 P3）：ListPackModelsDetail → path + 方块数列表，点击直达 3D */
async function renderPackModelList(
  ctx: PreviewCtx,
  gen: number,
  App: Awaited<ReturnType<typeof backendGetApp>>,
  path: string,
): Promise<void> {
  try {
    const detail = await App.ListPackModelsDetail(path);
    if (ctx.detailGen.stale(gen)) return;
    const models = detail?.models ?? [];
    const host = ctx.root.querySelector<HTMLElement>("#pack-model-list");
    if (!host) return;
    if (models.length === 0) return; // 无模型 → 不渲染清单区（仅 FAB 3D 入口）
    const total = detail?.total ?? models.length;
    const overflow =
      total > models.length
        ? `<div style="color:var(--muted);font-size:var(--fs-xs);margin-top:4px">${t("preview.modelListOverflow", { n: models.length })}</div>`
        : "";
    host.innerHTML = `<div style="border:1px solid var(--bd);border-radius:var(--radius-md);padding:6px;margin-top:4px">
  <div style="color:var(--muted);font-size:var(--fs-sm);margin-bottom:4px">${t("preview.modelList", { n: total })}</div>
  ${models
    .map((m) => {
      const name = m.path.split("/").pop() || m.path;
      return `<div class="pack-model-item" data-entry="${esc(m.path)}" style="display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:var(--radius-sm);font-size:var(--fs-base);cursor:pointer;border-left:3px solid color-mix(in srgb,var(--accent) 50%,transparent)">
      <span>${UI_ICONS.unknown}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
      <span style="color:var(--muted);font-size:var(--fs-xs);margin-left:auto;flex-shrink:0">${t("preview.modelCubes", { cubes: m.cubes })}</span>
    </div>`;
    })
    .join("")}
  ${overflow}
</div>`;
    // 点击单模型直达 3D（ADR-253 D6：经统一路由传 entry，由 pack opener
    // 映射为 createPack3D 的 startEntry——不再绕过路由直调包装器）
    host.querySelectorAll<HTMLElement>(".pack-model-item").forEach((el) => {
      el.onclick = (): void => {
        const entry = el.dataset.entry || "";
        if (!entry) return;
        openModel3DFullscreen(path, { entry }).catch((e) => logWarn("preview", "pack3D 失败", e));
      };
    });
  } catch {
    /* 清单读取失败静默：基础卡不受影响（详情卡降级约定） */
  }
}

/** 显示简单类型预览（仅图标 + 名称），用于光影包/蓝图/MMD/VRChat 等 */
export async function showSimplePreview(
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  ctx.detailGen.invalidate(); // 无 await 也要作废在途的慢请求回写
  const icon = opts?.icon || "☀️";
  const label = opts?.label || t("preview.shaderPack");
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
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
  opts?: { icon?: string; label?: string },
): Promise<void> {
  const gen = ctx.detailGen.next();
  const icon = opts?.icon || "☀️";
  const label = opts?.label || t("preview.shaderPack");
  const basename = path.split(/[/\\]/).pop() || "";
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div class="dp-placeholder"><div class="big-icon">⏳</div><div class="dp-hint">${t("preview.parsing")}...</div></div>
</div>`;
  try {
    const { ReadShaderpackLang } = await backendGetApp();
    const spMeta = await ReadShaderpackLang(path);
    if (ctx.detailGen.stale(gen)) return; // 过期守卫：await 期间用户已切走
    const displayName = spMeta?.name || basename;
    const entries = spMeta?.entries ?? {};
    // 取前几条 option 描述作为简介（与 app-resource-manager 同口径，去 § 格式码）
    const descs = Object.entries(entries)
      .filter(([k]) => k.includes(".comment"))
      .slice(0, 3)
      .map(([, v]) => (v ?? "").replace(/§[0-9a-fklmnor]/g, ""))
      .filter(Boolean);
    const desc = descs.length
      ? descs.join("\n")
      : `${UI_ICONS.package} 光影包 (${Object.keys(entries).length} 项配置)`;
    ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div style="padding:12px;display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm)">
    <div><strong>${renderFormattedText(displayName)}</strong></div>
    <div style="color:var(--muted);line-height:1.6;white-space:pre-wrap">${esc(desc)}</div>
  </div>
</div>`;
  } catch (e) {
    if (ctx.detailGen.stale(gen)) return;
    ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${icon} ${label}</h3>
  <div class="dp-placeholder"><div class="big-icon">${UI_ICONS.warning}</div><div class="dp-hint">${t("preview.readFailed")}: ${esc(safeErrorMessage(e))}</div></div>
</div>`;
  }
}
// ADR-072 D3：showVrmMeta / showMmdPreview 已拆至 detail-3d.ts（3D 入口与 2D 详情分离）
