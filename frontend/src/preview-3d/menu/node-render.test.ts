// ===== renderMenu 新 kind 测试：field / button / row / sectionTitle =====
import { describe, it, expect, beforeEach } from "vitest";
import { renderMenu } from "./core.ts";
import type { PreviewMenuNode } from "./node-types.ts";
import type { SlideMenuHandle } from "../../ui/ui-slide-menu.ts";
import { mockMenuHandle } from "../adapters/menu-test-fixtures.ts";

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
    menu: mockMenuHandle(),
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

  it("toggle: 渲染 label + 开关行，点击翻转 control.set", () => {
    let on = false;
    const nodes: PreviewMenuNode[] = [
      {
        id: "perception-breath",
        kind: "toggle",
        labelKey: "preview.perceptionBreath",
        fallback: "呼吸",
        control: { get: () => on, set: (v: unknown) => { on = Boolean(v); } },
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const row = container.querySelector('[data-testid="preview-perception-breath"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("呼吸");
    const btn = row.querySelector("button") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // 点击翻转（control.get 当前值取反 → control.set）
    btn.click();
    expect(on).toBe(true);
    btn.click();
    expect(on).toBe(false);
  });

  it("material-row: 渲染组合控件行（label + eye + slider），eye 点击翻转 / slider 触发 set", () => {
    let visible = true;
    let opacity = 80;
    const nodes: PreviewMenuNode[] = [
      {
        id: "mat-0",
        kind: "material-row",
        labelKey: "Body",
        fallback: "Body",
        eye: { get: () => visible, set: (v: boolean) => { visible = v; } },
        opacity: { get: () => opacity, set: (v: number) => { opacity = v; } },
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const row = container.querySelector('[data-testid="preview-mat-0"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("Body");
    const eye = row.querySelector("button") as HTMLButtonElement;
    eye.click();
    expect(visible).toBe(false);
    const slider = row.querySelector("input[type=range]") as HTMLInputElement;
    expect(slider.value).toBe("80");
    slider.value = "30";
    slider.dispatchEvent(new Event("input"));
    expect(opacity).toBe(30);
    // 整行点击（label 区域）也翻转显隐——对齐旧 buildMaterialControls 的 row.onclick
    row.click();
    expect(visible).toBe(true);
    // 滑条点击不触发整行翻转（op.onclick stopPropagation）
    slider.click();
    expect(visible).toBe(true);
  });

  it("material-row 空态：mat-empty field 渲染提示文本（不落 id 原文）", () => {
    // [doc:adr-126-p5] P2 回归锁：preview.noMaterial 键缺失时 rmAppendField 的 tr 落
    // node.id（mat-empty 原文）——补键后应渲染 locale 文本
    const nodes: PreviewMenuNode[] = [
      { id: "mat-empty", kind: "field", labelKey: "preview.noMaterial", fallback: "（无材质）", value: "" },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const row = container.querySelector('[data-testid="preview-mat-empty"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).not.toContain("mat-empty");
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
      // [doc:adr-126-p4-d] 签名对齐 (s: PreviewSnapshot) => boolean（参数忽略，行为等价）
      { id: "hidden", kind: "field", labelKey: "preview.hidden", value: "x", visibleWhen: (_s) => false },
      { id: "visible", kind: "field", labelKey: "preview.visible", value: "y", visibleWhen: (_s) => true },
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

  it("slider: 渲染 range 行，value 来自 control.get，oninput 触发 set+onChange", () => {
    let val = 40;
    const changed: number[] = [];
    const nodes: PreviewMenuNode[] = [
      {
        id: "layer-slider",
        kind: "slider",
        labelKey: "preview.sliceLayer",
        fallback: "层",
        control: {
          min: 1,
          max: 100,
          get: () => val,
          set: (v: unknown) => { val = Number(v); },
          onChange: (v: unknown) => { changed.push(Number(v)); },
        },
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const row = container.querySelector('[data-testid="preview-layer-slider"]') as HTMLElement;
    expect(row).not.toBeNull();
    const range = row.querySelector('input[type="range"]') as HTMLInputElement;
    expect(range).not.toBeNull();
    expect(range.min).toBe("1");
    expect(range.max).toBe("100");
    expect(range.value).toBe("40");
    range.value = "77";
    range.dispatchEvent(new Event("input"));
    expect(val).toBe(77);
    expect(changed).toEqual([77]);
  });

  it("slider: numeric=true 联动 number 输入框，number onchange 走 min/max clamp", () => {
    let val = 5;
    const nodes: PreviewMenuNode[] = [
      {
        id: "num-slider",
        kind: "slider",
        control: { min: 1, max: 10, get: () => val, set: (v: unknown) => { val = Number(v); }, numeric: true },
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const row = container.querySelector('[data-testid="preview-num-slider"]') as HTMLElement;
    const range = row.querySelector('input[type="range"]') as HTMLInputElement;
    const num = row.querySelector('input[type="number"]') as HTMLInputElement;
    expect(num).not.toBeNull();
    expect(num.value).toBe("5");
    // range 拖动 → number 同步
    range.value = "8";
    range.dispatchEvent(new Event("input"));
    expect(num.value).toBe("8");
    expect(val).toBe(8);
    // number 越界输入 → clamp 到 max 后提交
    num.value = "99";
    num.dispatchEvent(new Event("change"));
    expect(val).toBe(10);
    expect(range.value).toBe("10");
  });

  it("slider: 无 labelKey 时不渲染 label（保持旧裸滑条视觉）", () => {
    const nodes: PreviewMenuNode[] = [
      { id: "bare-slider", kind: "slider", control: { get: () => 1, set: () => {} } },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const row = container.querySelector('[data-testid="preview-bare-slider"]') as HTMLElement;
    expect(row.querySelector(".slide-label")).toBeNull();
    expect(row.querySelector('input[type="range"]')).not.toBeNull();
  });

  it("controls: 声明式节点直持 MenuControlDef[]，委托 renderCapControls 渲染（cap-xxx testid）", () => {
    const nodes: PreviewMenuNode[] = [
      {
        id: "lighting",
        kind: "controls",
        controls: [
          {
            id: "light-intensity",
            kind: "slider",
            labelKey: "preview.lightIntensity",
            fallback: "强度",
            getValue: () => 1,
            setValue: () => {},
            slider: { min: 0, max: 2, step: 0.01 },
          },
          {
            id: "light-color",
            kind: "color",
            labelKey: "preview.lightColor",
            fallback: "颜色",
            getValue: () => 0xffffff,
            setValue: () => {},
          },
        ],
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    // cap 控件 testid 前缀 cap-（renderCapControls 口径；slider/toggle/select/button 有，
    // color/timeline/histogram/preset-thumb 为既有未覆盖，按输入类型断言）
    expect(container.querySelector('[data-testid="cap-light-intensity"]')).not.toBeNull();
    expect(container.querySelector('input[type="range"]')).not.toBeNull();
    expect(container.querySelector('input[type="color"]')).not.toBeNull();
  });

  it("controls: 惰性函数引用每次渲染重取（cap 后挂载可见，非构建期冻结）", () => {
    let mounted = false;
    const nodes: PreviewMenuNode[] = [
      {
        id: "quality",
        kind: "controls",
        controls: () => (mounted
          ? [{
              id: "pp-enabled",
              kind: "toggle",
              labelKey: "preview.pp",
              fallback: "后处理",
              getValue: () => false,
              setValue: () => {},
            }]
          : []),
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.querySelector('[data-testid="cap-pp-enabled"]')).toBeNull();
    mounted = true;
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.querySelector('[data-testid="cap-pp-enabled"]')).not.toBeNull();
  });

  it("controls: controls 为空数组/空函数时不渲染任何行（无副作用）", () => {
    const nodes: PreviewMenuNode[] = [
      { id: "empty", kind: "controls", controls: [] },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    expect(container.childElementCount).toBe(0);
  });

  it("renderCustomDirect=true: custom 节点直接调 renderCustom 填充容器（schema 面板语义）", () => {
    let called = 0;
    const nodes: PreviewMenuNode[] = [
      {
        id: "camera",
        kind: "custom",
        renderCustom: (list) => {
          called++;
          const d = document.createElement("div");
          d.dataset.testid = "cam-ctrl";
          d.textContent = "camera controls";
          list.appendChild(d);
        },
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, { ...(makeDeps() as any), renderCustomDirect: true });
    expect(called).toBe(1);
    expect(container.querySelector('[data-testid="cam-ctrl"]')).not.toBeNull();
    // 默认（false）保持列表行语义：custom 转行壳，不调 renderCustom
    const container2 = document.createElement("div");
    renderMenu(container2, nodes, makeDeps() as any);
    expect(called).toBe(1); // 未再调用
    expect(container2.querySelector('[data-testid="preview-camera"]')).not.toBeNull();
  });
});
