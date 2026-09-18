// ===== 预览外壳宿主（[ADR-227] P1 单例收敛：模块级 DOM 外壳单例 → 实例字段）=====
// 原 mount-preview-core 模块级可变外壳状态（_singletonOverlay/_singletonBody/
// _singletonViewContainer）与 mpc 静态样式注入旗标（_mpcStylesInjected）收敛为
// PreviewShellHost 实例字段——与兄弟会话 A1（_globalPause → createPerceptionPauseRef）、
// RendererHost（render-loop）、SceneInfraHost（shared-infra）同一战役、同一步伐。
//
// 设计边界：3D 预览为「同一时刻单一全屏 overlay」的模态体验（overlay 清理后 refs 归零，
// 下次 mount3D 重建），故外壳宿主为单例实例（previewShell）；状态均为实例字段，不再散落
// 模块级 let。mpc 静态样式经 host.ensureStyles 委托 installOnceStyles 幂等注入（reset 钩子清零后自动重注）。
import { installOnceStyles } from "./overlay-style-bridge.ts";
import { PREVIEW_OVERLAY_ID } from "./ui-constants.ts";

// §1.5 P1 批次9:overlay 链静态 cssText 抽类集中注入(mount3D 内 ensureStyles 幂等调用)
// ADR-175 M1:overlay shadow host 化——内容迁入 shadowRoot 后 head 注入穿不透边界,
// 首条规则改 `:host` 承载宿主自身布局(降级 light DOM 路径由 .mpc-overlay 选择器兜底);
// 注入目标经 overlay-style-bridge 迁移(shadow root / 无 overlay 时 head 兜底)。
const mpcCss = `
:host, .mpc-overlay { position:fixed; inset:0; z-index:var(--z-fullscreen); background:var(--bg); display:flex; flex-direction:column; }
.mpc-body { flex:1; display:flex; position:relative; overflow:hidden; }
.preview-view-container.mpc-view { flex:1; position:relative; overflow:hidden; }
.mpc-loading { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--muted); font-size:var(--fs-lg); gap:12px; z-index:10; }
.mpc-tip { padding:5px 12px; background:var(--surf); border-bottom:1px solid var(--bd); color:var(--txt); font-size:var(--fs-sm); text-align:center; flex-shrink:0; }
`;

/**
 * 预览外壳宿主：持有 overlay/body/viewContainer 复用引用；mpc 样式经 installOnceStyles 幂等注入。
 * 外壳为「同一时刻单一全屏 overlay」设计——resetRefs() 归零后下次 mount3D 重建。
 */
export class PreviewShellHost {
  /** 模块级全局 overlay（仅 cleanupPreview 时才移除，多次 mount3D 复用同一 DOM） */
  overlay: HTMLElement | null = null;
  body: HTMLElement | null = null;
  /** 共享视窗容器（.preview-view-container：canvas 所在格子）：随外壳首次创建、后续复用 */
  viewContainer: HTMLElement | null = null;

  /** 清零外壳引用（cleanupPreview / _resetSingletons / fullCleanup 共用；已从 DOM 移除的
   *  detached 引用保留会导致下次 mount3D 复用脱离文档的元素，测试 afterEach 尤其敏感） */
  resetRefs(): void {
    this.overlay = null;
    this.body = null;
    this.viewContainer = null;
  }

  /** 幂等注入 overlay 链静态样式（委托 installOnceStyles，样式目标复位后自动重注） */
  ensureStyles(): void {
    installOnceStyles("mpc", mpcCss);
  }
}

/** 全局唯一预览外壳宿主（外壳为单一全屏 overlay 设计，单 host 合理） */
export const previewShell = new PreviewShellHost();

/**
 * 单例外壳 DOM 装配：overlay(shadow host) + body。首次创建，后续复用同一 DOM（避免重建黑屏）。
 *
 * ADR-175 M1：overlay = shadow host（挂 document.body 保留 id/class/aria，app-tree
 * getElementById 守卫零改动）；全部内容（tip/body/viewContainer/菜单链）迁入 shadowRoot。
 * attachShadow 缺失（无 shadow DOM 的宿主/测试环境）降级 light DOM——root 即 overlay 本体，
 * 样式注入走 head 兜底，与迁移前行为一致。复用路径（单例存活）从 host 取回既有 shadowRoot。
 *
 * @param deps 样式表与平台注入点（适配层提供，避免 infra 反向依赖 menu/dom 层）
 */
