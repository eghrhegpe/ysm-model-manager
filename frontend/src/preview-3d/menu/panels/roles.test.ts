// ===== 角色面板测试（MikuMikuAR buildModelRootItems 移植：多角色加载与设置）=====
// 覆盖：roles 项声明、角色列表渲染（焦点标记）、行首 radio 焦点切换、
// 点击角色名进详情（按该角色 menuItems 能力显示，vrm/mmd 内容各异）、
// ⚙ 工具含卸载角色、空态与加载入口共存。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { CORE_MENU_ITEMS } from "@/preview-3d/menu/engine/defs.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";
import { mountPreviewRootMenu, roleBaseName } from "@/preview-3d/menu/engine/core.ts";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";
import type { PreviewScene } from "@/preview-3d/adapters/mount-preview-core.ts";
import { registerSchema, unregisterSchema } from "@/preview-3d/infra/schema-registry.ts";
import { makeMenuCtx as makeCtx } from "@/preview-3d/menu/menu-test-fixtures.ts";
import type { LocaleKey } from "@/core/i18n/t.ts";

/** 注册一个测试角色（真实 SceneRegistry 单例，测试间 reset） */
function regRole(path: string, menuItems: PreviewMenuNode[] | null = null): string {
  return sceneRegistry.register({
    path,
    rtype: "test",
    roots: [new THREE.Object3D()],
    content: { dispose: vi.fn() } as unknown as PreviewScene,
    boneMaps: null,
    menuItems,
    onBonePick: null,
  });
}
/** radio 指示器几何：off = 单圆环（1 个 <circle>）；on = 外环 + 圆心（2 个 <circle>） */
function radioCircles(row: Element | null): number {
  return row?.querySelectorAll('[data-testid="row-radio"] svg circle').length ?? -1;
}

