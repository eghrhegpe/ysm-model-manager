// ===== 环境菜单声明式 Schema 测试（对齐 MikuMikuAR getSkySchema() 范式）=====
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildEnvSchema, renderEnvLevel } from "./preview-menu-env.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { PreviewMenuCtx } from "./preview-menu.ts";
import type { SlideMenuHandle } from "../../../ui/ui-slide-menu.ts";

/** 构造最小 PreviewMenuCtx（测试用） */
function makeCtx(overrides: Partial<PreviewMenuCtx> = {}): PreviewMenuCtx {
  return {
    selfMode: false,
    getCap: () => null,
    getCamBridge: () => ({ mode: "orbit" as const, setMode: vi.fn(), reset: vi.fn() }) as never,
    getSiblings: () => [],
    getCurrentPath: () => "",
    getViewContainer: () => document.createElement("div"),
    close: vi.fn(),
    ...overrides,
  } as PreviewMenuCtx;
}

/** 构造 fake SlideMenuHandle */
function makeMenu(): SlideMenuHandle {
  const views: Array<{ title: string; render: (list: HTMLElement) => void }> = [];
  return {
    root: document.createElement("div"),
    list: document.createElement("div"),
    setTitle: vi.fn(),
    setOnClose: vi.fn(),
    home: vi.fn(),
    navigate: vi.fn((v) => views.push(v)),
    back: vi.fn(),
    refresh: vi.fn(),
    isShowing: vi.fn(),
    reset: vi.fn(),
    isAtRoot: () => true,
    dispose: vi.fn(),
  } as unknown as SlideMenuHandle;
}

describe("buildEnvSchema", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("无 cap 时返回空态节点", () => {
    const schema = buildEnvSchema(makeCtx());
    expect(schema.length).toBe(1);
    expect(schema[0].id).toBe("env-empty");
    expect(schema[0].kind).toBe("custom");
  });

  it("有 sky cap 时返回预设栏 + sky 摘要节点", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-time", kind: "slider", labelKey: "preview.timeOfDay", fallback: "时间", getValue: () => 12, setValue: () => {}, slider: { min: 0, max: 24, step: 0.25, unit: "h" } },
        { id: "sky-cloud", kind: "slider", labelKey: "preview.cloudCoverage", fallback: "云量", getValue: () => 0, setValue: () => {}, slider: { min: 0, max: 1, step: 0.01 } },
      ],
      apply: vi.fn(),
      dispose: vi.fn(),
      setEnabled: vi.fn(),
      isEnabled: () => true,
      saveState: vi.fn(),
      loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const schema = buildEnvSchema(ctx);
    expect(schema.length).toBeGreaterThanOrEqual(2);
    expect(schema[0].id).toBe("env-presets");
    const skyNode = schema.find((n) => n.id === "env:sky");
    expect(skyNode).toBeDefined();
    expect(skyNode!.kind).toBe("custom");
    expect(skyNode!.icon).toBe("🌤️");
  });
});

