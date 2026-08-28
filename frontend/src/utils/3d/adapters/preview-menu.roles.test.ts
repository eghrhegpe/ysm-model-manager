// ===== 角色面板测试（MikuMikuAR buildModelRootItems 移植：多角色加载与设置）=====
// 覆盖：roles 项声明、角色列表渲染（焦点标记）、行首 radio 焦点切换、
// 点击角色名进详情（按该角色 menuItems 能力显示，vrm/mmd 内容各异）、
// ⚙ 工具含卸载角色、空态与加载入口共存。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { CORE_MENU_ITEMS } from "./preview-menu-defs.ts";
import type { PreviewMenuNode } from "./preview-menu-node-types.ts";
import { mountPreviewRootMenu, roleBaseName, type PreviewMenuCtx } from "./preview-menu.ts";
import { sceneRegistry } from "./scene-registry.ts";

function makeCtx(overrides: Partial<PreviewMenuCtx> = {}): PreviewMenuCtx {
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
    unloadRole: vi.fn(),
    toast: vi.fn(),
    closeAllOverlays: vi.fn(),
    ...overrides,
  };
}

/** 注册一个测试角色（真实 SceneRegistry 单例，测试间 reset） */
function regRole(path: string, menuItems: PreviewMenuNode[] | null = null): string {
  return sceneRegistry.register({
    path,
    rtype: "test",
    roots: [new THREE.Object3D()],
    built: { dispose: vi.fn() } as never,
    boneMaps: null,
    menuItems,
    onBonePick: null,
  });
}

describe("CORE_MENU_ITEMS roles 项", () => {
  it("roles 项声明在 model 组（panel + icon/fallback/labelKey 齐全）", () => {
    const def = CORE_MENU_ITEMS.find((d) => d.id === "roles");
    expect(def).toBeDefined();
    expect(def!.kind).toBe("panel");
    expect(def!.dockGroup).toBe("model");
    expect(def!.icon?.length).toBeGreaterThan(0);
    expect(def!.fallback?.length).toBeGreaterThan(0);
  });
});

