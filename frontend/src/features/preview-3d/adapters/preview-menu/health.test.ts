// ===== 菜单健康冒烟测试（ADR-128 落地前哨）=====
//
// 设计意图：check-menu-health.mjs 是正则静态扫 4 个菜单表文件（id/labelKey/dockGroup/kind/
// 渲染通道）——它**不执行任何 builder**，因此「builder 抛错 → 面板渲染失败」、「builder 返回空
// → 断渲染」、「面板声明了却无任何渲染通道（未迁移/漏接线）」三类破损它一概看不见。
//
// 本测试补足这块盲区：复用生产级 renderPreviewPanel + buildPreviewMenuRouters（导出缝，零行为变更），
// 真正把每个常驻 dock 面板跑一遍渲染，断言① 解析契约（必有渲染通道）② 渲染非空 ③ 未抛错
// （无「面板渲染失败」错误行、无 console.error）。跑在 vitest 日常集，AI 本地改菜单只跑 vitest 即被拦，
// 不必等 doctor 闸门才暴露。
//
// 范围：常驻 dock 面板（lighting/shadow/postproc/settings/camera/environment/roles）+ close 动作
// + 运行时 registerSchema 路径。适配器面板（model/mmd/vrm 经 children/renderCustom 注入）需加载模型，
// 留待 ADR-128 collectMenuGraph 收口后统一覆盖。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CORE_MENU_ITEMS } from "./defs.ts";
import {
  buildPreviewMenuRouters,
  renderPreviewPanel,
  type PreviewMenuRouters,
} from "./core.ts";
import { getSchema, listSchemas, registerSchema, resetSchemas } from "../schema-registry.ts";
import { previewSnapshot } from "../../state/preview-state.ts";
import type { PreviewMenuNode } from "./node-types.ts";
import { makeMenuCtx as makeCtx, mockMenuHandle as mockMenu } from "../menu-test-fixtures.ts";

function mockPanelDeps() {
  return {
    makeRow: (n: any) => {
      const d = document.createElement("div");
      if (n?.id) d.dataset.testid = "preview-" + n.id;
      return d;
    },
    makePanelView: (n: any) => ({ title: n?.id ?? "", render: () => {} }) as any,
  };
}

describe("常驻 dock 面板解析契约", () => {
  it("每个 CORE_MENU_ITEMS panel 节点至少命中一条渲染通道（防「未迁移/漏接线」断渲染）", () => {
    const routers: PreviewMenuRouters = buildPreviewMenuRouters(
      makeCtx(),
      () => {},
      mockMenu(),
      { toast: vi.fn(), closeAllOverlays: vi.fn() },
      { handle: null } as unknown as Parameters<typeof buildPreviewMenuRouters>[4],
    );
    const snapshot = previewSnapshot();
    for (const node of CORE_MENU_ITEMS) {
      if (node.kind !== "panel") continue;
      const hasChannel =
        !!routers.schemaBuilders[node.id] ||
        !!getSchema(node.schemaId ?? node.id) ||
        (node.children?.length ?? 0) > 0 ||
        !!node.renderCustom ||
        !!node.action ||
        !!routers.fillers[node.id];
      expect(hasChannel, `面板 "${node.id}" 无任何渲染通道（未迁移/漏接线）`).toBe(true);
    }
  });

  it("runners 动作入口均为可调函数", () => {
    const routers = buildPreviewMenuRouters(
      makeCtx(),
      () => {},
      mockMenu(),
      { toast: vi.fn(), closeAllOverlays: vi.fn() },
      { handle: null } as unknown as Parameters<typeof buildPreviewMenuRouters>[4],
    );
    for (const id of Object.keys(routers.runners)) {
      expect(typeof routers.runners[id], `runner "${id}" 应为函数`).toBe("function");
    }
  });
});

describe("常驻 dock 面板渲染冒烟", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    document.body.replaceChildren();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("每个常驻面板渲染非空且未抛错（无「面板渲染失败」红字）", () => {
    const ctx = makeCtx();
    const menu = mockMenu();
    const hideMenu = () => {};
    const actionCtx = { toast: vi.fn(), closeAllOverlays: vi.fn() };
    const routers = buildPreviewMenuRouters(ctx, hideMenu, menu, actionCtx, { handle: null } as unknown as Parameters<typeof buildPreviewMenuRouters>[4]);
    const deps = mockPanelDeps();

    const panelIds = [...Object.keys(routers.schemaBuilders), ...Object.keys(routers.fillers)];
    expect(panelIds.length, "至少应覆盖 lighting/shadow/postproc/settings/camera/environment/roles 七面板").toBeGreaterThanOrEqual(7);

    for (const id of panelIds) {
      const node = CORE_MENU_ITEMS.find((d) => d.id === id);
      expect(node, `routers 引用了未在 CORE_MENU_ITEMS 声明的面板 "${id}"`).toBeDefined();
      const list = document.createElement("div");
      renderPreviewPanel(list, node!, routers, menu, hideMenu, actionCtx, deps);
      expect(list.childElementCount, `面板 "${id}" 渲染为空（断渲染）`).toBeGreaterThan(0);
      expect(list.textContent ?? "", `面板 "${id}" 渲染抛错`).not.toContain("面板渲染失败");
    }
    expect(errorSpy, "渲染过程不应有 console.error（含 renderPanel FAILED）").not.toHaveBeenCalled();
  });
});

describe("运行时注册 schema 渲染冒烟（registerSchema 路径）", () => {
  beforeEach(() => resetSchemas());
  afterEach(() => resetSchemas());

  it("每个已注册 schema builder 产出非空、节点 id 唯一、不抛错", () => {
    const ids = listSchemas();
    const snapshot = previewSnapshot();
    for (const id of ids) {
      const builder = getSchema(id)!;
      let nodes: PreviewMenuNode[] = [];
      expect(() => {
        nodes = builder(snapshot);
      }, `schema "${id}" builder 抛错`).not.toThrow();
      expect(Array.isArray(nodes) && nodes.length > 0, `schema "${id}" 产出空面板（断渲染）`).toBe(true);
      const seen = new Set(nodes.map((n) => n.id));
      expect(seen.size, `schema "${id}" 节点 id 重复`).toBe(nodes.length);
    }
  });

  it("自检：guard 能抓出坏 builder（返回空 / 抛错），证明门禁非摆设", () => {
    const snapshot = previewSnapshot();
    // 返回空数组 → 应被判「断渲染」
    registerSchema("selfcheck-empty", () => []);
    const emptyBuilder = getSchema("selfcheck-empty")!;
    let emptyNodes: PreviewMenuNode[] = [];
    expect(() => {
      emptyNodes = emptyBuilder(snapshot);
    }).not.toThrow();
    expect(emptyNodes.length > 0, "guard 应抓出返回空数组的坏 schema").toBe(false);

    // 抛错 → 应被判「抛错」
    registerSchema("selfcheck-throw", () => {
      throw new Error("broken builder");
    });
    const throwBuilder = getSchema("selfcheck-throw")!;
    expect(() => throwBuilder(snapshot), "guard 应抓出抛错的坏 schema").toThrow();
  });
});
