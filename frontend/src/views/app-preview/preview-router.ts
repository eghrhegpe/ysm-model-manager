// ===== 预览路由分发 =====
// 从 index.ts 拆分：_showModelDetail / _showPackInfo / _typeMeta 独立为纯函数。
// 通过 PreviewRouterCtx 最小面接入，避免循环依赖（不 import index.ts）。
// code_review 4c485675e #1（P3）：路由函数首参为 PreviewCtx & PreviewRouterCtx——
// PREVIEW_HANDLERS 的 show 签名要求完整 PreviewCtx，用 `as unknown as` 双重断言
// 会绕过编译期契约校验（最小面 mock 编译过、运行时缺成员才崩）；收紧后编译器
// 重新校验完整契约，AppPreview 同时实现两者、调用方无需任何 cast。

import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc } from "@/utils/html/html.ts";
import { extOf, RESOURCE_TYPES, resolvePreviewKey } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { showSimplePreview } from "./detail.ts";
import { PREVIEW_HANDLERS } from "./preview-registry.ts";
import type { PreviewCtx, PreviewRouterCtx } from "./utils.ts";

/**
 * 模型预览路由：类型检测 → 注册表查表 → 派发 show 函数。
 * 原 _showModelDetail 逻辑，第一个参数改为 PreviewRouterCtx（无 this 耦合）。
 */
export async function routeModelPreview(
  ctx: PreviewCtx & PreviewRouterCtx,
  path: string,
  rtypeHint?: string,
): Promise<void> {
  const gen = ctx.previewGuard.current;

  // ADR-071 M1：web 端 .7z 明确"暂不支持"
  if (extOf(path) === ".7z" && isWebPlatform()) {
    bus.emit("toast:show", {
      msg: t("preview.web7zUnsupported"),
      duration: TOAST_MS.normal,
      type: "warn",
    });
    showSimplePreview(ctx, path, routeTypeMeta(ctx, RESOURCE_TYPES.YSM));
    return;
  }

  // 检测文件类型——发射点已分类时优先用 rtypeHint
  let rtype = rtypeHint || "";
  if (!rtype) {
    try {
      const { DetectResourceType } = await backendGetApp();
      rtype = (await DetectResourceType(path)) || "";
    } catch (e) {
      logWarn("preview", "DetectResourceType 失败", e);
    }
  }

  // 过期守卫：await 期间用户已点其他文件，丢弃本次分流
  if (ctx.previewGuard.stale(gen)) return;

  // 识别不出类型 → toast 提示 + 简单预览
  if (!rtype) {
    bus.emit("toast:show", {
      msg: t("preview.unrecognizedType"),
      duration: TOAST_MS.normal,
      type: "warn",
    });
    showSimplePreview(ctx, path, {
      icon: "❓",
      label: t("preview.unrecognizedType"),
    });
    return;
  }

  // ADR-111 变体收口：先按 variants preview key 查复合 key，再回退 rtype 自身
  const previewKey = resolvePreviewKey(path, rtype);
  const handler = PREVIEW_HANDLERS[`${rtype}:${previewKey}`] ?? PREVIEW_HANDLERS[rtype];
  if (handler) {
    handler(ctx, path, routeTypeMeta(ctx, rtype));
  } else {
    showSimplePreview(ctx, path, routeTypeMeta(ctx, rtype));
  }
}

/**
 * 资源包详情路由：直连 GetPackInfo，渲染 pack.mcmeta + pack.png。
 * 原 _showPackInfo 逻辑，第一个参数改为 PreviewRouterCtx。
 */
export async function routePackInfo(
  ctx: PreviewCtx & PreviewRouterCtx,
  dirPath: string,
): Promise<void> {
  const gen = ctx.previewGuard.current;
  ctx.root.innerHTML = `<div class="content" id="preview-content"><h3>📦 ${t("preview.pack")}</h3><div class="dp-placeholder"><div class="big-icon">⏳</div></div></div>`;

  try {
    const { GetPackInfo } = await backendGetApp();
    const pack = await GetPackInfo(dirPath);
    // 过期守卫：await 期间用户已点其他文件，丢弃本次渲染
    if (ctx.previewGuard.stale(gen)) return;

    if (!pack || (!pack.name && !pack.description)) {
      const folderName = dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
      ctx.root.innerHTML = `<div class="content" id="preview-content"><h3>📁 ${t("preview.folder")}</h3><div class="model-detail-title" style="font-size:13px;font-weight:600">${esc(folderName)}</div><div class="dp-placeholder" style="padding:12px 0"><div class="dp-hint">${t("preview.folderNoInfo")}</div></div></div>`;
      return;
    }

    ctx.root.innerHTML = `<div class="content" id="preview-content">
<h3>📦 ${t("preview.pack")}</h3>
${pack.imageBase64 ? `<div class="preview-thumb"><img src="${esc(pack.imageBase64)}" alt="封面"></div>` : ""}
<div class="model-detail-title" style="font-size:14px;font-weight:700">${esc(pack.name || "")}</div>
${pack.description ? `<div style="font-size:11px;color:var(--txt);margin-top:6px;line-height:1.6">${esc(pack.description)}</div>` : ""}
</div>`;
  } catch {
    // P2 修复：catch 分支同样比对代际
    if (ctx.previewGuard.stale(gen)) return;
    ctx.root.innerHTML = `<div class="content" id="preview-content"><h3>📁 ${t("preview.folder")}</h3><div class="dp-placeholder"><div class="big-icon">📁</div><div class="dp-hint">${t("preview.packReadFailed")}</div></div></div>`;
  }
}

/**
 * 类型元数据查找：从 ctx.typeCache 构建注册表，返回 { icon, label }。
 * 原 _typeMeta 逻辑，改为纯函数（无 this._typeReg 状态缓存）。
 */
export function routeTypeMeta(
  ctx: PreviewRouterCtx,
  rtype: string,
): { icon: string; label: string } {
  const reg: Record<string, { id: string; name?: string; icon?: string }> = {};
  for (const item of ctx.typeCache || []) {
    reg[item.id] = item;
  }
  const def = reg[rtype];
  return { icon: def?.icon || "📦", label: def?.name || rtype };
}
