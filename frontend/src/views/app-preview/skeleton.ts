// ===== 2D 骨骼渲染层 =====
// 加载统一走 loadModelData，本文件只做 2D 骨骼渲染编排

import { t } from "@/core/i18n/t.ts";
import type { BedrockGeometry } from "@/preview-3d/decoder/geometry.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { safeSet } from "@/utils/base/primitives/storage.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { renderModel2D } from "@/views/app-preview/model2d/model2d.ts";
import { fillAuthorsAsync, loadModelData } from "./loader.ts";
import {
  buildBoneExportRow,
  buildStatsCard,
  buildToggleRow,
  setup2DCanvas,
} from "./skeleton-render.ts";
import type { Prefer3DState, PreviewDebugger, PreviewRoot, YsmDecoder } from "./utils.ts";
import { openFullPreview } from "./zoom.ts";

// 2D 拖拽的 window 监听器使用 AbortController 管理，避免模块级单例竞态（审核 P3）
// ⚠️ 原模块级 _prevAbort 已迁移至组件实例 ctx.dragAbortCtrl（P3 修复）
// ⚠️ 原模块级 _active3DClose 已迁移至组件实例 ctx.active3DClose（P1 修复，同款模式）

/**
 * 关闭当前活跃的 3D 全屏 overlay（若存在）。供 app-preview/index.ts 切换模型前调用。
 * 状态挂组件实例 ctx（原模块级单例迁移，P1 修复）：overlay 挂 document.body 的语义不变，
 * 但关闭钩子归实例持有——多实例场景互不串扰（对齐 ctx.dragAbortCtrl 的 P3 模式）。
 */
export function closeActive3DOverlay(ctx: PreviewRoot): void {
  ctx.active3DClose?.();
  ctx.active3DClose = null;
}

/** 设置当前活跃的 3D 全屏 overlay 关闭函数（maid/通用 Bedrock 模型复用此机制）。 */
export function setActive3DClose(ctx: PreviewRoot, fn: (() => void) | null): void {
  ctx.active3DClose = fn;
}