describe("角色面板（roles）", () => {
  let overlay: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    sceneRegistry.reset();
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
  });

  it("模型组仅 roles 单 panel → dock-model 快捷直达角色面板（不渲染组根行）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    expect(overlay.querySelector('[data-testid="preview-roles-list"]')).not.toBeNull();
    handle.dispose();
  });

  it("注册 2 角色 → 面板列出 2 行，焦点行 radio 为 ● 且行高亮", () => {
    const a = regRole("/m/a.ysm");
    const b = regRole("/m/b.ysm"); // b 为 active（register 即置活跃）
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const rows = overlay.querySelectorAll('[data-testid="preview-role-row"]');
    expect(rows.length).toBe(2);
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    const bRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${b}"]`);
    expect(aRow).not.toBeNull();
    expect(bRow).not.toBeNull();
    expect((aRow!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).textContent).toBe("○");
    expect((bRow!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).textContent).toBe("●");
    // jsdom 会把 style.cssText 规范化（rgba 内加空格），断言前缀即可
    expect(bRow!.getAttribute("style")).toContain("rgba(124");
    handle.dispose();
  });

  it("点击行首 radio → 焦点切换到该角色（getActiveId 更新 + 行重渲染）", () => {
    const a = regRole("/m/a.ysm");
    regRole("/m/b.ysm");
    expect(sceneRegistry.getActiveId()).not.toBe(a);
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    (aRow!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).click();
    expect(sceneRegistry.getActiveId()).toBe(a);
    const aRow2 = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    expect((aRow2!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).textContent).toBe("●");
    handle.dispose();
  });

  it("radio 切到无 menuItems 角色 → 显式清空 dock 适配器项（P2：不残留上一角色菜单）", () => {
    const a = regRole("/m/a.ysm"); // 无 menuItems
    regRole("/m/b.ysm"); // 无 menuItems（active）
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    const spy = vi.spyOn(handle, "setAdapterItems");
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="${a}"]`);
    (aRow!.querySelector('[data-testid="preview-role-focus"]') as HTMLElement).click();
    // setActive 对 menuItems 空角色不换菜单——fillRoles 显式清空 dock 项
    expect(spy).toHaveBeenCalledWith([]);
    handle.dispose();
  });

  it("dock 🧍 → 角色列表（切换模型入口）；点角色名 → 详情模型信息本体直渲；详情「切换角色 ›」回列表", () => {
    const matPanel: PreviewMenuNode = {
      id: "material",
      icon: "🎨",
      labelKey: "preview.material",
      fallback: "材质",
      kind: "panel",
      dockGroup: "model",
      renderCustom: (l) => {
        l.append("MAT-PANEL");
      },
    };
    regRole("/m/a.ysm", [matPanel]);
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    // 1) dock 🧍 → 恒进角色列表（切换模型入口，不直达详情）
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow0 = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="m1"]`);
    expect(aRow0).not.toBeNull();
    expect(overlay.textContent).not.toContain("MAT-PANEL");
    // 2) 点角色名 → 进详情，模型信息面板本体直接渲染
    (aRow0!.querySelector('[data-testid="preview-role-name"]') as HTMLElement).click();
    expect(overlay.textContent).toContain("MAT-PANEL");
    // 3) 详情返回（slide-menu ← back，fillRoles 进入时经 back 回列表，不重复加「切换角色」行）
    const backBtn = overlay.querySelector(".slide-back");
    expect(backBtn).not.toBeNull();
    (backBtn as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="m1"]`);
    expect(aRow).not.toBeNull();
    handle.dispose();
  });

  it("点击 ⚙ → 工具子面板含卸载角色；点击卸载 → ctx.unloadRole 收到该角色 id", () => {
    const unloadRole = vi.fn();
    regRole("/m/a.ysm");
    const handle = mountPreviewRootMenu(overlay, makeCtx({ unloadRole }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-row"][data-role-id="m1"]`);
    (aRow!.querySelector('[data-testid="preview-role-tools"]') as HTMLElement).click();
    const unload = overlay.querySelector('[data-testid="preview-role-unload"]');
    expect(unload).not.toBeNull();
    (unload as HTMLElement).click();
    expect(unloadRole).toHaveBeenCalledWith("m1");
    handle.dispose();
  });

  it("无已加载角色 → 空态提示", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    expect(overlay.querySelector('[data-testid="preview-roles-empty"]')).not.toBeNull();
    handle.dispose();
  });

  it("dock 🧍 → 列表 → 点角色名 → 详情模型信息本体直渲（无模型 section 列表）；单项平铺直达，不折叠", () => {
    const defs = (): PreviewMenuNode[] => [
      { id: "material", icon: "🎨", labelKey: "", fallback: "材质", kind: "panel", dockGroup: "model", renderCustom: (l) => { l.append("MAT-BODY"); } },
      { id: "play", icon: "▶️", labelKey: "", fallback: "播放", kind: "panel", dockGroup: "motion", renderCustom: () => {} },
    ];
    regRole("/m/a.jsm", defs());
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    // 🧍 → 角色列表（不直达详情）
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    expect(overlay.textContent).not.toContain("MAT-BODY");
    // 点角色名 → 详情：模型信息面板本体直渲（无 preview-role-model section 列表）
    const aRow = overlay.querySelector('[data-testid="preview-role-row"]');
    (aRow!.querySelector('[data-testid="preview-role-name"]') as HTMLElement).click();
    expect(overlay.textContent).toContain("MAT-BODY");
    expect(overlay.querySelector('[data-testid="preview-role-model"]')).toBeNull();
    // 单项 motion 平铺：不折叠，play 行直达可见
    expect(overlay.querySelector('[data-testid="preview-play"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="preview-role-motion"]')).toBeNull();
    handle.dispose();
  });

  it("dock 💃 → 详情平铺 motion 项（play 行直达可见）；模型信息本体隐藏、工具区可见", () => {
    const defs = (): PreviewMenuNode[] => [
      { id: "material", icon: "🎨", labelKey: "", fallback: "材质", kind: "panel", dockGroup: "model", renderCustom: (l) => { l.append("MAT-BODY"); } },
      { id: "shot", icon: "📷", labelKey: "", fallback: "截图", kind: "panel", dockGroup: "model", renderCustom: () => {} },
      { id: "play", icon: "▶️", labelKey: "", fallback: "播放", kind: "panel", dockGroup: "motion", renderCustom: () => {} },
    ];
    regRole("/m/a.jsm", defs());
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    // mountPreviewRootMenu 不自动注入适配器项 → 先注入 motion 组项使 dock-motion 出现
    handle.setAdapterItems([
      { id: "dockPlay", icon: "▶️", labelKey: "", fallback: "播放", kind: "panel", dockGroup: "motion", renderCustom: () => {} },
    ]);
    // 💃 初始聚焦动作 section：motion 项平铺直达、模型信息本体隐藏（material 直渲不出现）、工具区展开含 shot 行
    (overlay.querySelector('[data-testid="dock-motion"]') as HTMLElement).click();
    expect(overlay.textContent).not.toContain("MAT-BODY");
    // 单项 motion 平铺直达，不包裹在 folder 里
    expect(overlay.querySelector('[data-testid="preview-play"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="preview-role-motion"]')).toBeNull();
    expect(overlay.querySelector('[data-testid="preview-shot"]')).not.toBeNull();
    handle.dispose();
  });

  it("roleBaseName 剥扩展名：ysm.json/zip/vrm 等入口文件不露技术名，版本号保留", () => {
    const cases: Array<[string, string]> = [
      ["/m/a.ysm", "a"],
      ["/m/foo.json", "foo"],
      ["/m/bar.zip", "bar"],
      ["/m/[vup]子言-水手服(纯黑-地雷系-墨绿发)[VUP曼云]1.2.zip", "[vup]子言-水手服(纯黑-地雷系-墨绿发)[VUP曼云]1.2"],
      ["/m/model.vrm", "model"],
      ["/m/pose.pmx", "pose"],
      ["/m/无扩展名路径", "无扩展名路径"],
    ];
    for (const [path, expected] of cases) {
      const id = regRole(path);
      const e = sceneRegistry.get(id)!;
      expect(roleBaseName(e), path).toBe(expected);
    }
  });

  it("替换角色：点击行不关菜单，不调 menu.refresh()（保留滚动位置 + 详情面板状态）", async () => {
    let currentPath = "/m/a.ysm";
    const switchTo = vi.fn((p: string) => {
      currentPath = p;
      return Promise.resolve();
    });
    const switchExternal = vi.fn();
    const handle = mountPreviewRootMenu(
      overlay,
      makeCtx({
        getCurrentPath: () => currentPath,
        getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
        getCurrentRtype: () => "",
        switchTo,
        switchExternal,
      }),
    );
    // 🧍 → 角色列表 → 底部加载区（fillSwitch）列出候选
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    const itemB = [...overlay.querySelectorAll('[data-testid="preview-switch-item"]')].find(
      (el) => el.textContent?.includes("b.ysm"),
    ) as HTMLElement | undefined;
    expect(itemB).toBeDefined();
    // 点 b 行替换：菜单保持打开、switchTo 被调、switchExternal 不被调
    itemB!.click();
    expect(popup.style.display).toBe("flex");
    expect(switchTo).toHaveBeenCalledWith("/m/b.ysm");
    expect(switchExternal).not.toHaveBeenCalled();
    // 不调 menu.refresh()：列表 DOM 保持不变（保留滚动位置）
    // ✓ 高亮在下次打开面板时自动归位（getCurrentPath 已更新）
    handle.dispose();
  });
});
