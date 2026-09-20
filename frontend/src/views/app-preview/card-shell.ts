// ===== 统一详情卡渲染壳（ADR-253 D4 抽出为叶子模块）=====
// 原为 detail-3d.ts 私有 showCard：六个 3D 入口卡共享同一模板。
// ADR-253 D4 起 2D 详情（showResourcePack 等）也收编到同一壳，为避免
// 「detail.ts（2D）反向依赖 detail-3d.ts（3D 入口）」的语义倒挂，抽成本叶子模块：
// 双方都依赖它，它不依赖任何 show 函数。
//
// 模板：invalidate → innerHTML 骨架 → getApp → fetch → stale 检查
// → innerHTML 内容 → querySelector → wire FAB。差异封装在 CardShowConfig 中。
// 卡片上的类型徽章一律取 RESOURCE_TYPES.*（= resource_types.json 的 type id，单一事实源），
// 不走 i18n：type id 是技术标识，翻进语言包会 fork 出第二事实源（违反 ADR-116 前端只读不判）。

import { t } from "@/core/i18n/t.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { esc } from "@/utils/html/html.ts";
import { renderIconHtml } from "@/utils/icon/resolve.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { type AppBindings, backendGetApp } from "@/views/backend-deps.ts";
import type { DetailGenGuard, PreviewCtx } from "./utils.ts";

export interface CardShowConfig {
  icon: string;
  label: string;
  /** 可选 meta 获取（VRM / 资源包使用；其他类型直接渲染，无加载态） */
  fetchMeta?: (
    ctx: PreviewCtx & DetailGenGuard,
    path: string,
    app: AppBindings,
  ) => Promise<unknown>;
  /** 渲染卡片 HTML（fetchMeta 有值时传解析结果，无值时传 null） */
  renderCard: (ctx: PreviewCtx & DetailGenGuard, path: string, meta: unknown) => string;
  /** 绑定 FAB 按钮事件（fab 由 `[data-fab]` 查得，故卡内 FAB 必须带 data-fab） */
  wireFab: (ctx: PreviewCtx & DetailGenGuard, path: string, fab: HTMLElement | null) => void;
  /** 可选后置异步渲染（PMX 统计 / 兄弟列表 / 舞台内容 / 资源包模型清单） */
  postRender?: (ctx: PreviewCtx & DetailGenGuard, path: string, gen: number) => void;
}

export async function showCard(
  ctx: PreviewCtx & DetailGenGuard,
  path: string,
  config: CardShowConfig,
): Promise<void> {
  ctx.detailGen.invalidate();
  const gen = ctx.detailGen.next();

  // 无 fetchMeta：直接渲染，无加载态，无错误处理
  if (!config.fetchMeta) {
    ctx.root.innerHTML = config.renderCard(ctx, path, null);
    const fab = ctx.root.querySelector<HTMLElement>("[data-fab]");
    config.wireFab(ctx, path, fab);
    config.postRender?.(ctx, path, gen);
    return;
  }

  // 有 fetchMeta：加载态 → 获取 → 渲染
  ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${renderIconHtml(config.icon)} ${esc(config.label)}</h3>
  <div class="dp-placeholder"><div class="big-icon">${UI_ICONS.refresh}</div><div class="dp-hint">${t("preview.parsing")}...</div></div>
</div>`;

  try {
    const App = await backendGetApp();
    const meta = await config.fetchMeta(ctx, path, App);
    if (ctx.detailGen.stale(gen)) return;
    ctx.root.innerHTML = config.renderCard(ctx, path, meta);
    const fab = ctx.root.querySelector<HTMLElement>("[data-fab]");
    config.wireFab(ctx, path, fab);
    config.postRender?.(ctx, path, gen);
  } catch (e) {
    if (ctx.detailGen.stale(gen)) return;
    ctx.root.innerHTML = `<div class="content" id="preview-content">
  <h3>${renderIconHtml(config.icon)} ${esc(config.label)}</h3>
  <div class="dp-placeholder"><div class="big-icon">${UI_ICONS.warning}</div><div class="dp-hint">${t("preview.readFailed")}: ${esc(safeErrorMessage(e))}</div></div>
</div>`;
  }
}