export function ensureOverlayShell(deps: OverlayShellDeps): {
  overlay: HTMLElement;
  body: HTMLElement;
  root: HTMLElement | ShadowRoot;
} {
  let overlay = previewShell.overlay;
  let body = previewShell.body;
  let root: HTMLElement | ShadowRoot;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = deps.overlayId ?? PREVIEW_OVERLAY_ID;
    overlay.className = "mpc-overlay";
    // 无障碍：3D 全屏预览是模态体验——告诉屏幕阅读器这是对话框、独占焦点、名称用
    // 已有 preview.title3d i18n key（与 FAB aria-label 同源，3 语言包已同步）
    // D3：aria 挂 host（host 在 document 树，语义对屏幕阅读器可见）
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", deps.ariaLabel);
    document.body.appendChild(overlay);
    const shadow =
      typeof overlay.attachShadow === "function" ? overlay.attachShadow({ mode: "open" }) : null;
    root = shadow ?? overlay;
    if (shadow) {
      // 共享样式模块走 adoptedStyleSheets（与全站 shadow 组件同形态；head 注入由
      // installUiComponentsStyles 兜底路径承担，不冲突）。失败仅影响样式，不阻断挂载。
      try {
        shadow.adoptedStyleSheets = deps.styleSheets.filter((s): s is CSSStyleSheet => s != null);
      } catch (err) {
        deps.onStyleError?.(err);
      }
    }
    // 注入目标切到本 shadow root（或降级的 overlay 本体）——全部 ensure* 旗标复位重注入
    deps.setStyleTarget(root);
    previewShell.ensureStyles(); // 首建即注入 mpc 规则（:host 布局在 root 内生效）
    body = document.createElement("div");
    body.className = "mpc-body";
    root.appendChild(body);
    previewShell.overlay = overlay;
    previewShell.body = body;
  } else {
    // 复用路径：从 host 取回既有 shadowRoot（降级环境无 shadowRoot → host 本体）
    root = overlay.shadowRoot ?? overlay;
  }
  return { overlay, body: body as HTMLElement, root };
}

/** ensureOverlayShell 的平台注入点（样式表 / a11y 文案 / 样式目标切换） */
export interface OverlayShellDeps {
  /** 共享样式表（components + slide-menu），null 项自动过滤 */
  styleSheets: (CSSStyleSheet | null | undefined)[];
  /** overlay 无障碍名称（i18n preview.title3d） */
  ariaLabel: string;
  /** 切换样式注入目标（shadow root / 降级 overlay 本体） */
  setStyleTarget: (root: HTMLElement | ShadowRoot) => void;
  /** adoptedStyleSheets 安装失败回调（降级 head 注入，仅影响样式） */
  onStyleError?: (err: unknown) => void;
  /** overlay 元素 id（缺省 PREVIEW_OVERLAY_ID） */
  overlayId?: string;
}

/**
 * viewContainer 单例：与 scene/canvas 同属共享外壳——首次创建，后续复用同一视窗
 * （多模型同台共用同一 canvas，而非每次新建空容器；回归：曾反复 new 容器导致同台后多出空白分屏）。
 *
 * overlay/body 单例成对创建（overlay 在则 body 必在），TS 不认该不变量——复用路径
 * body 可能为 null。兜底必须在此处（viewContainer 创建前）执行才能真正守卫 body 消费。
 *
 * @returns viewContainer + **权威 body 引用**（兜底分支可能补建，调用方须用返回值而非入参）
 */
export function ensureViewContainer(
  body: HTMLElement | null,
  root: HTMLElement | ShadowRoot,
): { viewContainer: HTMLElement; body: HTMLElement } {
  let b = body;
  if (!b) {
    b = document.createElement("div");
    b.className = "mpc-body";
    root.appendChild(b);
    previewShell.body = b;
  }
  if (!previewShell.viewContainer) {
    const c = document.createElement("div");
    // 语义锚点类保留,布局样式入 .mpc-view(双类防将来锚点规则覆盖)
    c.className = "preview-view-container mpc-view";
    b.appendChild(c);
    previewShell.viewContainer = c;
  }
  return { viewContainer: previewShell.viewContainer, body: b };
}
