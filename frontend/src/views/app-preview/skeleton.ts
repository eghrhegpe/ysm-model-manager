// ===== 2D 骨骼渲染层 =====
// 加载统一走 loadModelData，本文件只做 2D 骨骼渲染编排
import { getPrefer3D, setPrefer3D, type PreviewRoot, type YsmDecoder, type PreviewDebugger } from "./utils.ts";
import { loadModelData, fillAuthorsAsync } from "./loader.ts";
import { renderModel2D } from "../../features/preview-3d/model2d.ts";
import { openFullPreview } from "./zoom.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import type { BedrockGeometry } from "../../features/preview-3d/decoder/geometry.ts";
import { esc } from "../../utils/dom/html.ts";
import { promoteTitleIfPresent } from "../../utils/dom/tooltip.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { registerAndroidBackHandler } from "../../utils/dom/android-bridge.ts";
import { t } from "../../core/i18n/t.ts";
import { sec, iRow } from "./skeleton-utils.ts";
import {
  setup2DCanvas, buildToggleRow, buildStatsCard, buildBoneExportRow,
} from "./skeleton-render.ts";
import { createYsm3D, cleanupYsm3D } from "./ysm-3d.ts";
import { GenGuard } from "./gen-guard.ts";

// 2D 拖拽的 window 监听器使用 AbortController 管理，避免模块级单例竞态（审核 P3）
let _prevAbort: AbortController | null = null;

/**
 * P2 修复（审核）：3D overlay 挂 document.body，不随预览面板 shadow DOM 重建消失。
 * 后台 model:select（导入队列/回收站自动选择）在 3D 打开期间触发时，若只叠新 overlay
 * 不清旧的全屏层，会造成双全屏叠加 + 旧 renderer 死屏残留。此模块级钩子让调用方
 * （app-preview/index.ts 的 model:select handler）在切换模型前先关掉活跃 3D。
 * 注意：关闭时保留 _prefer3D（切模型保持 3D 预览），仅清理 DOM 与 WebGL 资源。
 */
let _active3DClose: (() => void) | null = null;

/** 关闭当前活跃的 3D 全屏 overlay（若存在）。供 app-preview/index.ts 切换模型前调用。 */
export function closeActive3DOverlay(): void {
  _active3DClose?.();
  _active3DClose = null;
}

/** 设置当前活跃的 3D 全屏 overlay 关闭函数（maid/通用 Bedrock 模型复用此机制）。 */
export function setActive3DClose(fn: (() => void) | null): void {
  _active3DClose = fn;
}

/** 连点/多菜单触发时忽略并发（防重复保存文件） */
function makeShotGuard(shotBtn: HTMLElement): {
  saving: boolean; setSaving: (v: boolean) => void; setIcon: (icon: string) => void;
} {
  let _saving = false;
  const setIcon = (icon: string): void => {
    const ic = shotBtn.querySelector<HTMLElement>(".preview-ic");
    if (ic) ic.textContent = icon;
  };
  return { get saving() { return _saving; }, setSaving: (v: boolean) => { _saving = v; }, setIcon };
}

