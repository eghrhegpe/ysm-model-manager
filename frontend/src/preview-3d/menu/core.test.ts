// ===== preview-menu 底部根菜单测试（ADR-076 v3：SlideMenu 多层派生 + 能力驱动 dock）=====
// 覆盖：CORE_MENU_ITEMS 表结构、mountPreviewRootMenu 挂载 dock、能力过滤、
// setAdapterItems/openPanel/dispose、单 panel 快捷直达、多 panel 组内下钻。
// ★ 测试断言全部从 PREVIEW_MENU_GROUPS / CORE_MENU_ITEMS 推导，不硬编码菜单 ID。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS } from "./defs.ts";
import { mountPreviewRootMenu } from "./core.ts";
import { switchTabHighlightBg } from "./switch.ts";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";
import {
  __resetInputBlockStackForTest,
  getStackDepth,
} from "@/utils/dom/input-block-stack.ts";
import type { PreviewScene } from "@/preview-3d/adapters/mount-preview-core.ts";
import type { SceneCapability } from "@/preview-3d/caps/scene-capability.ts";
import { deriveTestIds } from "@/test-utils/self-healing.ts";
import { makeMenuCtx as makeCtx } from "./menu-test-fixtures.ts";

/** ADR-193 第四刀：类型 tab 已声明式化为 select——切 tab = 改 select 值 + change 事件 */
function switchSelectTo(overlay: HTMLElement, rtype: string): void {
  const sel = overlay.querySelector('[data-testid="cap-switch-tab"] select') as HTMLSelectElement;
  expect(sel).toBeTruthy();
  sel.value = rtype;
  sel.dispatchEvent(new Event("change"));
}

/** 读当前 tab select 的值（默认高亮断言用） */
function switchSelectedTab(overlay: HTMLElement): string {
  const sel = overlay.querySelector('[data-testid="cap-switch-tab"] select') as HTMLSelectElement;
  expect(sel).toBeTruthy();
  return sel.value;
}

