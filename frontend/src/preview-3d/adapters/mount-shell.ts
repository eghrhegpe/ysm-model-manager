// ===== mount3D stage 1: 外壳装配（自 mount-preview-core.ts 纯搬家，ADR-171 §2.2 拆分）=====
// 本文件承载「单例 DOM → 相机桥 → 视窗 → 根菜单」四段外壳装配；调度层 mount3D
// （mount-preview-core.ts）负责建会话骨架并在此调用 assembleShell(ctx)。

import { t } from "@/core/i18n/t.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import type { CameraControlBridge } from "@/preview-3d/infra/camera-controls.ts";
import { setOverlayStyleTarget } from "@/preview-3d/infra/overlay-style-bridge.ts";
import { ensureOverlayShell, ensureViewContainer } from "@/preview-3d/infra/preview-shell.ts";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";
import {
  mountPreviewRootMenu,
  type PreviewMenuCtx,
  type PreviewMenuHandle,
} from "@/preview-3d/menu/engine/core.ts";
import { componentsStyleSheet } from "@/preview-3d/menu/style/components-styles.ts";
import { slideMenuStyleSheet } from "@/preview-3d/menu/style/slide-menu-styles.ts";
import { createInstallableStyles } from "@/preview-3d/menu/style/style-install.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { noAnimationsCSS } from "@/utils/dom/css.ts";
import { toast } from "@/utils/dom/toast.ts";
import { trapFocusAcrossShadow } from "@/utils/dom/trap-focus-across-shadow.ts";
import type { AssembledShell, Mount3DOptions, PreviewAdapter } from "./mount-preview-core.ts";
import {
  closeOverlay,
  type MountCtx,
  type MpSessionState,
  ownHandle,
  unloadSessionModel,
} from "./mount-session.ts";

// ===== mount3D stage 1: 外壳装配（原 mount3D L400-407 + L456-619 纯搬家）=====
/**
 * 会话骨架(session/handlers/focusTrap/ctx/infra 槽)由调度层 mount3D 先建；
 * 本函数按「单例 DOM → 相机桥 → 视窗 → 根菜单」四段顺序装配外壳，每段下沉为
 * 具名子函数（见下），主函数只保留编排与返回值组装。camBridge.setOrbit 经
 * ctx.getInfra() 延迟读 infra（原闭包捕获 let infra 的语义等价——buildInfra
 * 赋值后调度层回填 ctx 槽位）。
 */
export function assembleShell(ctx: MountCtx): AssembledShell {
  const session = ctx.session;
  const selfMode = ctx.selfMode;
  const adapter = ctx.adapter;
  const opts = ctx.opts;

  // input 状态（不进 session：bindInputHandlers 已显式接收 keys/mouseDown/lastMouse）
  // keys 直接使用 session.keys（render-loop 动态读取驱动相机运动）
  const keys = session.keys;
  // mouseDown 用 { v } 引用容器（与 input-and-animation InputOptions.mouseDown 同形）：
  // camBridge.setOrbit 与 bindInputHandlers 共享同一引用——修历史脱节（原 let 布尔 +
  // { v: mouseDown } 快照，camBridge 写裸布尔不影响 input 读容器），并为 assembleShell/
  // buildInfra 跨 stage 共享铺路（容器引用跨函数传递共享同一状态）。
  const mouseDown = { v: false };
  const lastMouse = { x: 0, y: 0 };

  const shell = assembleOverlayShell(ctx);
  const { overlay, root } = shell;
  ctx.overlay = overlay;

  const camBridge = makeCamBridge(ctx, session, mouseDown);
  ctx.camBridge = camBridge;

  // ensureViewContainer 可能补建 body（单例半残场景）——返回权威引用，勿用 ensureOverlayShell 的初值
  const { viewContainer, body } = ensureViewContainer(shell.body, root);
  ctx.viewContainer = viewContainer;

  const menuHandle = mountRootMenu(ctx, {
    root,
    viewContainer,
    camBridge,
    selfMode,
    adapter,
    opts,
  });
  ctx.menuHandle = menuHandle;

  const loadingEl = document.createElement("div");
  loadingEl.className = "mpc-loading";
  viewContainer.appendChild(loadingEl);
  ctx.loadingEl = loadingEl;

  return {
    overlay,
    body,
    root,
    camBridge,
    viewContainer,
    menuHandle,
    loadingEl,
    keys,
    mouseDown,
    lastMouse,
  };
}

