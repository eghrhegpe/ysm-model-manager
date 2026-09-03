// ===== menu-test-fixtures.ts — 3D 菜单测试共享夹具（jscpd 消重 + 单一事实源）=====
// makeMenuCtx（PreviewMenuCtx 全字段 stub）与 mockMenuHandle（SlideMenuHandle stub）
// 原先在 preview-menu.roles/items/menu/health/node-render 五个测试文件各持一份
 // 26 行近似拷贝——health.test（ADR-128 冒烟）入列时 jscpd 配对爆表。抽此处共享，
 // 变体差异（如 items 的 fakeCap getCap）经 overrides / 本地薄包装表达。
import { vi } from "vitest";
import type { SlideMenuHandle } from "../../ui/ui-slide-menu.ts";
import type { PreviewMenuCtx } from "../menu/core.ts";
import { setSceneCapabilityLookup } from "../state/preview-state.ts";
import type { SceneCapability } from "../caps/scene-capability.ts";

/** PreviewMenuCtx 全字段 stub：能力全缺（getCap → null）、桥全 vi.fn()。
 *  需要特定能力的测试经 overrides 注入（如 items 的 fakeCap）。 */
export function makeMenuCtx(overrides: Partial<PreviewMenuCtx> = {}): PreviewMenuCtx {
  const getCap = overrides.getCap ?? (() => null);
  // [doc:adr-126-p4-d] getCap 同步进状态层 lookup（ADR-168 注入点）：dock 级 visibleWhen
  // 谓词（env.skyGroundCap）与 ctx.getCap 同源——测试注入 fake cap 一次，两端都读到
  setSceneCapabilityLookup({
    getById: (id: string) => (getCap(id) as SceneCapability | null) ?? undefined,
  });
  return {
    selfMode: false,
    getCap: () => null,
    getCamBridge: () => ({
      getOrbit: () => true,
      setOrbit: vi.fn(),
      getSpeed: () => 20,
      setSpeed: vi.fn(),
      reset: vi.fn(),
    }),
    getSiblings: () => [],
    getCurrentPath: () => "/m/a.ysm",
    getViewContainer: () => document.createElement("div"),
    close: vi.fn(),
    switchTo: vi.fn(),
    unloadModel: vi.fn(),
    toast: vi.fn(),
    closeAllOverlays: vi.fn(),
    ...overrides,
  };
}

/** SlideMenuHandle 全方法 stub（渲染器/面板单测用，导航动作全 no-op） */
export function mockMenuHandle(): SlideMenuHandle {
  return {
    root: document.createElement("div"),
    list: document.createElement("div"),
    setTitle: () => {},
    setOnClose: () => {},
    home: () => {},
    navigate: () => {},
    back: () => {},
    refresh: () => {},
    isShowing: () => false,
    reset: () => {},
    isAtRoot: () => true,
    dispose: () => {},
    onShow: () => {},
    onHide: () => {},
  } as unknown as SlideMenuHandle;
}