describe("CORE_MENU_ITEMS 表结构", () => {
  it("id 唯一", () => {
    const ids = CORE_MENU_ITEMS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("非 divider 项必有 icon/fallback/labelKey", () => {
    CORE_MENU_ITEMS.forEach((d) => {
      if (d.kind === "divider") return;
      expect(d.icon?.length).toBeGreaterThan(0);
      expect(d.fallback?.length).toBeGreaterThan(0);
      expect(d.labelKey?.length).toBeGreaterThan(0);
    });
  });

  it("契约锚点：camera 归 🎛️ 场景组（self 模式隐藏由 visibleWhen 谓词承担，非旧 sharedOnly 布尔）；roles 为模型组唯一 core 项（加载入口内嵌，dock 始终可见）", () => {
    expect(CORE_MENU_ITEMS.find((d) => d.id === "camera")?.dockGroup).toBe("scene");
    // [doc:adr-126-p4-d] 双轨归一：可见性统一 visibleWhen 谓词（sharedOnly 等布尔已删）
    expect(typeof CORE_MENU_ITEMS.find((d) => d.id === "camera")?.visibleWhen).toBe("function");
    // 独立 switch 项已撤除（2026-08-21 合并）：模型组 core 项仅 roles，面板底部内嵌加载入口
    expect(CORE_MENU_ITEMS.filter((d) => d.dockGroup === "model").map((d) => d.id)).toEqual(["roles"]);
  });
});

describe("mountPreviewRootMenu", () => {
  let overlay: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    sceneRegistry.reset();
    // code review P3：全局类型记忆 key 每个测试前清理——断言失败也不污染后续测试
    // （该 key 跨场景/跨会话共享，泄漏会翻转默认高亮与空状态文案，顺序依赖 flaky）
    localStorage.removeItem("ysm.preview.lastRtype");
    // 输入阻断栈跨用例隔离（菜单 push/pop 必须归零，防上一用例残留翻转 isInputBlocked）
    __resetInputBlockStackForTest();
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
  });

  it("挂载底部 dock 按钮（能力驱动：无注入项 → model/scene/settings 在，motion 不在）", () => {
    mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    // core 组：roles(model) + camera/lighting/shadow/postproc(scene) + settings 均在（env 需 sky cap，此上下文无 → 不断言）
    for (const id of ["model", "scene", "settings"]) {
      expect(overlay.querySelector(`[data-testid="dock-${id}"]`), `dock-${id}`).not.toBeNull();
    }
    // motion 组无 core 项（camera 已迁 scene），无适配器注入 → dock-motion 不存在
    expect(overlay.querySelector(`[data-testid="dock-motion"]`)).toBeNull();
  });

  it("selfMode → scene 组仍可见（lighting/shadow/postproc 已去 sharedOnly，self 模式亦可调）；model 组始终显示", () => {
    mountPreviewRootMenu(overlay, makeCtx({ selfMode: true }));
    expect(overlay.querySelector(`[data-testid="dock-model"]`)).not.toBeNull();
    expect(overlay.querySelector(`[data-testid="dock-scene"]`)).not.toBeNull();
  });

  it("self 模式守卫（visibleWhen 谓词）：self 模式 camera 项不进 scene 组根视图（相机自驱，camBridge 控件语义错位）；shared 模式保留", () => {
    const camDef = CORE_MENU_ITEMS.find((d) => d.id === "camera")!;
    // [doc:adr-126-p4-d] hideInSelfMode → visibleWhen: (s) => s["ui.mode"] !== "self"（mount 同步 ctx.selfMode）
    expect(camDef.visibleWhen).toBeTypeOf("function");
    expect(camDef.visibleWhen?.({ "ui.mode": "self" })).toBe(false);
    expect(camDef.visibleWhen?.({ "ui.mode": "shared" })).toBe(true);
    // shared 模式：scene 组根视图含 camera 行
    const sharedHandle = mountPreviewRootMenu(overlay, makeCtx());
    (overlay.querySelector(`[data-testid="dock-scene"]`) as HTMLElement).click();
    const camRowShared = overlay.querySelector('[data-testid="preview-camera"]');
    expect(camRowShared).not.toBeNull();
    sharedHandle.dispose();
    // self 模式：scene 组根视图不含 camera 行（lighting/shadow/postproc 仍在）
    document.body.innerHTML = "";
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
    const selfHandle = mountPreviewRootMenu(overlay, makeCtx({ selfMode: true }));
    (overlay.querySelector(`[data-testid="dock-scene"]`) as HTMLElement).click();
    expect(overlay.querySelector('[data-testid="preview-camera"]')).toBeNull();
    expect(overlay.querySelector('[data-testid="preview-lighting"]')).not.toBeNull();
    selfHandle.dispose();
  });

  it("点击 scene 组（多 panel：camera + lighting + shadow + postproc）→ 组根视图列项", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const sceneBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-scene"]`);
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // scene 组菜单项从 CORE_MENU_ITEMS 推导（camera/lighting/shadow/postproc 全在 scene）
    const sceneCoreItems = CORE_MENU_ITEMS.filter((d) => d.dockGroup === "scene");
    expect(sceneCoreItems.length).toBeGreaterThan(1);
    for (const eid of deriveTestIds(sceneCoreItems)) {
      expect(overlay.querySelector(`[data-testid="${eid}"]`), eid).not.toBeNull();
    }
    handle.dispose();
  });

  it("渲染器点按切换 chrome：首次隐藏、再次点按恢复同一面板（非关闭浮窗、非空白）", () => {
    const viewEl = document.createElement("div");
    mountPreviewRootMenu(
      overlay,
      makeCtx({ getViewContainer: () => viewEl, getSiblings: () => ["/m/b.ysm"] }),
    );
    // 经 dock 打开 scene 组菜单（菜单内容渲染进 .slide-list）
    (overlay.querySelector(`[data-testid="dock-scene"]`) as HTMLElement).click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    expect(popup.querySelector(".slide-list")?.childElementCount ?? 0).toBeGreaterThan(0);

    const tap = (): void => {
      viewEl.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, clientY: 0 }));
      viewEl.dispatchEvent(new MouseEvent("pointerup", { clientX: 0, clientY: 0 }));
    };
    // 点按 → 隐藏
    tap();
    expect(popup.style.display).toBe("none");
    // 面板 DOM 仍在（隐藏而非删除）
    expect(popup.querySelector(".slide-list")?.childElementCount ?? 0).toBeGreaterThan(0);
    // 再次点按 → 恢复同一面板（display 回 flex，内容仍在）
    tap();
    expect(popup.style.display).toBe("flex");
    expect(popup.querySelector(".slide-list")?.childElementCount ?? 0).toBeGreaterThan(0);
  });

  // 2026-09 焦点恢复一致性收口（刀⑱）：tap-toggle 的隐藏路径早期手搓 pushInputBlock
  // 绕过 onShow——_prevFocus 未被重新武装（后续关闭焦点无法恢复给触发元素）。
  // 阻断计数本身仍平衡（onHide pop 一次对应手动 push 一次），但焦点记忆丢失。
  // 现统一走 onShow，push/pop/焦点记忆三者严格配对。
  // 本用例锁「dock 触发打开 → tap 隐藏 → tap 恢复 → 关闭」循环后：
  //   ① 输入阻断栈归零（WASD 不挂起）
  //   ② 焦点恢复给 dock 触发元素（_prevFocus 经 onShow 重新武装）
  // 反向验证：还原旧写法（手搓 pushInputBlock 不经 onShow）→ ② 焦点断言失败。
  it("tap 隐藏→恢复循环后焦点恢复给 dock 触发元素（_prevFocus 经 onShow 重新武装）", () => {
    const viewEl = document.createElement("div");
    mountPreviewRootMenu(
      overlay,
      makeCtx({ getViewContainer: () => viewEl, getSiblings: () => ["/m/b.ysm"] }),
    );
    const dockBtn = overlay.querySelector(`[data-testid="dock-scene"]`) as HTMLElement;
    dockBtn.focus();
    dockBtn.click(); // showMenu → onShow 记下 _prevFocus = dockBtn
    expect(getStackDepth()).toBe(1);

    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    const tap = (): void => {
      viewEl.dispatchEvent(new MouseEvent("pointerdown", { clientX: 0, clientY: 0 }));
      viewEl.dispatchEvent(new MouseEvent("pointerup", { clientX: 0, clientY: 0 }));
    };
    // tap → 隐藏（onHide → pop + 焦点归还 dockBtn；_prevFocus 清空）
    tap();
    expect(popup.style.display).toBe("none");
    expect(getStackDepth()).toBe(0);
    // tap → 恢复（onShow 重新武装 _prevFocus = document.activeElement；推阻断）
    tap();
    expect(popup.style.display).toBe("flex");
    expect(getStackDepth()).toBe(1);
    // 关闭（✕ → onHide 带 restoreFocus）→ 焦点归还给 _prevFocus 记录的元素
    (overlay.querySelector("#preview-close-3d") as HTMLElement).click();
    expect(popup.style.display).toBe("none");
    expect(getStackDepth()).toBe(0);
    // 焦点应落在 dockBtn（或其容器）——旧写法 _prevFocus=null → body
    expect(document.activeElement?.tagName).not.toBe("BODY");
    expect(document.activeElement === dockBtn || dockBtn.contains(document.activeElement))
      .toBe(true);
  });

  it("🧍 dock 按钮：已有加载角色（YS'M/PMX 多角色）→ 直达 roles 面板，adapter model 项不在 dock 根", () => {
    // 模拟 YS'M/PMX 加载后 sceneRegistry 非空（角色级管理成为主入口）
    sceneRegistry.register({ path: "/m/a.ysm", rtype: "ysm", roots: [], content: {} as unknown as PreviewScene });
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const adapterModelItem = {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel" as const,
      dockGroup: "model" as const,
      renderCustom: (l: HTMLElement) => {
        l.append("MODEL-PANEL");
      },
    };
    handle.setAdapterItems([adapterModelItem]);
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 直接进入 roles 面板（角色管理 + 内嵌加载入口），而非组根视图
    // 单模型实例工具（adapter model）不再作为 dock 根行出现 → 下沉到角色详情
    // （dockGroup:"model" 不变，roleDetailView 仍按它过滤该角色 menuItems）
    expect(overlay.querySelector(`[data-testid="preview-${adapterModelItem.id}"]`)).toBeNull();
    handle.dispose();
  });

  it("🧍 dock 按钮：始终直达 roles 面板（与是否加载角色无关），adapter model 项不在 dock 根", () => {
    // Phase A：🧍 永远开 roles 面板，单模型实例工具下沉角色详情，不再平铺 dock 根
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const adapterModelItem = {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel" as const,
      dockGroup: "model" as const,
      renderCustom: (l: HTMLElement) => {
        l.append("MODEL-PANEL");
      },
    };
    handle.setAdapterItems([adapterModelItem]);
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    expect(modelBtn).not.toBeNull();
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // adapter model 项不再作为 dock 根行出现（下沉到角色详情，未加载角色时不显示）
    expect(overlay.querySelector(`[data-testid="preview-${adapterModelItem.id}"]`)).toBeNull();
    handle.dispose();
  });

  it("组根视图：panel 行带下钻箭头（row-chevron），action 行不带（scene 组）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => ["/m/b.ysm"] }));
    const actItem = {
      id: "act",
      icon: "⚡",
      labelKey: "",
      fallback: "执行动作",
      kind: "action" as const,
      dockGroup: "scene" as const,
      run: vi.fn(),
    };
    handle.setAdapterItems([actItem]);
    const sceneBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-scene"]`);
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    // scene 组项含 lighting/shadow/postproc（panel）+ 注入 act（action）→ 组根视图
    const litItem = CORE_MENU_ITEMS.find((d) => d.id === "lighting")!;
    const litRow = overlay.querySelector(`[data-testid="preview-${litItem.id}"]`);
    expect(litRow!.querySelector('[data-testid="row-chevron"]')).not.toBeNull();
    // 注入的 action 行 → 无箭头（点击直接执行）
    const actRow = overlay.querySelector(`[data-testid="preview-${actItem.id}"]`);
    expect(actRow!.querySelector('[data-testid="row-chevron"]')).toBeNull();
    handle.dispose();
  });

  it("环境拆组：有 env cap → dock-env 独立出现；scene 组不再含 environment 行", () => {
    const cap = { getMenuControls: () => [] } as unknown as SceneCapability;
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/b.ysm"],
      getCap: (id) => (id === "sky" ? cap : null),
    }));
    const envGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "env")!.id;
    expect(overlay.querySelector(`[data-testid="dock-${envGroupId}"]`)).not.toBeNull();
    // scene 组点击 → environment 已拆离（env 组），camera 已在 scene 组
    const sceneBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-scene"]`);
    expect(sceneBtn).not.toBeNull();
    sceneBtn!.click();
    // environment / camera 从 CORE_MENU_ITEMS 推导 testId
    const envId = CORE_MENU_ITEMS.find((d) => d.id === "environment")!.id;
    const camId = CORE_MENU_ITEMS.find((d) => d.id === "camera")!.id;
    // camera 属 scene 组 → scene 组内可见；environment 属 env 组 → scene 组内不出现
    expect(overlay.querySelector(`[data-testid="preview-${camId}"]`)).not.toBeNull();
    expect(overlay.querySelector(`[data-testid="preview-${envId}"]`)).toBeNull();
    handle.dispose();
  });

  it("setAdapterItems 注入 motion 组项 → dock-motion 按钮出现", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    const motionGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "motion")!.id;
    // camera 已迁 scene 组，motion 组无注入项 → dock-motion 初始不存在
    expect(overlay.querySelector(`[data-testid="dock-${motionGroupId}"]`)).toBeNull();
    handle.setAdapterItems([
      {
        id: "play",
        icon: "▶️",
        labelKey: "",
        fallback: "播放",
        kind: "panel",
        dockGroup: "motion",
        renderCustom: () => {},
      },
    ]);
    expect(overlay.querySelector(`[data-testid="dock-${motionGroupId}"]`)).not.toBeNull();
    handle.dispose();
  });

  it("openPanel(id) 直接打开指定面板（骨骼拾取联动契约）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    handle.setAdapterItems([
      {
        id: "bones",
        icon: "🦴",
        labelKey: "preview.section.bones",
        fallback: "骨骼",
        kind: "panel",
        dockGroup: "model",
        renderCustom: (l) => {
          l.append("BONES-PANEL");
        },
      },
    ]);
    handle.openPanel("bones");
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    expect(overlay.textContent).toContain("BONES-PANEL");
    handle.dispose();
  });

  it("dispose 移除菜单 DOM + 解绑 document 监听", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    handle.dispose();
    expect(overlay.querySelector(".ysm-preview-menu")).toBeNull();
    expect(overlay.querySelector(".preview-dock-nav")).toBeNull();
    document.body.click();
  });

  it("dispose 清环境订阅（cap 单例不持有过期 menu 引用）", () => {
    // 进入环境面板 → rebuildEnvSubs 订阅 cap；dispose → disposeEnvSubscriptions 退订全部
    const unsub = vi.fn();
    const subscribe = vi.fn(() => unsub);
    const cap = { getMenuControls: () => [], subscribe } as unknown as SceneCapability;
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getCap: (id) => (id === "sky" ? cap : null),
    }));
    overlay.querySelector<HTMLElement>('[data-testid="dock-env"]')!.click();
    expect(subscribe).toHaveBeenCalled();
    handle.dispose();
    expect(unsub).toHaveBeenCalled();
  });

  it("dispose 清 folder 折叠态（render.ts 模块级 Map 不残留到下次 mount）", () => {
    // 面板带 folder（defaultOpen: false = 默认折叠）；先展开记折叠态 → dispose → 重挂载应回默认折叠
    const folderPanel = {
      id: "folder-panel",
      kind: "panel" as const,
      dockGroup: "model" as const,
      children: [
        {
          id: "fld",
          kind: "folder" as const,
          fallback: "组",
          defaultOpen: false,
          children: [{ id: "leaf", kind: "field" as const, value: "x" }],
        },
      ],
    };
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    handle.setAdapterItems([folderPanel]);
    handle.openPanel("folder-panel");
    const header = overlay.querySelector('[data-testid="fld"] .cap-section-header') as HTMLElement;
    header.click();
    expect(
      (overlay.querySelector('[data-testid="fld-body"]') as HTMLElement).style.display,
    ).toBe("block");
    handle.dispose();
    // 重挂载同一面板 → 折叠态记忆已清空，回 defaultOpen（折叠）
    const handle2 = mountPreviewRootMenu(overlay, makeCtx());
    handle2.setAdapterItems([folderPanel]);
    handle2.openPanel("folder-panel");
    expect(
      (overlay.querySelector('[data-testid="fld-body"]') as HTMLElement).style.display,
    ).toBe("none");
    handle2.dispose();
  });

  it("setAdapterItems 重复 id / 与 CORE_MENU_ITEMS 冲突 → 抛错阻断（ADR-085 S1）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx());
    expect(() =>
      handle.setAdapterItems([
        { id: "dup", kind: "panel" as const, dockGroup: "model" as const },
        { id: "dup", kind: "panel" as const, dockGroup: "model" as const },
      ]),
    ).toThrow(/重复 id/);
    expect(() =>
      handle.setAdapterItems([{ id: "roles", kind: "panel" as const, dockGroup: "model" as const }]),
    ).toThrow(/与 CORE_MENU_ITEMS 冲突/);
    handle.dispose();
  });

  it("角色面板加载入口：无 siblings → 显示空态（路径输入仍在，类型 tab 由 adapter 注入）", () => {
    const handle = mountPreviewRootMenu(overlay, makeCtx({ getSiblings: () => [] }));
    const modelGroupId = PREVIEW_MENU_GROUPS.find((g) => g.id === "model")!.id;
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-${modelGroupId}"]`);
    expect(modelBtn).not.toBeNull();
    // 模型组仅 roles 一个 core 项 → 单 panel 快捷直达角色面板（内嵌加载入口）
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 空态提示
    expect(overlay.textContent).toContain("无其他模型");
    handle.dispose();
  });

  it("角色面板加载入口：siblings 存在 → 列兄弟项", () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    const popup = overlay.querySelector(".ysm-preview-menu") as HTMLElement;
    expect(popup.style.display).toBe("flex");
    // 兄弟项渲染
    expect(popup.querySelectorAll('[data-testid^="preview-switch-cand-"]').length).toBe(2);
    // 点击兄弟项 → switchTo（整行 action；选 b = 第二个候选行）
    const rows = popup.querySelectorAll<HTMLElement>('[data-testid^="preview-switch-cand-"]');
    rows[1].click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.ysm");
    handle.dispose();
  });

  it("switch 面板：候选行带 ➕ 追加按钮，点击追加 → switchTo keepInScene（多角色同框）", () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // 当前项（/m/a.ysm）无 ➕，兄弟项（/m/b.ysm）有 ➕
    const appendBtns = overlay.querySelectorAll('[data-testid^="preview-switch-cand-"] [data-testid="row-badge"]');
    expect(appendBtns.length).toBe(1);
    (appendBtns[0] as HTMLElement).click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.ysm", { keepInScene: true });
    handle.dispose();
  });

  it("角色面板加载入口：跨类型兄弟行有 ➕（走 switchExternal 同台追加）", () => {
    const switchTo = vi.fn();
    const switchExternal = vi.fn(async () => {});
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.vrm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      switchTo,
      switchExternal,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // /m/b.vrm 是跨类型兄弟：有 ➕，但点击走 switchExternal keepInScene（openModel3DFullscreen
    // cooperate → switchPreview 主门按类型路由同台追加，ADR-093 T4）——不喂给当前 ysm adapter
    const appendBtns = overlay.querySelectorAll('[data-testid^="preview-switch-cand-"] [data-testid="row-badge"]');
    expect(appendBtns.length).toBe(1);
    (appendBtns[0] as HTMLElement).click();
    expect(switchExternal).toHaveBeenCalledWith("/m/b.vrm", ["/m/a.ysm", "/m/b.vrm"], { keepInScene: true });
    expect(switchTo).not.toHaveBeenCalled();
    // 行本体点击仍是跨类型替换（switchExternal，无 keepInScene）——重建语义不变
    const rows = overlay.querySelectorAll('[data-testid^="preview-switch-cand-"]');
    (rows[1] as HTMLElement).click();
    expect(switchExternal).toHaveBeenCalledWith("/m/b.vrm", ["/m/a.ysm", "/m/b.vrm"]);
    handle.dispose();
  });

  it("角色面板加载入口：类型 tab 同类型候选有 ➕，点击追加 → switchTo keepInScene", async () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => ["/m/b.ysm"],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // 切到 ysm 类型 tab（与当前会话同类型）
    switchSelectTo(overlay, "ysm");
    await vi.waitFor(() => {
      expect(overlay.querySelectorAll('[data-testid^="preview-switch-cand-"]').length).toBe(1);
    });
    // 同类型候选：有 ➕；点击追加 → keepInScene
    const appendBtn = overlay.querySelector('[data-testid^="preview-switch-cand-"] [data-testid="row-badge"]') as HTMLElement;
    expect(appendBtn).not.toBeNull();
    appendBtn.click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.ysm", { keepInScene: true });
    handle.dispose();
  });

  it("角色面板加载入口：类型 tab 跨类型候选行有 ➕（走 switchExternal 同台追加）", async () => {
    const switchTo = vi.fn();
    const switchExternal = vi.fn(async () => {});
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => ["/m/x.vrm"],
      switchTo,
      switchExternal,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // 切到 vrm 类型 tab（懒加载候选）
    switchSelectTo(overlay, "vrm");
    await vi.waitFor(() => {
      expect(overlay.querySelectorAll('[data-testid^="preview-switch-cand-"]').length).toBe(1);
    });
    // 跨类型候选：有 ➕，点击走 switchExternal keepInScene（switchPreview 主门
    // 按类型路由同台追加，ADR-093 T4）——不喂给当前 ysm adapter
    const appendBtn = overlay.querySelector('[data-testid^="preview-switch-cand-"] [data-testid="row-badge"]') as HTMLElement;
    expect(appendBtn).not.toBeNull();
    appendBtn.click();
    expect(switchExternal).toHaveBeenCalledWith("/m/x.vrm", ["/m/a.ysm"], { keepInScene: true });
    expect(switchTo).not.toHaveBeenCalled();
    // 行本体点击仍是跨类型替换（switchExternal）
    (overlay.querySelector('[data-testid^="preview-switch-cand-"]') as HTMLElement).click();
    expect(switchExternal).toHaveBeenCalledWith("/m/x.vrm", ["/m/a.ysm"]);
    handle.dispose();
  });

  it("角色面板加载入口：当前目录 tab 歧义 .json 同源候选回退 switchTo（不复建）", () => {
    const switchTo = vi.fn();
    const switchExternal = vi.fn(async () => {});
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.json"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      switchTo,
      switchExternal,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // /m/b.json 是歧义扩展名（resolveTypeSafe 返回 null），但 siblings 即同目录兄弟契约，
    // 应回退为同源 → 行本体走 switchTo 复用外壳替换（不触发 switchExternal 重建）
    const rows = overlay.querySelectorAll('[data-testid^="preview-switch-cand-"]');
    (rows[1] as HTMLElement).click();
    expect(switchTo).toHaveBeenCalledWith("/m/b.json");
    expect(switchExternal).not.toHaveBeenCalled();
    handle.dispose();
  });

  it("类型 tab 全局记忆：默认高亮上次点击的类型（localStorage 持久化）", async () => {
    const switchTo = vi.fn();
    localStorage.setItem("ysm.preview.lastRtype", "vrm");
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => ["/m/x.vrm"],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // ADR-193 第四刀：tab = select，记忆持久化 → 默认选中 vrm
    expect(switchSelectedTab(overlay)).toBe("vrm");
    expect(switchTabHighlightBg(true)).toContain("var(--accent)");
    expect(switchTabHighlightBg(false)).toBe("transparent");
    await vi.waitFor(() => {
      expect(overlay.querySelectorAll('[data-testid^="preview-switch-cand-"]').length).toBe(1);
    });
    handle.dispose();
  });

  it("类型 tab 默认高亮：记忆越界但当前模型类型在 tabs → 高亮当前类型（非当前目录）", () => {
    const switchTo = vi.fn();
    // 记忆一个越界类型（如之前看过的 litematic），但当前模型是 ysm
    localStorage.setItem("ysm.preview.lastRtype", "litematic");
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => [],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // 当前类型 ysm 高亮（记忆越界不污染）；当前目录 tab 已根除——加载角色路径限定，不容其他
    expect(switchTabHighlightBg(true)).toContain("var(--accent)");
    expect(switchSelectedTab(overlay)).toBe("ysm");
    handle.dispose();
  });

  it("类型 tab 默认高亮：记忆与当前类型均越界 → 高亮第一个类型 tab（无当前目录 tab）", () => {
    const switchTo = vi.fn();
    localStorage.setItem("ysm.preview.lastRtype", "litematic");
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "unknown-rtype",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => [],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // 记忆与当前类型都不在 tabs → 选中第一个类型 tab（ysm）
    expect(switchSelectedTab(overlay)).toBe("ysm");
    expect(switchTabHighlightBg(true)).toContain("var(--accent)");
    handle.dispose();
  });

  it("类型 tab 默认高亮：无记忆 + 当前类型在 tabs → 直接高亮当前类型", () => {
    const switchTo = vi.fn();
    const handle = mountPreviewRootMenu(overlay, makeCtx({
      getSiblings: () => ["/m/a.ysm", "/m/b.ysm"],
      getCurrentPath: () => "/m/a.ysm",
      getCurrentRtype: () => "ysm",
      getTypeTabs: () => ["ysm", "vrm"],
      getModelsByType: async () => [],
      switchTo,
    }));
    const modelBtn = overlay.querySelector<HTMLElement>(`[data-testid="dock-model"]`);
    modelBtn!.click();
    // 开 YSM 模型默认就选中 YSM（你反馈的核心痛点）
    expect(switchSelectedTab(overlay)).toBe("ysm");
    expect(switchTabHighlightBg(true)).toContain("var(--accent)");
    handle.dispose();
  });
});