describe("CORE_MENU_ITEMS roles 项", () => {
  it("roles 项声明在 model 组（panel + icon/labelKey 齐全）", () => {
    const def = CORE_MENU_ITEMS.find((d) => d.id === "roles");
    expect(def).toBeDefined();
    expect(def!.kind).toBe("panel");
    expect(def!.dockGroup).toBe("model");
    expect(def!.icon?.length).toBeGreaterThan(0);
    expect(def!.labelKey?.length).toBeGreaterThan(0);
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
    // ADR-193 第四刀：声明式 roles 面板——角色行或空态（sectionTitle）至少其一出现
    const opened =
      overlay.querySelector('[data-testid^="preview-role-"]') !== null ||
      overlay.querySelector('[data-testid="roles-empty"]') !== null;
    expect(opened).toBe(true);
    handle.dispose();
  });

  it("注册 2 角色 → 面板列出 2 行，焦点行 radio 为「环+圆心」图标且行高亮", () => {
    const a = regRole("/m/a.ysm");
    const b = regRole("/m/b.ysm"); // b 为 active（register 即置活跃）
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const rows = overlay.querySelectorAll('[data-testid^="preview-role-"]');
    expect(rows.length).toBe(2);
    const aRow = overlay.querySelector(`[data-testid="preview-role-${a}"]`);
    const bRow = overlay.querySelector(`[data-testid="preview-role-${b}"]`);
    expect(aRow).not.toBeNull();
    expect(bRow).not.toBeNull();
    // radio = SVG 图标（ADR-238：UI chrome 走图标，不靠字形）：off 单环 / on 环+圆心
    expect(aRow!.querySelector('[data-testid="row-radio"] svg.ws-icon')).not.toBeNull();
    expect(radioCircles(aRow)).toBe(1);
    expect(radioCircles(bRow)).toBe(2);
    const aRadio = aRow!.querySelector('[data-testid="row-radio"]') as HTMLElement;
    const bRadio = bRow!.querySelector('[data-testid="row-radio"]') as HTMLElement;
    expect(aRadio.className).not.toContain("row-radio-active");
    expect(bRadio.className).toContain("row-radio-active");
    // 行高亮走主题 token 派生（刀②收编）。happy-dom 计算样式读 color-mix() 丢声明
    //（与真实 WebView2 不一致），故锁两级：类 token（rm-row-active）+ 注入样式表原文。
    expect(aRow!.className).not.toContain("rm-row-active");
    expect(bRow!.className).toContain("rm-row-active");
    const menuSheet = [...document.querySelectorAll("style")].find((st) => st.textContent?.includes(".rm-row-active"));
    expect(menuSheet?.textContent ?? "").toContain("var(--accent)");
    // 归属回归（2026-09-16）：行内按钮用的 cc-btn 族必须随本样式表注入——曾经只搭
    // cap 栈便车（ensureCapStyles 仅 renderCapControls 调用），角色面板这种纯 row 路径
    // 拿不到 ⇒ UA 默认不透明白底 + 2px 黑框（实测 background=rgb(240,240,240)）。
    expect(menuSheet?.textContent ?? "").toContain(".cc-btn-ghost");
    handle.dispose();
  });

  it("点击行首 radio → 焦点切换到该角色（getActiveId 更新 + 行重渲染）", () => {
    const a = regRole("/m/a.ysm");
    regRole("/m/b.ysm");
    expect(sceneRegistry.getActiveId()).not.toBe(a);
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-${a}"]`);
    (aRow!.querySelector('[data-testid="row-radio"]') as HTMLElement).click();
    expect(sceneRegistry.getActiveId()).toBe(a);
    const aRow2 = overlay.querySelector(`[data-testid="preview-role-${a}"]`);
    expect(radioCircles(aRow2)).toBe(2);
    handle.dispose();
  });

  it("radio 切到无 menuItems 角色 → 显式清空 dock 适配器项（P2：不残留上一角色菜单）", () => {
    const a = regRole("/m/a.ysm"); // 无 menuItems
    regRole("/m/b.ysm"); // 无 menuItems（active）
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    const spy = vi.spyOn(handle, "setAdapterItems");
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-${a}"]`);
    (aRow!.querySelector('[data-testid="row-radio"]') as HTMLElement).click();
    // setActive 对 menuItems 空角色不换菜单——buildRolesSchema 显式清空 dock 项
    expect(spy).toHaveBeenCalledWith([]);
    handle.dispose();
  });

  it("dock 🧍 → 角色列表（切换模型入口）；点角色名 → 详情模型信息本体直渲；详情「切换角色 ›」回列表", () => {
    const matPanel: PreviewMenuNode = {
      id: "material",
      icon: "appearance",
      labelKey: "preview.material" as LocaleKey,
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
    const aRow0 = overlay.querySelector(`[data-testid="preview-role-m1"]`);
    expect(aRow0).not.toBeNull();
    expect(overlay.textContent).not.toContain("MAT-PANEL");
    // 2) 点角色行 → 进详情，模型信息面板本体直接渲染（actionCtx.navigate → menu.navigate）
    (aRow0 as HTMLElement).click();
    expect(overlay.textContent).toContain("MAT-PANEL");
    // 3) 详情返回（slide-menu ← back，fillRoles 进入时经 back 回列表，不重复加「切换角色」行）
    const backBtn = overlay.querySelector(".slide-back");
    expect(backBtn).not.toBeNull();
    (backBtn as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-m1"]`);
    expect(aRow).not.toBeNull();
    handle.dispose();
  });

  it("点击 ⚙ → 工具子面板含卸载模型；点击卸载 → ctx.unloadModel 收到该模型实例 id", () => {
    const unloadModel = vi.fn();
    regRole("/m/a.ysm");
    const handle = mountPreviewRootMenu(overlay, makeCtx({ unloadModel }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector(`[data-testid="preview-role-m1"]`);
    (aRow!.querySelector('[data-testid="row-badge"]') as HTMLElement).click();
    const unload = overlay.querySelector('[data-testid="preview-role-unload"]');
    expect(unload).not.toBeNull();
    (unload as HTMLElement).click();
    expect(unloadModel).toHaveBeenCalledWith("m1");
    handle.dispose();
  });

  it("无已加载角色 → 空态提示", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    expect(overlay.querySelector('[data-testid="roles-empty"]')).not.toBeNull();
    handle.dispose();
  });

  it("dock 🧍 → 列表 → 点角色名 → modelDetailView（模型本体直渲 + 工具行）；不显示 motion 项", () => {
    const defs = (): PreviewMenuNode[] => [
      { id: "material", icon: "appearance", label: "材质", kind: "panel", dockGroup: "model", renderCustom: (l) => { l.append("MAT-BODY"); } },
      { id: "shot", icon: "camera", label: "截图", kind: "panel", dockGroup: "model", renderCustom: () => {} },
      { id: "play", icon: "play", label: "播放", kind: "panel", dockGroup: "motion", renderCustom: () => {} },
    ];
    regRole("/m/a.jsm", defs());
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    // 🧍 → 角色列表（不直达详情）
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    expect(overlay.textContent).not.toContain("MAT-BODY");
    // 点角色名 → modelDetailView：模型信息面板本体直渲 + 工具行
    const aRow = overlay.querySelector('[data-testid^="preview-role-"]');
    (aRow as HTMLElement).click();
    expect(overlay.textContent).toContain("MAT-BODY");
    // [ADR-242] 工具行 shot 按卡壳入口行渲染（内容跳转后渲染，不内联）
    expect(overlay.querySelector('[data-testid="preview-role-tools"]')).not.toBeNull();
    expect(overlay.querySelector('[data-testid="preview-model-entry-shot"]')).not.toBeNull();
    // 模型详情不显示 motion 项
    expect(overlay.querySelector('[data-testid="preview-play"]')).toBeNull();
    handle.dispose();
  });

  it("dock 💃 → motionDetailView（卡壳收纳 + 入口行 array，内容跳转后渲染）；不显示模型信息本体和工具行", () => {
    const defs = (): PreviewMenuNode[] => [
      { id: "material", icon: "appearance", label: "材质", kind: "panel", dockGroup: "model", renderCustom: (l) => { l.append("MAT-BODY"); } },
      { id: "shot", icon: "camera", label: "截图", kind: "panel", dockGroup: "model", renderCustom: () => {} },
      { id: "play", icon: "play", label: "播放", kind: "panel", dockGroup: "motion", renderCustom: (l) => { l.append("PLAY-BODY"); } },
    ];
    regRole("/m/a.jsm", defs());
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    // mountPreviewRootMenu 不自动注入适配器项 → 先注入 motion 组项使 dock-motion 出现
    handle.setAdapterItems([
      { id: "dockPlay", icon: "play", label: "播放", kind: "panel", dockGroup: "motion", renderCustom: (l) => { l.append("PLAY-BODY"); } },
    ]);
    // 💃 → motionDetailView：一级 = 卡壳收纳 + 入口行 array（ADR-242），内容不内联
    (overlay.querySelector('[data-testid="dock-motion"]') as HTMLElement).click();
    expect(overlay.textContent).not.toContain("MAT-BODY");
    // 一级：卡壳（cap-card）包住入口行；入口行是 row 节点（有 chevron 跳转提示）
    const card = overlay.querySelector(".cap-card");
    expect(card).not.toBeNull();
    const entryRow = card!.querySelector('[data-testid="preview-motion-entry-play"]');
    expect(entryRow).not.toBeNull();
    // 内容未内联——一级不出现面板内容本体
    expect(overlay.textContent).not.toContain("PLAY-BODY");
    // 点入口行 → navigate 到次级菜单，内容此时才渲染
    (entryRow as HTMLElement).click();
    expect(overlay.textContent).toContain("PLAY-BODY");
    // 动作详情不显示模型信息和工具行
    expect(overlay.querySelector('[data-testid="preview-shot"]')).toBeNull();
    expect(overlay.querySelector('[data-testid="shot"]')).toBeNull();
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

  it("[ADR-159] roleBaseName 优先 displayName（容器实体名，如资源包 zip 名）", () => {
    const id = sceneRegistry.register({
      path: "assets/minecraft/models/block/blunderbuss.json",
      rtype: "resourcepack",
      roots: [],
      content: { dispose: vi.fn() } as unknown as PreviewScene,
      displayName: "3D-muskets",
    });
    expect(roleBaseName(sceneRegistry.get(id)!)).toBe("3D-muskets");
  });

  it("[ADR-159 呈现收敛] 容器 entry 详情置顶组件区：顶层不渲染、点角色名进详情见 2 行；点名切活跃并重渲、➕ keepInScene 追加", async () => {
    // mock switchTo 带真实切换副作用：注销语义简化为 register 新 path（register 即置活跃），
    // 重渲取 getActiveId 才能看到 ✓ 高亮随组件移动。
    const switchTo = vi.fn((p: string): Promise<void> => {
      sceneRegistry.register({
        path: p,
        rtype: "resourcepack",
        roots: [],
        content: { dispose: vi.fn() } as unknown as PreviewScene,
        displayName: "3D-muskets",
        components: [
          "assets/minecraft/models/block/blunderbuss.json",
          "assets/minecraft/models/item/musket.json",
        ],
      });
      return Promise.resolve();
    });
    sceneRegistry.register({
      path: "assets/minecraft/models/block/blunderbuss.json",
      rtype: "resourcepack",
      roots: [],
      content: { dispose: vi.fn() } as unknown as PreviewScene,
      displayName: "3D-muskets",
      components: [
        "assets/minecraft/models/block/blunderbuss.json",
        "assets/minecraft/models/item/musket.json",
      ],
    });
    const handle = mountPreviewRootMenu(overlay, makeCtx({ switchTo }));
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    // 组件区已收进详情：角色列表顶层不再平铺（呈现收敛守卫）
    expect(overlay.querySelector('[data-testid="preview-components-list"]')).toBeNull();
    // 点角色名（容器实体）进详情 → 组件区置顶 2 行（当前行 ✓ 无 ➕，他行有 ➕）
    const aRow = overlay.querySelector('[data-testid^="preview-role-"]') as HTMLElement;
    aRow.click();
    const rows = overlay.querySelectorAll('[data-testid="preview-component-row"]');
    expect(rows.length).toBe(2);
    const musket = [...rows].find((el) => el.getAttribute("data-component-path")?.includes("musket.json")) as HTMLElement;
    // 点组件名 → switchTo 替换（不带 keepInScene），落定后重渲：✓ 高亮随新活跃移动
    (musket.querySelector("span:nth-child(2)") as HTMLElement).click();
    expect(switchTo).toHaveBeenCalledWith("assets/minecraft/models/item/musket.json");
    await vi.waitFor(() => {
      const after = [...overlay.querySelectorAll('[data-testid="preview-component-row"]')];
      const musketNow = after.find((el) => el.getAttribute("data-component-path")?.includes("musket.json")) as HTMLElement;
      expect(musketNow.textContent).toContain("✓");
    });
    // 切换后原当前行（blunderbuss）出现 ➕ → 点 ➕ → keepInScene 追加
    const blunder = [...overlay.querySelectorAll('[data-testid="preview-component-row"]')].find((el) =>
      el.getAttribute("data-component-path")?.includes("blunderbuss.json"),
    ) as HTMLElement;
    (blunder.querySelector('[data-testid="preview-component-append"]') as HTMLElement).click();
    expect(switchTo).toHaveBeenLastCalledWith("assets/minecraft/models/block/blunderbuss.json", { keepInScene: true });
    handle.dispose();
  });

  it("[ADR-159 呈现收敛] 无 components（普通模型）→ 详情内不渲染组件区（回归守卫）", () => {
    regRole("/m/a.ysm");
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const aRow = overlay.querySelector('[data-testid^="preview-role-"]') as HTMLElement;
    aRow.click();
    expect(overlay.querySelector('[data-testid="preview-components-list"]')).toBeNull();
    handle.dispose();
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
    // 🧍 → 角色列表 → 底部加载区（switch 段，siblings 分支）列出候选
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    const itemB = [...overlay.querySelectorAll('[data-testid^="preview-switch-cand-"]')].find(
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

// ===== 模型详情信息本体通道回归锁（P5 事故：统计/纹理/组件 select 集体消失）=====
// modelDetailView 的 primary 直渲旧门只认 renderCustom——四类适配器模型面板迁离
// renderCustom（ysm/maid→schemaId、mmd/vrm→children）后全部静默跳过，roles 详情只剩
// 截图工具行。本组测试走真实路径（dock-model → 角色行 → 详情）锁三通道全兼容。
describe("模型详情信息本体（三通道回归锁）", () => {
  let overlay: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    sceneRegistry.reset();
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
  });
  afterEach(() => {
    unregisterSchema("detail-schema-test");
  });

  /** 注册一个带模型信息面板 + 截图工具行的测试角色并进入其详情视图（handle 由调用方 dispose）。
   *  工具行对齐 ysm-adapter 生产形态：shot 是 children 面板（6 角度 button 在下钻视图） */
  function enterDetail(primaryPanel: PreviewMenuNode): { id: string; handle: { dispose: () => void } } {
    const id = regRole("/m/atri.zip", [
      primaryPanel,
      {
        id: "shot",
        icon: "camera",
        labelKey: "preview.screenshot",
        kind: "panel",
        dockGroup: "model",
        children: [{ id: "ysm-shot-front", kind: "button", labelKey: "preview.screenshot", action: vi.fn() }],
      },
    ]);
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector('[data-testid="dock-model"]') as HTMLElement).click();
    (overlay.querySelector(`[data-testid="preview-role-${id}"]`) as HTMLElement).click();
    return { id, handle };
  }

  it("schemaId 通道：模型信息本体渲染（ysm/maid 形态——统计/纹理/组件 select 载体）", () => {
    registerSchema("detail-schema-test", () => [
      { id: "stat-tex", kind: "field", labelKey: "preview.textures" as LocaleKey, value: 4 },
    ]);
    const { handle } = enterDetail({ id: "model", kind: "panel", dockGroup: "model", schemaId: "detail-schema-test" });
    expect(overlay.querySelector('[data-testid="preview-stat-tex"]')).not.toBeNull();
    // [ADR-242] 工具行 shot 变卡壳入口行（内容跳转后渲染，不在一级内联）；
    // 点入口行 → navigate 到 shot 面板，六连角度按钮此时才渲染（用户所见「📷 六连」）
    const shotEntry = overlay.querySelector('[data-testid="preview-model-entry-shot"]');
    expect(shotEntry).not.toBeNull();
    expect(overlay.querySelector('[data-testid="preview-ysm-shot-front"]')).toBeNull();
    (shotEntry as HTMLElement).click();
    expect(overlay.querySelector('[data-testid="preview-ysm-shot-front"]')).not.toBeNull();
    handle.dispose();
  });

  it("children 通道：模型信息本体渲染（mmd/vrm 形态——zip 多 pmx select 载体）", () => {
    const { handle } = enterDetail({
      id: "model",
      kind: "panel",
      dockGroup: "model",
      children: [{ id: "info-name", kind: "field", labelKey: "preview.modelInfo", value: "ATRI" }],
    });
    expect(overlay.querySelector('[data-testid="preview-info-name"]')).not.toBeNull();
    handle.dispose();
  });

  it("renderCustom 通道：模型信息本体渲染（旧版/逃生舱形态，closePopup 透传）", () => {
    const { handle } = enterDetail({
      id: "model",
      kind: "panel",
      dockGroup: "model",
      renderCustom: (l, closePopup) => {
        const d = document.createElement("div");
        d.dataset.testid = "legacy-info-body";
        d.onclick = () => closePopup?.();
        d.textContent = "legacy-info";
        l.appendChild(d);
      },
    });
    const body = overlay.querySelector('[data-testid="legacy-info-body"]') as HTMLElement;
    expect(body).not.toBeNull();
    body.click(); // closePopup = menu.back——旧直渲门透传语义保持
    handle.dispose();
  });
});
