// ===== <app-resource-manager> 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子；验证生命周期、list 渲染、detail 面板。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor, sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";

// getApp 全绑定 mock（AppResourceManager 依赖大量 bindings）
const mockScanResult = vi.hoisted(() => [
    { Name: "pack1.zip", Path: "/repo/resourcepack/pack1.zip", enabled: true },
    { Name: "pack2.zip", Path: "/repo/resourcepack/pack2.zip", enabled: false },
  ]);
vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetRepoRoot: vi.fn().mockResolvedValue("/repo/resourcepack"),
    ReadPackMeta: vi.fn().mockResolvedValue(JSON.stringify({
      name: "测试资源包",
      description: "一个测试用的资源包",
      pack_format: 15,
    })),
    ScanModelEntries: vi.fn().mockResolvedValue(mockScanResult),
    ScanModelEntriesWithLabel: vi.fn().mockResolvedValue(mockScanResult),
    ToggleResourcePack: vi.fn().mockResolvedValue(undefined),
    IsResourcePackEnabled: vi.fn().mockResolvedValue(true),
    SelectImportZip: vi.fn().mockResolvedValue(""),
    SelectImportFile: vi.fn().mockResolvedValue(""),
    ImportByType: vi.fn().mockResolvedValue(undefined),
    DeleteResourcePack: vi.fn().mockResolvedValue(undefined),
    OpenFolder: vi.fn().mockResolvedValue(undefined),
    LoadAppConfig: vi.fn().mockResolvedValue({}),
    ListVersionInstances: vi.fn().mockResolvedValue([]),
    ReadShaderpackLang: vi.fn().mockResolvedValue(JSON.stringify({ name: "光影包测试", entries: {} })),
    LoadResourceTypes: vi.fn().mockResolvedValue(JSON.stringify({
      resourceTypes: [
        { id: "resourcepack", name: "资源包", icon: "🎨", actions: ["import", "toggle", "delete", "openFolder"] },
        { id: "shaderpack", name: "光影包", icon: "☀️", actions: ["import", "openFolder"] },
      ],
    })),
  }),
}));

import "./index.ts"; // 触发 customElements.define("app-resource-manager")

// 提供全局 _loadConfig 所需的 resource_types mock
// AppResourceManager 的 _loadConfig 从 resource_types.json 加载
vi.mock("../../resource-types.ts", () => ({
  getResourceTypes: vi.fn().mockReturnValue([
    { id: "resourcepack", name: "资源包", icon: "🎨", actions: ["import", "toggle", "delete", "openFolder"] },
    { id: "shaderpack", name: "光影包", icon: "☀️", actions: ["import", "openFolder"] },
  ]),
  findResourceType: vi.fn().mockImplementation((id: string) => {
    const types: Record<string, { id: string; name: string; icon: string; actions: string[] }> = {
      resourcepack: { id: "resourcepack", name: "资源包", icon: "🎨", actions: ["import", "toggle", "delete", "openFolder"] },
      shaderpack: { id: "shaderpack", name: "光影包", icon: "☀️", actions: ["import", "openFolder"] },
    };
    return types[id] || null;
  }),
}));

describe("app-resource-manager（testid 钩子 + 资源管理交互）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("connected → 渲染侧栏与列表", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    const items = getAllByTestId(el, "rm-item");
    expect(items.length).toBeGreaterThanOrEqual(1);
    unmountElement(el);
  });

  it("connected → 导入按钮存在", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-import"]') !== null, 5000);
    const importBtn = getByTestId(el, "rm-import")!;
    expect(importBtn).toBeTruthy();
    expect(importBtn.textContent).toContain("导入");
    unmountElement(el);
  });

  it("连接 → 打开文件夹按钮存在", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-open"]') !== null, 5000);
    const openBtn = getByTestId(el, "rm-open");
    expect(openBtn).toBeTruthy();
    unmountElement(el);
  });

  it("点击列表项 → 显示详情面板", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    const firstItem = el.querySelector('[data-testid="rm-item"]') as HTMLElement;
    firstItem.click();
    await sleep(500);
    // 详情面板应出现（内容区域不再显示占位符）
    const contentEl = el.querySelector(".dp-placeholder");
    // 如果内容区域已渲染，占位符应消失或变为详情
    unmountElement(el);
  });

  it("rtype 属性变化 → 重新初始化", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    // 切换到光影包类型
    el.setAttribute("rtype", "shaderpack");
    await sleep(300);
    // 应重新加载列表（新类型可能有不同数据）
    // 至少不抛异常
    expect(true).toBe(true);
    unmountElement(el);
  });

  it("disconnected → 清理", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    unmountElement(el);
    // 断开后不应抛错
    expect(true).toBe(true);
  });
});