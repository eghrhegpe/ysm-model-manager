// ===== renderMenu 新 kind 测试：field / button / row / sectionTitle =====
import { describe, it, expect, beforeEach } from "vitest";
import { renderMenu } from "./preview-menu.ts";
import type { PreviewMenuNode } from "./preview-menu-node-types.ts";
import type { SlideMenuHandle } from "../../../ui/ui-slide-menu.ts";

function makeDeps(): {
  makeRow: (def: never) => HTMLElement;
  makePanelView: (def: never) => { title: string; render: (l: HTMLElement) => void };
  menu: SlideMenuHandle;
} {
  return {
    makeRow: (def: any) => {
      const row = document.createElement("div");
      if (def.id) row.dataset.testid = "preview-" + def.id;
      if (def.legacyTestId) row.id = def.legacyTestId;
      return row;
    },
    makePanelView: () => ({ title: "", render: () => {} }) as any,
    menu: {
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
    } as unknown as SlideMenuHandle,
  } as any;
}

describe("renderMenu 新 kind", () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it("field: 渲染键值对行，有 data-testid", () => {
    const nodes: PreviewMenuNode[] = [
      { id: "stat-bones", kind: "field", labelKey: "preview.section.bones", value: 128 },
      { id: "stat-cubes", kind: "field", labelKey: "preview.cubes", value: 512 },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.querySelector('[data-testid="preview-stat-bones"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="preview-stat-cubes"]')).not.toBeNull();
    const bonesRow = container.querySelector('[data-testid="preview-stat-bones"]') as HTMLElement;
    expect(bonesRow.textContent).toContain("128");
  });

  it("button: 渲染操作按钮行", () => {
    const clicked: string[] = [];
    const nodes: PreviewMenuNode[] = [
      { id: "shot-current", kind: "button", labelKey: "preview.screenshotCurrent", icon: "📷", action: () => { clicked.push("current"); } },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const btn = container.querySelector('[data-testid="preview-shot-current"]') as HTMLElement;
    expect(btn).not.toBeNull();
    // 渲染本身不应执行 action，点击时才触发
    expect(clicked).toEqual([]);
    btn!.click();
    expect(clicked).toEqual(["current"]);
  });

  it("row: 渲染动态列表行", () => {
    const nodes: PreviewMenuNode[] = [
      { id: "tex-0", kind: "row", labelKey: "skin.png", value: "64x64" },
      { id: "tex-1", kind: "row", labelKey: "eyes.png", value: "128x128" },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.querySelector('[data-testid="preview-tex-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="preview-tex-1"]')).not.toBeNull();
  });

  it("sectionTitle: 渲染小标题行", () => {
    const nodes: PreviewMenuNode[] = [
      { id: "sec-stats", kind: "sectionTitle", labelKey: "preview.statsSection" },
      { id: "stat-bones", kind: "field", labelKey: "preview.section.bones", value: 10 },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.querySelector('[data-testid="sec-stats"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="preview-stat-bones"]')).not.toBeNull();
  });

  it("folder: 默认展开（defaultOpen=true），body 可见", () => {
    const nodes: PreviewMenuNode[] = [
      {
        id: "folder-1",
        kind: "folder",
        labelKey: "preview.folder",
        fallback: "文件夹",
        defaultOpen: true,
        children: [
          { id: "child-1", kind: "field", labelKey: "preview.child", value: "val" },
        ],
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const body = container.querySelector('[data-testid="folder-1-body"]') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.style.display).toBe("block");
    expect(container.querySelector('[data-testid="preview-child-1"]')).not.toBeNull();
  });

  it("folder: 默认折叠（defaultOpen=false），点击 header 展开", () => {
    const nodes: PreviewMenuNode[] = [
      {
        id: "folder-2",
        kind: "folder",
        labelKey: "preview.folder",
        fallback: "文件夹",
        defaultOpen: false,
        children: [
          { id: "child-2", kind: "field", labelKey: "preview.child", value: "val" },
        ],
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const body = container.querySelector('[data-testid="folder-2-body"]') as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.style.display).toBe("none");
    // 点击 header 展开
    const header = container.querySelector('.cap-section-header') as HTMLElement;
    header.click();
    expect(body.style.display).toBe("block");
    expect(container.querySelector('[data-testid="preview-child-2"]')).not.toBeNull();
  });

  it("folder: 空 children 不渲染 section", () => {
    const nodes: PreviewMenuNode[] = [
      { id: "empty-folder", kind: "folder", children: [] },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.querySelector('[data-testid="empty-folder"]')).toBeNull();
  });

  it("visibleWhen: 返回 false 时节点不渲染", () => {
    const nodes: PreviewMenuNode[] = [
      { id: "hidden", kind: "field", labelKey: "preview.hidden", value: "x", visibleWhen: () => false },
      { id: "visible", kind: "field", labelKey: "preview.visible", value: "y", visibleWhen: () => true },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.querySelector('[data-testid="preview-hidden"]')).toBeNull();
    expect(container.querySelector('[data-testid="preview-visible"]')).not.toBeNull();
  });

  it("[doc:adr-126-p4-d] visibleWhen 吃状态层快照：谓词读 snapshot 值做条件", () => {
    // 谓词签名是 (s: PreviewSnapshot) => boolean——渲染器传 previewSnapshot()，
    // 谓词可读快照中的路径值（render.maxFps 等）。此处用假快照验证谓词被传参调用。
    let received: unknown;
    const nodes: PreviewMenuNode[] = [
      {
        id: "gated",
        kind: "field",
        labelKey: "preview.gated",
        value: "x",
        visibleWhen: (s) => {
          received = s;
          return true;
        },
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    // 谓词收到了快照对象（Record<PreviewStatePath, unknown>）
    expect(received).toBeTypeOf("object");
    expect(received as Record<string, unknown>).toHaveProperty("render.maxFps");
    expect(container.querySelector('[data-testid="preview-gated"]')).not.toBeNull();
  });

  it("deep nesting: 3 层文件夹递归渲染", () => {
    const nodes: PreviewMenuNode[] = [
      {
        id: "l1",
        kind: "folder",
        children: [
          {
            id: "l2",
            kind: "folder",
            children: [
              { id: "l3-leaf", kind: "field", labelKey: "preview.leaf", value: "deep" },
            ],
          },
        ],
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.querySelector('[data-testid="l1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="l1-body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="l2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="l2-body"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="preview-l3-leaf"]')).not.toBeNull();
  });

  it("divider: 渲染分隔线", () => {
    const nodes: PreviewMenuNode[] = [
      { id: "sep-1", kind: "divider" },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.querySelector('[data-testid="sep-1"]')).not.toBeNull();
  });

  it("action: 渲染可点击行，点击触发 action", () => {
    const clicked: string[] = [];
    const nodes: PreviewMenuNode[] = [
      { id: "act-close", kind: "action", labelKey: "preview.close", icon: "✕", action: () => { clicked.push("close"); } },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const row = container.querySelector('[data-testid="preview-act-close"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(clicked).toEqual([]);
    row.click();
    expect(clicked).toEqual(["close"]);
  });

  it("custom: 渲染自定义内容（renderCustom 逃生舱）", () => {
    const nodes: PreviewMenuNode[] = [
      {
        id: "custom-area",
        kind: "custom",
        renderCustom: (list) => {
          const d = document.createElement("div");
          d.textContent = "custom content";
          list.appendChild(d);
        },
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    // custom 节点被 renderMenu 转为 panel 行，不会直接渲染内容
    // 这是过渡期行为，custom 节点最终应通过 renderSchemaContent 渲染
    const row = container.querySelector('[data-testid="preview-custom-area"]') as HTMLElement;
    expect(row).not.toBeNull();
  });
});