/**
 * `.no-animations` 通配桥的 CSSStyleSheet（ADR-015 §2.4 约束 1：用户关闭时零动画）。
 *
 * 为什么 3D overlay 也要自带：`.no-animations` 类挂 `documentElement`，而文档层通配规则
 * **不穿透 Shadow 边界**（`preview-shell.ts` 为本 overlay 建了独立 shadow root），
 * 故须显式 adopt——否则「关闭动画」在 3D HUD 上静默失效。
 * 复用 style-install 脚手架（勿手写 CSSStyleSheet + try/catch 三件套，见该文件头注释）。
 * 降级路径（无 shadow → overlay 本体在 light DOM）由文档层通配覆盖，故无需 install()。
 */
const noAnimationsStyles = createInstallableStyles(
  noAnimationsCSS,
  "data-ui-no-animations",
  "ui-no-animations",
);

/**
 * 单例外壳 DOM 装配的适配层：把 core 持有的样式表 / i18n 文案 / 样式目标注入点
 * 打包传给 infra 的 `ensureOverlayShell`（DOM 外壳本体与单例已归 preview-shell.ts）。
 * 焦点陷阱在此安装（依赖 ctx.focusTrap，属会话态而非外壳单例态）。
 */
function assembleOverlayShell(ctx: MountCtx): {
  overlay: HTMLElement;
  body: HTMLElement;
  root: HTMLElement | ShadowRoot;
} {
  const shell = ensureOverlayShell({
    styleSheets: [componentsStyleSheet, slideMenuStyleSheet, noAnimationsStyles.sheet],
    ariaLabel: t("preview.title3d"),
    setStyleTarget: setOverlayStyleTarget,
    onStyleError: (err) =>
      logWarn("preview-3d", `adoptedStyleSheets 安装失败（降级 head 注入）: ${String(err)}`),
  });
  // 焦点陷阱：ADR-175 M1 后 overlay 内容实体在 host.shadowRoot 内，
  // trapFocusAcrossShadow 的跨 shadow 下钻从防御性兜底转正为实际路径（D3）
  if (!ctx.focusTrap.cleanup) {
    ctx.focusTrap.cleanup = trapFocusAcrossShadow(shell.overlay);
  }
  return shell;
}

/**
 * 相机控制桥（shared 模式）：core 的相机控件与 PreviewBuildCtx.cameraControls
 * 共用同一 bridge（操作核心内部 orbitMode/camSpeed/controls），适配器（如 ysm 底部
 * 导航）经 cameraControls 复用同一套相机状态。相机控件本身已收进声明式根菜单的 camera 项。
 *
 * @param mouseDown 与 bindInputHandlers 共享的引用容器——setOrbit 需清零它防拖拽残留
 */
function makeCamBridge(
  ctx: MountCtx,
  session: MpSessionState,
  mouseDown: { v: boolean },
): CameraControlBridge {
  return {
    getOrbit: () => session.orbitMode,
    setOrbit: (v: boolean) => {
      const i = ctx.getInfra(); // camBridge 仅经 cameraControls 在 build 后使用；self 模式不调用（ctx.getInfra 延迟读）
      if (!i) return;
      session.orbitMode = v;
      i.controls.enableRotate = v;
      if (v) {
        i.orbitTarget.copy(i.controls.target);
      } else {
        session.euler.setFromQuaternion(i.camera.quaternion);
      }
      mouseDown.v = false;
    },
    getSpeed: () => session.camSpeed,
    setSpeed: (n: number) => {
      session.camSpeed = n;
    },
    // content 在 try 块内声明，此处经模块级 _handle（PreviewHandle 含 resetCamera? 契约）延迟调用。
    // gen-scoped 解析本会话句柄——原 `_handles[length-1]` 在 coop
    // 多 session 下指向「最后 commit 的 session」而非本菜单/camera 桥属主，相机复位会误切他人
    reset: () => {
      ownHandle(ctx)?.resetCamera?.();
    },
  };
}