/** 加载模型 2D 骨骼线条图（+ 可选统计卡容器：传入则统计卡渲染到该容器，骨架区只留图） */
export async function loadModel2D(
  ctx: PreviewRoot & YsmDecoder & PreviewDebugger & Prefer3DState,
  modelPath: string,
  skelContainer: HTMLElement | null,
  statsContainer?: HTMLElement | null,
): Promise<void> {
  const content = skelContainer || ctx.root.getElementById("preview-content");
  if (!content) return;
  content.innerHTML = "";
  const container = document.createElement("div");
  container.className = "sk-loading-box"; // 规则在 css.ts previewCSS(shadow adopted);加载完成运行时 opacity=1 内联覆盖类
  container.innerHTML = `<div class="pv-loading-title">${UI_ICONS.build} ${t("preview.loadingStructure")}</div><div class="pv-loading-bar"></div>`;
  content.appendChild(container);

  // ADR-253 D7：详情卡 3D 入口 FAB（#btn-3d-preview）已删除，3D 统一从左下角 nav-fab
  // 进入（openModel3DFullscreen → openYsmFullscreen）。此处原有的 _toggle3D /
  // _prefer3D 自动弹 / FAB 绑定整块随之退役——nav-fab 的 YSM opener 自带
  // loader 与 android-back 注册（见 ysm-3d.ts openYsmFullscreen）。

  try {
    const model = await loadModelData(modelPath, {
      decodeYsmViaWasm: (p) => ctx.decodeYsmViaWasm(p),
      appendDebug: (_c, msg) => ctx.appendDebug(container, msg),
    });
    if (!container.isConnected) return;
    if (!model?.bones?.length) {
      container.innerHTML = `<div class="pv-error-title">${UI_ICONS.build} ${t("preview.skeletonStructure")}</div><div class="pv-error-body">${UI_ICONS.warning} ${t("preview.noGeometry")}</div>`;
      return;
    }
    container.style.opacity = "1";
    let hoverCleanup: (() => void) | null = null;
    container.innerHTML = "";
    const { canvas, textureImg } = await setup2DCanvas(container, model);
    if (!container.isConnected) return;
    const { eyeBtn, getLabelsOn, setLabelsOn } = buildToggleRow(container);
    const zoomBtn = document.createElement("button");
    zoomBtn.className = "pv-btn";
    zoomBtn.innerHTML = `${UI_ICONS.search} ${t("preview.zoom")}`;
    zoomBtn.title = t("preview.hint.fullWindow");
    zoomBtn.onclick = (): void => {
      openFullPreview(canvas, model, textureImg, getLabelsOn());
    };
    container.querySelector<HTMLElement>(".pv-toggle-row")?.appendChild(zoomBtn);
    let _zoom = 1,
      _rotation = 0;
    const model2d = model as Parameters<typeof renderModel2D>[1];
    const doRender = (): void => {
      try {
        hoverCleanup?.();
        hoverCleanup = renderModel2D(canvas, model2d, textureImg, {
          showLabels: getLabelsOn(),
          zoom: _zoom,
          rotation: _rotation,
        });
      } catch (e) {
        logWarn("preview", "2D 渲染跳过", e);
      }
    };
    doRender();
    eyeBtn.onclick = (): void => {
      const next = !getLabelsOn();
      setLabelsOn(next);
      safeSet("ysm_showBoneLabels", String(next));
      doRender();
    };
    canvas.classList.add("pv-grab");
    canvas.title = t("preview.hint.zoomControls");
    let _dragging = false,
      _dragged = false,
      _lastX = 0;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      _dragging = true;
      _dragged = false;
      _lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    // 取消上一轮的 window 监听器（AbortController 一次性清除所有，无竞态风险）
    // P3 修复：使用组件实例的 dragAbortCtrl 而非模块级单例
    ctx.dragAbortCtrl?.abort();
    const ac = new AbortController();
    ctx.dragAbortCtrl = ac;
    const opts = { signal: ac.signal };
    const onWindowMove = (e: PointerEvent): void => {
      if (!_dragging) return;
      const dx = e.clientX - _lastX;
      if (Math.abs(dx) > 3) _dragged = true;
      _lastX = e.clientX;
      _rotation = (_rotation + dx * 0.5) % 360;
      doRender();
    };
    const onWindowUp = (e: PointerEvent): void => {
      _dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    window.addEventListener("pointermove", onWindowMove, opts);
    window.addEventListener("pointerup", onWindowUp, opts);
    ctx.unsubs?.push(() => {
      ac.abort();
      if (ctx.dragAbortCtrl === ac) ctx.dragAbortCtrl = null;
    });
    canvas.addEventListener("click", (e) => {
      if (_dragged) {
        e.stopPropagation();
        return;
      }
      openFullPreview(canvas, model, textureImg, getLabelsOn());
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        _zoom = Math.max(0.2, Math.min(10, _zoom * Math.exp(-e.deltaY * 0.002)));
        doRender();
      },
      { passive: false },
    );
    // 作者/头像延迟补全（首帧已渲染，await 不阻塞用户看到模型）
    if (model) await fillAuthorsAsync(modelPath, model);
    // 统计卡（彩色分区 + 头像作者）渲染目标：详情卡传入 statsContainer 时挂详情卡
    // （方案 A：详情卡吸收设计），否则保持原状挂骨架区（兼容既有调用/测试）
    if (statsContainer) {
      await buildStatsCard(statsContainer, model, modelPath, ctx);
    } else {
      await buildStatsCard(container, model, modelPath, ctx);
    }
    buildBoneExportRow(
      container,
      model as BedrockGeometry & {
        boneCount?: number;
        bones?: Array<{ id: string; name: string; parentId?: string }>;
      },
      modelPath,
    );
  } catch (e) {
    container.innerHTML = `<div class="pv-error-title" style="color:var(--status-error)">${UI_ICONS.build} ${t("preview.skeletonStructure")}</div><div class="pv-error-body">${UI_ICONS.warning} ${t("preview.parseFailed")}: ${esc(safeErrorMessage(e))}</div>`;
  }
}
