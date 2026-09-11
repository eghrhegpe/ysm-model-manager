// ===== 预览外壳宿主（[ADR-227] P1 单例收敛：模块级 DOM 外壳单例 → 实例字段）=====
// 原 mount-preview-core 模块级可变外壳状态（_singletonOverlay/_singletonBody/
// _singletonViewContainer）与 mpc 静态样式注入旗标（_mpcStylesInjected）收敛为
// PreviewShellHost 实例字段——与兄弟会话 A1（_globalPause → createPerceptionPauseRef）、
// RendererHost（render-loop）、SceneInfraHost（shared-infra）同一战役、同一步伐。
//
// 设计边界：3D 预览为「同一时刻单一全屏 overlay」的模态体验（overlay 清理后 refs 归零，
// 下次 mount3D 重建），故外壳宿主为单例实例（previewShell）；状态均为实例字段，不再散落
// 模块级 let。mpc 静态样式随 host 管理（overlay 样式目标复位时旗标清零重注入）。
import {
  onOverlayStyleTargetReset,
  overlayStyleRoot,
} from "@/preview-3d/infra/overlay-style-bridge.ts";

// §1.5 P1 批次9:overlay 链静态 cssText 抽类集中注入(mount3D 内 ensureStyles 幂等调用)
// ADR-175 M1:overlay shadow host 化——内容迁入 shadowRoot 后 head 注入穿不透边界,
// 首条规则改 `:host` 承载宿主自身布局(降级 light DOM 路径由 .mpc-overlay 选择器兜底);
// 注入目标经 overlay-style-bridge 迁移(shadow root / 无 overlay 时 head 兜底)。
const mpcCss = `
:host, .mpc-overlay { position:fixed; inset:0; z-index:var(--z-fullscreen); background:#11111b; display:flex; flex-direction:column; }
.mpc-body { flex:1; display:flex; position:relative; overflow:hidden; }
.preview-view-container.mpc-view { flex:1; position:relative; overflow:hidden; }
.mpc-loading { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; color:rgba(255,255,255,0.6); font-size:14px; gap:12px; z-index:10; }
.mpc-tip { padding:5px 12px; background:#1b1c24; border-bottom:1px solid rgba(255,255,255,.08); color:rgba(255,255,255,.7); font-size:11px; text-align:center; flex-shrink:0; }
`;

/**
 * 预览外壳宿主：持有 overlay/body/viewContainer 复用引用 + mpc 样式注入旗标。
 * 外壳为「同一时刻单一全屏 overlay」设计——resetRefs() 归零后下次 mount3D 重建。
 */
export class PreviewShellHost {
  /** 模块级全局 overlay（仅 cleanupPreview 时才移除，多次 mount3D 复用同一 DOM） */
  overlay: HTMLElement | null = null;
  body: HTMLElement | null = null;
  /** 共享视窗容器（.preview-view-container：canvas 所在格子）：随外壳首次创建、后续复用 */
  viewContainer: HTMLElement | null = null;
  /** mpc 样式是否已注入（overlay 样式目标复位时清零重注入） */
  stylesInjected = false;

  /** 清零外壳引用（cleanupPreview / _resetSingletons / fullCleanup 共用；已从 DOM 移除的
   *  detached 引用保留会导致下次 mount3D 复用脱离文档的元素，测试 afterEach 尤其敏感） */
  resetRefs(): void {
    this.overlay = null;
    this.body = null;
    this.viewContainer = null;
  }

  /** 幂等注入 overlay 链静态样式（首建/样式目标复位后调用；失败仅影响样式不阻断挂载） */
  ensureStyles(): void {
    if (this.stylesInjected) return;
    this.stylesInjected = true;
    const el = document.createElement("style");
    el.textContent = mpcCss;
    overlayStyleRoot().appendChild(el);
  }
}

/** 全局唯一预览外壳宿主（外壳为单一全屏 overlay 设计，单 host 合理） */
export const previewShell = new PreviewShellHost();

// ADR-175 M1：overlay 样式目标复位（拆除/重建 shadow root）时清零注入旗标，下次 ensureStyles 重注入
onOverlayStyleTargetReset(() => {
  previewShell.stylesInjected = false;
});