/** 根菜单装配依赖（自 assembleShell 局部量打包，避免参数列表过长） */
interface RootMenuDeps {
  root: HTMLElement | ShadowRoot;
  viewContainer: HTMLElement;
  camBridge: CameraControlBridge;
  selfMode: boolean;
  adapter: PreviewAdapter;
  opts: Mount3DOptions;
}

/**
 * 声明式根菜单（⚙️）：core 在 overlay 内自建（预览全屏盖住 app 外壳，主程序 nav.settings 够不着），
 * 全部控件以 CORE_MENU_ITEMS + 适配器注入项表驱动渲染（preview-menu/defs.ts），
 * 测试遍历真实菜单数组断言（preview-menu/items.test.ts），选择器稳定可遍历（ADR-076 v2）。
 *
 * 顶栏已移除（ADR-076 v2，用户 2026-08-16 决策）：预览控件全部收进声明式根菜单
 * （⚙️ 按钮 → mountPreviewRootMenu），彻底告别顶栏滑块垃圾。litematic 分层切片面板也经
 * schemaId 注册（registerSchema builder）注入根菜单模型组。
 */
function mountRootMenu(ctx: MountCtx, deps: RootMenuDeps): PreviewMenuHandle {
  const { root, viewContainer, camBridge, selfMode, adapter, opts } = deps;
  const session = ctx.session;

  const menuCtx: PreviewMenuCtx = {
    selfMode,
    getCap: (id: string) => sceneCapabilityRegistry.getById(id) ?? null,
    getCapByPanelId: (panelId: string) => sceneCapabilityRegistry.getCapByPanelId(panelId) ?? null,
    getAllCaps: () => sceneCapabilityRegistry.getAll(),
    getCamBridge: () => camBridge,
    getSiblings: () => (opts.siblings ?? []).filter((p) => p !== session.currentPath),
    getCurrentPath: () => session.currentPath,
    getCurrentRtype: () => (opts.rtype?.trim() ? opts.rtype : adapter.id),
    getCurrentSubtype: () => opts.subtype ?? "",
    getViewContainer: () => viewContainer,
    close: () => {
      if (session.cleanupFn) session.cleanupFn();
      else closeOverlay(ctx);
    },
    switchTo: (p: string, options?: { keepInScene?: boolean }): Promise<void> | void => {
      // gen-scoped 解析本会话句柄（对齐 runBuild.switchTo 同款
      // 查找）——原 `_handles[length-1]` 在 coop 多 session 下指向最后 commit 的 session，
      const r = ownHandle(ctx)?.switchTo?.(p, options);
      // 透传 Promise：调用方（fillSwitch 替换/追加）在完成后局部刷新面板（renderRows 重读新当前路径）
      if (r) {
        void r.catch((err: unknown) =>
          logWarn("preview-menu", `switchTo 切换失败: ${String(err)}`),
        );
        return r;
      }
      return undefined;
    },
    unloadModel: (id: string) => unloadSessionModel(ctx, id),
    toast: (msg: string): void => {
      toast(msg);
    },
    closeAllOverlays: (): void => {
      menuHandle.dispose();
    },
  };
  // getModelsByType / getTypeTabs / switchExternal 是 PreviewMenuCtx 可选键（menu/core.ts，
  // 非本域）——exactOptional 收紧后仅真实存在时赋值，避免显式 undefined 流入
  // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
  if (opts.getModelsByType) menuCtx.getModelsByType = (t, s) => opts.getModelsByType!(t, s);
  // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
  if (opts.getTypeTabs) menuCtx.getTypeTabs = () => opts.getTypeTabs!();
  if (opts.switchExternal)
    menuCtx.switchExternal = (
      p: string,
      s?: string[],
      options?: { keepInScene?: boolean },
    ): void => {
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      const r = opts.switchExternal!(p, s, options) as Promise<void> | void;
      if (r && typeof r.catch === "function") {
        void r.catch((err: unknown) =>
          logWarn("preview-menu", `switchExternal 切换失败: ${String(err)}`),
        );
      }
    };
  const menuHandle = mountPreviewRootMenu(root, menuCtx);
  // ADR-093 T5：注册表菜单 sink（selectModel 时按活跃模型换菜单项）
  sceneRegistry.setMenuSink({ setAdapterItems: (items) => menuHandle.setAdapterItems(items) });
  return menuHandle;
}