describe("renderEnvLevel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    
  });

  it("无 menu 句柄时走平铺路径（renderCapControls）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-toggle", kind: "toggle", labelKey: "preview.skyEnabled", fallback: "天空", getValue: () => true, setValue: () => {} },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, undefined);
    // 平铺路径：应有 cap-sky-toggle 控件行
    expect(list.querySelector('[data-testid="cap-sky-toggle"]')).not.toBeNull();
  });

  it("有 menu 句柄时渲染预设栏 + cap 摘要行", () => {
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-time", kind: "slider", labelKey: "preview.timeOfDay", fallback: "时间", getValue: () => 12, setValue: () => {}, slider: { min: 0, max: 24, step: 0.25, unit: "h" } },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const menu = makeMenu();
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    // 预设按钮存在
    expect(list.querySelector('[data-testid="env-preset-studio"]')).not.toBeNull();
    expect(list.querySelector('[data-testid="env-preset-sunset"]')).not.toBeNull();
    // cap 摘要行存在
    expect(list.querySelector('[data-testid="cap-row-sky"]')).not.toBeNull();
  });

  it("cap 摘要行有 › 时点击触发 menu.navigate", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [
        { id: "sky-toggle", kind: "toggle", labelKey: "preview.skyEnabled", fallback: "天空", getValue: () => true, setValue: () => {} },
        { id: "sky-time", kind: "slider", labelKey: "preview.timeOfDay", fallback: "时间", getValue: () => 12, setValue: () => {}, slider: { min: 0, max: 24, step: 0.25, unit: "h" } },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const menu = makeMenu();
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    const row = list.querySelector('[data-testid="cap-row-sky"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.cursor).toBe("pointer");
    expect(row.querySelector('[data-testid="row-chevron"]')).not.toBeNull();
    row.click();
    expect(menu.navigate).toHaveBeenCalled();
  });

  it("带 group 分区的 cap 子视图列出平级分区入口，水面独立下钻（方案 A）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeGroundCap = {
      id: "ground",
      labelKey: "preview.ground",
      icon: "🌐",
      descKey: "",
      getMenuControls: () => [
        { id: "ground-visible", kind: "toggle", labelKey: "preview.ground", fallback: "地面", getValue: () => true, setValue: () => {} },
        { id: "ground-water-enabled", kind: "toggle", labelKey: "preview.groundWaterEnabled", fallback: "水面", group: "preview.groundGroupWater", getValue: () => true, setValue: () => {} },
        { id: "ground-water-mode", kind: "select", labelKey: "preview.groundWaterMode", fallback: "形态", group: "preview.groundGroupWater", select: [{ value: "film", label: "薄膜" }], getValue: () => "film", setValue: () => {} },
        { id: "ground-mat-source", kind: "select", labelKey: "preview.groundMatSource", fallback: "材质", group: "preview.groundGroupMaterial", select: [{ value: "none", label: "无" }], getValue: () => "none", setValue: () => {} },
      ],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "ground" ? (fakeGroundCap as never) : null) });
    // 自定义 menu：navigate 立即把 view.render 落到 subList，便于断言子视图 DOM
    const subList = document.createElement("div");
    let lastTitle = "";
    const menu = {
      ...makeMenu(),
      navigate: vi.fn((v: { title: string; render: (l: HTMLElement) => void }) => { lastTitle = v.title; v.render(subList); }),
    } as unknown as SlideMenuHandle;

    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    const row = list.querySelector('[data-testid="cap-row-ground"]') as HTMLElement;
    expect(row).not.toBeNull();
    row.click();

    // 子视图应列出三个平级分区入口（地面 / 水面 / 表面材质）
    expect(subList.querySelector('[data-testid="cap-group-entry-base"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.groundGroupWater"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-group-entry-preview.groundGroupMaterial"]')).not.toBeNull();
    expect(lastTitle).toBe("地面");

    // 点「水面」入口 → 二级子视图仅含水面控件，且不再包同名 section
    const waterEntry = subList.querySelector('[data-testid="cap-group-entry-preview.groundGroupWater"]') as HTMLElement;
    waterEntry.click();
    expect(subList.querySelector('[data-testid="cap-ground-water-enabled"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-ground-water-mode"]')).not.toBeNull();
    expect(subList.querySelector('[data-testid="cap-ground-visible"]')).toBeNull();
    expect(lastTitle).toBe("水面");
  });

  it("预设按钮点击调用 applyPreset（通过 menu.refresh）", () => {
    vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([]);
    const fakeSkyCap = {
      id: "sky",
      labelKey: "preview.sky",
      icon: "🌤️",
      descKey: "",
      getMenuControls: () => [],
      apply: vi.fn(), dispose: vi.fn(), setEnabled: vi.fn(), isEnabled: () => true, saveState: vi.fn(), loadState: vi.fn(),
    };
    const ctx = makeCtx({ getCap: (id) => (id === "sky" ? (fakeSkyCap as never) : null) });
    const menu = makeMenu();
    const list = document.createElement("div");
    renderEnvLevel(list, ctx, menu);

    const btn = list.querySelector('[data-testid="env-preset-studio"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn!.click();
    expect(menu.refresh).toHaveBeenCalled();
  });
});