/** 加载模型 2D 骨骼线条图（+ 可选统计卡容器：传入则统计卡渲染到该容器，骨架区只留图） */
export async function loadModel2D(
  ctx: PreviewRoot & YsmDecoder & PreviewDebugger,
  modelPath: string,
  skelContainer: HTMLElement | null,
  statsContainer?: HTMLElement | null,
): Promise<void> {
  const content = skelContainer || ctx.root.getElementById("preview-content");
  if (!content) return;
  content.innerHTML = "";
  const container = document.createElement("div");
  container.style.cssText = "margin-bottom:8px;opacity:0.6";
  container.innerHTML = `<div class="pv-loading-title">🏗️ ${t("preview.loadingStructure")}</div><div class="pv-loading-bar"></div>`;
  content.appendChild(container);
  try {
    const loaded = await loadModelData(modelPath, {
      decodeYsmViaWasm: (p) => ctx.decodeYsmViaWasm(p),
      appendDebug: (_c, msg) => ctx.appendDebug(container, msg),
    });
    const model = loaded.model;
    const _decodedBy = loaded.decodedBy;
    if (!container.isConnected) return;
    if (!model?.bones?.length) {
      container.innerHTML = `<div class="pv-error-title">🏗️ ${t("preview.skeletonStructure")}</div><div class="pv-error-body">⚠️ ${t("preview.noGeometry")}</div>`;
      return;
    }
    container.style.opacity = "1";
    container.innerHTML = "";
    const { canvas, textureImg } = await setup2DCanvas(container, model);
    if (!container.isConnected) return;
    const { eyeBtn, eyeHint, getLabelsOn, setLabelsOn } = buildToggleRow(container);
    const zoomBtn = document.createElement("button");
    zoomBtn.className = "pv-btn";
    zoomBtn.innerHTML = "🔍 " + t("preview.zoom");
    zoomBtn.title = "全窗口查看模型";
    zoomBtn.onclick = (): void => { openFullPreview(canvas, model, textureImg, getLabelsOn()); };
    container.querySelector<HTMLElement>(".pv-toggle-row")!.appendChild(zoomBtn);
    let _zoom = 1, _rotation = 0;
    const model2d = model as Parameters<typeof renderModel2D>[1];
    const doRender = (): void => {
      try { renderModel2D(canvas, model2d, textureImg, { showLabels: getLabelsOn(), zoom: _zoom, rotation: _rotation }); }
      catch (e) { console.warn("[preview] 2D 渲染跳过:", e); }
    };
    doRender();
    eyeBtn.onclick = (): void => { const next = !getLabelsOn(); setLabelsOn(next); safeSet("ysm_showBoneLabels", String(next)); doRender(); };
    canvas.classList.add("pv-grab");
    canvas.title = "左键全窗放大 · 滚轮缩放 · 左右拖拽旋转";
    let _dragging = false, _dragged = false, _lastX = 0;
    canvas.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; _dragging = true; _dragged = false; _lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    // 取消上一轮的 window 监听器（AbortController 一次性清除所有，无竞态风险）
    _prevAbort?.abort();
    const ac = new AbortController();
    _prevAbort = ac;
    const opts = { signal: ac.signal };
    const onWindowMove = (e: PointerEvent): void => { if (!_dragging) return; const dx = e.clientX - _lastX; if (Math.abs(dx) > 3) _dragged = true; _lastX = e.clientX; _rotation = (_rotation + dx * 0.5) % 360; doRender(); };
    const onWindowUp = (e: PointerEvent): void => { _dragging = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };
    window.addEventListener("pointermove", onWindowMove, opts);
    window.addEventListener("pointerup", onWindowUp, opts);
    ctx.unsubs?.push(() => { ac.abort(); if (_prevAbort === ac) _prevAbort = null; });
    canvas.addEventListener("click", (e) => { if (_dragged) { e.stopPropagation(); return; } openFullPreview(canvas, model, textureImg, getLabelsOn()); });
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); _zoom = Math.max(0.2, Math.min(10, _zoom * Math.exp(-e.deltaY * 0.002))); doRender(); }, { passive: false });
    // 作者/头像延迟补全（首帧已渲染，await 不阻塞用户看到模型）
    if (model) await fillAuthorsAsync(modelPath, model);
    // 统计卡（彩色分区 + 头像作者）渲染目标：详情卡传入 statsContainer 时挂详情卡
    // （方案 A：详情卡吸收设计），否则保持原状挂骨架区（兼容既有调用/测试）
    if (statsContainer) {
      await buildStatsCard(statsContainer, model, modelPath, _decodedBy, ctx);
    } else {
      await buildStatsCard(container, model, modelPath, _decodedBy, ctx);
    }
    buildBoneExportRow(container, model as BedrockGeometry & { boneCount?: number; bones?: Array<{ id: string; name: string; parentId?: string }> }, modelPath);
    let _is3D = false, _prefer3D = getPrefer3D(), _loading3D = false;
    const model3dGuard = new GenGuard();
    const _toggle3D = async (): Promise<void> => {
      if (_loading3D) return;
      _is3D = !_is3D; _prefer3D = _is3D; setPrefer3D(_prefer3D);
      if (!_is3D) return;
      _loading3D = true;
      const gen = model3dGuard.next();
      let unsubAndroidBack: (() => void) | null = null;
      // 关闭当前 3D 会话：core 经 adapter.onClose 复位 _is3D/_active3DClose/android-back，
      // 这里额外处理 ctx.unsubs 注销。
      const close3D = (keepPrefer = false): void => {
        const idx = ctx.unsubs?.indexOf(close3D);
        if (idx !== undefined && idx > -1) ctx.unsubs?.splice(idx, 1);
        cleanupYsm3D();
        model3dGuard.invalidate();
        _is3D = false;
        if (!keepPrefer) {
          _prefer3D = false;
          setPrefer3D(false);
        }
      };
      // core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时复位骨架层状态 + 注销 android-back。
      // 区分用户主动关闭与切模型自动关层：切模型路径（closeActive3DOverlay）会先置
      // _active3DClose = null，onClose 据此判断——用户主动关闭（ESC/✕/返回键）清 _prefer3D，
      // 切模型保留（ADR-057 §2.5 + 知识卡口径：用户主动关闭才清偏好；P3 误改统一保留，
      // 导致退出 3D 后点资源仍自动弹全屏）。
      const onClose = (): void => {
        const userClosed = _active3DClose !== null;
        _is3D = false;
        _active3DClose = null;
        if (userClosed) {
          _prefer3D = false;
          setPrefer3D(false);
        }
        if (unsubAndroidBack) {
          unsubAndroidBack();
          unsubAndroidBack = null;
        }
      };
      ctx.unsubs?.push(close3D);
      _active3DClose = () => close3D(true);
      // P2 修复（TS 深层扫描延续）：android-back 注册须保存 unsub 并在关闭时注销，
      // 否则反复开关 3D 向返回键栈 push 恒 return true 的 handler 且永不注销。
      unsubAndroidBack = registerAndroidBackHandler(() => {
        close3D();
        return true;
      });
      try {
        // path 驱动（§5.7）：注入预览面板数据加载链，switchTo(path) 对 ysm 生效
        await createYsm3D(modelPath, 0, {
          onClose,
          loader: async (p: string) => (await loadModelData(p, ctx)).model,
        });
      } catch (e) {
        _loading3D = false;
        // P2 修复：用户已关闭 3D（ESC/切模型）后迟到的加载失败不得再弹错——
        // 否则关闭后 1~2s 突然冒「加载失败」toast，掩盖用户主动关闭的意图。
        if (model3dGuard.stale(gen)) return;
        // 3D 渲染错误已由 core 统一 toast（t("preview.loadFailed")），此处仅防御性日志
        console.error("[3D] 加载失败（core 已处理提示）:", e);
      }
      _loading3D = false;
    };
    const btn3d = ctx.root.getElementById("btn-3d-preview");
    if (btn3d) {
      promoteTitleIfPresent(btn3d);
      btn3d.onclick = (): void => { _toggle3D(); };
    }
    if (_prefer3D) requestAnimationFrame(() => btn3d?.click());
  } catch (e) { container.innerHTML = `<div class="pv-error-title" style="color:#ff6b6b">🏗️ ${t("preview.skeletonStructure")}</div><div class="pv-error-body">⚠️ ${t("preview.parseFailed")}: ${esc(safeErrorMessage(e))}</div>`; }
}