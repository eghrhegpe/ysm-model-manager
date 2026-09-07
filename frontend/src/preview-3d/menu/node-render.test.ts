// ===== renderMenu 新 kind 测试：field / button / row / sectionTitle =====
import { describe, it, expect, beforeEach } from "vitest";
import { renderMenu } from "./core.ts";
import {
  clearFolderCollapsedState,
  disposeCustomCleanups,
  nodeControlToView,
} from "./render.ts";
import type { PreviewMenuNode } from "./node-types.ts";
import { previewSnapshot, setStateValue } from "../state/preview-state.ts";
import type { PreviewSnapshot } from "../state/preview-state.ts";
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

  it("toggle: 渲染 label + 开关行，点击翻转 control.set（归一后 cap 栈渲染，testid cap-xxx + label-toggle 结构）", () => {
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
    const row = container.querySelector('[data-testid="cap-perception-breath"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("呼吸");
    const input = row.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.checked).toBe(false);
    // cap toggle 走 createHeaderToggle：click handler 在 label.toggle 上，
    // e.target===input 时跳过（防双触发）；点击 label 非 input 区域触发 onChange
    const toggle = row.querySelector("label.toggle") as HTMLLabelElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    expect(on).toBe(true);
    toggle.click();
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

  it("folder: headerToggle 渲染在 header（label 与箭头间），点击开关不触发折叠、bind 同步 checked", () => {
    let on = false;
    const nodes: PreviewMenuNode[] = [
      {
        id: "folder-tg",
        kind: "folder",
        labelKey: "preview.folder",
        fallback: "组",
        defaultOpen: false,
        headerToggle: {
          value: false,
          onChange: (v: boolean) => {
            on = v;
          },
          bind: () => on,
        },
        children: [{ id: "child-tg", kind: "field", labelKey: "preview.child", value: "x" }],
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const body = container.querySelector('[data-testid="folder-tg-body"]') as HTMLElement;
    expect(body.style.display).toBe("none"); // folder 默认折叠
    // header 内有 header-toggle
    const tg = container.querySelector(".cap-section-header .header-toggle") as HTMLElement;
    expect(tg).not.toBeNull();
    // 点击开关：onChange 触发（on=true）且 body 仍折叠（stopPropagation 不冒泡到 header 折叠）
    tg.click();
    expect(on).toBe(true);
    expect(body.style.display).toBe("none");
    // 点 header 其他区域（非开关）：折叠展开
    const header = container.querySelector(".cap-section-header") as HTMLElement;
    (header.querySelector("span:nth-child(2)") as HTMLElement).click();
    expect(body.style.display).toBe("block");
  });

  it("row: headerToggle 行尾开关 + chevron 同存；开关点击不触发整行 action（env cap 行形态）", () => {
    let on = false;
    let nav = 0;
    const nodes: PreviewMenuNode[] = [
      {
        id: "env-cap-fog",
        kind: "row",
        labelKey: "preview.fog",
        fallback: "雾效",
        icon: "🌫️",
        headerToggle: {
          value: false,
          onChange: (v: boolean) => {
            on = v;
          },
          bind: () => on,
        },
        action: () => {
          nav++;
        },
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const row = container.querySelector('[data-testid="preview-env-cap-fog"]') as HTMLElement;
    expect(row).not.toBeNull();
    // rowDensity compact → 紧凑导航行类（稀疏行不吃 .slide-item 38px 内容行基座）
    const nodesC: PreviewMenuNode[] = [
      {
        id: "env-cap-sky",
        kind: "row",
        labelKey: "preview.sky",
        fallback: "天空",
        icon: "☁️",
        rowDensity: "compact",
        action: () => {},
      },
    ];
    const c2 = document.createElement("div");
    renderMenu(c2, nodesC, makeDeps() as any);
    const skyRow = c2.querySelector('[data-testid="preview-env-cap-sky"]') as HTMLElement;
    expect(skyRow.classList.contains("rm-row-compact")).toBe(true);
    // 行尾开关存在
    const tg = row.querySelector(".header-toggle") as HTMLElement;
    expect(tg).not.toBeNull();
    // chevron 也存在（action 无 badge → 显示 ›）
    expect(row.querySelector('[data-testid="row-chevron"]')).not.toBeNull();
    // 点开关：onChange 触发且不触发整行 action（stopPropagation）
    tg.click();
    expect(on).toBe(true);
    expect(nav).toBe(0);
    // 点行其他区域：action 触发（下钻）
    row.click();
    expect(nav).toBe(1);
  });

  it("folder: 折叠态记忆跨 refresh 保持，sibling 隔离，clearFolderCollapsedState 后回默认（code_review bc639ae0 #4）", () => {
    const makeNodes = (): PreviewMenuNode[] => [
      {
        id: "folder-mem-a",
        kind: "folder",
        labelKey: "preview.folder",
        fallback: "组 A",
        defaultOpen: false,
        children: [{ id: "child-a", kind: "field", labelKey: "preview.child", value: "a" }],
      },
      {
        id: "folder-mem-b",
        kind: "folder",
        labelKey: "preview.folder",
        fallback: "组 B",
        defaultOpen: false,
        children: [{ id: "child-b", kind: "field", labelKey: "preview.child", value: "b" }],
      },
    ];
    // ① 初次渲染：两 folder 默认折叠
    const c1 = document.createElement("div");
    renderMenu(c1, makeNodes(), makeDeps() as any);
    const bodyA1 = c1.querySelector('[data-testid="folder-mem-a-body"]') as HTMLElement;
    const bodyB1 = c1.querySelector('[data-testid="folder-mem-b-body"]') as HTMLElement;
    expect(bodyA1.style.display).toBe("none");
    expect(bodyB1.style.display).toBe("none");
    // 点击展开 A（B 不动）
    const headers1 = c1.querySelectorAll(".cap-section-header");
    (headers1[0] as HTMLElement).click();
    expect(bodyA1.style.display).toBe("block");
    expect(bodyB1.style.display).toBe("none");
    // ② refresh 重建 DOM（同 id）：A 记忆保持展开、B 仍折叠——且 B 不受 A 的 key 串扰
    const c2 = document.createElement("div");
    renderMenu(c2, makeNodes(), makeDeps() as any);
    const bodyA2 = c2.querySelector('[data-testid="folder-mem-a-body"]') as HTMLElement;
    const bodyB2 = c2.querySelector('[data-testid="folder-mem-b-body"]') as HTMLElement;
    expect(bodyA2.style.display).toBe("block");
    expect(bodyB2.style.display).toBe("none");
    // ③ dispose 清理后重挂载：回默认折叠（无跨会话泄漏）
    clearFolderCollapsedState();
    const c3 = document.createElement("div");
    renderMenu(c3, makeNodes(), makeDeps() as any);
    const bodyA3 = c3.querySelector('[data-testid="folder-mem-a-body"]') as HTMLElement;
    expect(bodyA3.style.display).toBe("none");
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

  it("编译期契约：谓词读未落地键（如 ui.activePanel）是类型错误（2026-09 收紧，防静默假死回归）", () => {
    // PreviewStatePath 已收紧为 KNOWN_PATHS 联合：未落地键编译报错（TS7053）。
    // [doc:adr-126-p4-d] ui.mode / env.skyGroundCap 已随 dock 谓词化落地为合法键——
    // 原「ui.mode 未落地」反例失效，换仍预留的 ui.activePanel（P4-C 拆 dockGroup 预留）。
    // 下方指令断言该错误存在——若将来类型放宽回宽联合，指令变 unused 编译失败。
    // 用静态 import 的 PreviewSnapshot（动态 import 类型会退化 any 掩盖索引错误）。
    // @ts-expect-error 未落地键 ui.activePanel 不在 PreviewStatePath
    const bad = (s: Partial<PreviewSnapshot>): boolean => s["ui.activePanel"] === "panel";
    expect(typeof bad).toBe("function");
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

  it("slider: 渲染 range 行，value 来自 control.get，oninput 触发 set+onChange（归一后 cap- testid + head 结构）", () => {
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
    const row = container.querySelector('[data-testid="cap-layer-slider"]') as HTMLElement;
    expect(row).not.toBeNull();
    const range = row.querySelector('input[type="range"]') as HTMLInputElement;
    expect(range).not.toBeNull();
    expect(range.min).toBe("1");
    expect(range.max).toBe("100");
    expect(range.value).toBe("40");
    range.value = "77";
    range.dispatchEvent(new Event("input"));
    expect(val).toBe(77);
    // [ADR-195 刀 2.5] nodeControlToView 把 view.onChange 设为 setValue，renderCapSlider
    // oninput 末尾再调 v.onChange → spec.onChange 双重触发（产码回归，已报告）。
    expect(changed).toEqual([77, 77]);
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
    const row = container.querySelector('[data-testid="cap-num-slider"]') as HTMLElement;
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

  it("slider: 无 labelKey 时 cap 栈仍渲染 head + fallback/id 文案（视觉行为变化，结构已变）", () => {
    const nodes: PreviewMenuNode[] = [
      { id: "bare-slider", kind: "slider", control: { get: () => 1, set: () => {} } },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, makeDeps() as any);
    const row = container.querySelector('[data-testid="cap-bare-slider"]') as HTMLElement;
    // cap 栈 slider 恒有 head（label+当前值），slide-label 不再为 null
    expect(row.querySelector(".slide-label")).not.toBeNull();
    expect(row.querySelector('input[type="range"]')).not.toBeNull();
  });

  it("controls: 声明式节点直持 PreviewControlDef[]，委托 renderCapControls 渲染（cap-xxx testid）", () => {
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

  // ---- renderCustom 逃生舱 cleanup 生命周期（面板级；模型级兜底见 bones-panel-node.test.ts）----
  it("renderCustomDirect: 同容器重渲染前先调旧 cleanup（面板级生命周期归渲染器）", () => {
    disposeCustomCleanups(); // 模块级表跨测试隔离
    const calls: string[] = [];
    let mountCount = 0;
    const nodes: PreviewMenuNode[] = [
      {
        id: "camera",
        kind: "custom",
        renderCustom: (list) => {
          const n = ++mountCount;
          const d = document.createElement("div");
          d.dataset.testid = `mount-${n}`;
          list.appendChild(d);
          return (): void => {
            calls.push(`cleanup-${n}`);
          };
        },
      },
    ];
    const container = document.createElement("div");
    renderMenu(container, nodes, { ...(makeDeps() as any), renderCustomDirect: true });
    expect(mountCount).toBe(1);
    expect(calls).toEqual([]); // 首次挂载不触发清理

    // 同容器二次渲染：渲染器先清旧（cleanup-1）再挂载新的——取代逃生舱自搓 cleanupRef
    renderMenu(container, nodes, { ...(makeDeps() as any), renderCustomDirect: true });
    expect(mountCount).toBe(2);
    expect(calls).toEqual(["cleanup-1"]);
    disposeCustomCleanups();
  });

  it("disposeCustomCleanups: 全清挂载中 cleanup（菜单 dispose 路径，幂等）", () => {
    disposeCustomCleanups(); // 模块级表跨测试隔离
    const calls: string[] = [];
    const mkNode = (id: string): PreviewMenuNode => ({
      id,
      kind: "custom",
      renderCustom: (list) => {
        list.appendChild(document.createElement("div"));
        return (): void => {
          calls.push(id);
        };
      },
    });
    const a = document.createElement("div");
    const b = document.createElement("div");
    // 真实面板容器挂 dock/popup DOM（isConnected=true）——renderMenu 渲染 b 时
    // runCustomMount 的陈旧条目扫清（code_review 4ac2b4f72 #1/#3）不得误清仍在
    // 文档的 a（并行会话隔离判据即 isConnected）
    document.body.appendChild(a);
    document.body.appendChild(b);
    renderMenu(a, [mkNode("a")], { ...(makeDeps() as any), renderCustomDirect: true });
    renderMenu(b, [mkNode("b")], { ...(makeDeps() as any), renderCustomDirect: true });
    expect(calls).toEqual([]);

    // 模拟菜单销毁时序（core.ts dispose：先 dock.remove/popup.remove 再
    // disposeCustomCleanups——dispose 只清「容器已离文档」的条目）
    document.body.removeChild(a);
    document.body.removeChild(b);
    disposeCustomCleanups();
    expect([...calls].sort()).toEqual(["a", "b"]);
    // 幂等：表已清空，二次全清不再触发（dispose 与 overlay 兜底双调无害）
    disposeCustomCleanups();
    expect([...calls].sort()).toEqual(["a", "b"]);
  });
});

// ===== nodeControlToView 单测（控件原语归一 · ADR-195 刀 2.5 投影反转）=====
describe("nodeControlToView", () => {
  it("bind 映射：spec.bind 时 getValue 读 snapshot[bind]，setValue 写状态层", () => {
    // 用 render.frustumCull（KNOWN_PATHS 之一，无 cap 直管持久化）验证 bind 读写
    setStateValue("render.frustumCull", false);
    const snapshot = previewSnapshot();
    const node: PreviewMenuNode = {
      id: "test-frustum",
      kind: "toggle",
      labelKey: "preview.frustumCull",
      fallback: "视锥剔除",
      control: {
        bind: "render.frustumCull",
        get: (v: unknown) => Boolean(v),
        set: (v: unknown) => { setStateValue("render.frustumCull", Boolean(v)); },
      },
    };
    const view = nodeControlToView(node, snapshot);
    expect(view.getValue()).toBe(false);
    view.setValue(true);
    expect(previewSnapshot()["render.frustumCull"]).toBe(true);
    // 还原
    setStateValue("render.frustumCull", false);
  });

  it("refreshOnChange → onChange 注入：spec 含 refreshOnChange 时 view.onChange = setValue", () => {
    let refreshCalled = 0;
    const menu = mockMenuHandle();
    menu.refresh = () => { refreshCalled++; };
    setStateValue("render.frustumCull", false);
    const snapshot = previewSnapshot();
    const node: PreviewMenuNode = {
      id: "test-refresh",
      kind: "toggle",
      labelKey: "preview.frustumCull",
      fallback: "视锥剔除",
      control: {
        bind: "render.frustumCull",
        get: (v: unknown) => Boolean(v),
        set: (v: unknown) => { setStateValue("render.frustumCull", Boolean(v)); },
        refreshOnChange: true,
      },
    };
    const view = nodeControlToView(node, snapshot, menu);
    expect(view.onChange).toBeDefined();
    view.onChange!(true);
    expect(previewSnapshot()["render.frustumCull"]).toBe(true);
    expect(refreshCalled).toBe(1);
    // 还原
    setStateValue("render.frustumCull", false);
  });

  it("onChange 注入：spec 含 onChange 时 view.onChange = setValue", () => {
    const changed: unknown[] = [];
    const snapshot = previewSnapshot();
    const node: PreviewMenuNode = {
      id: "test-onchange",
      kind: "toggle",
      labelKey: "preview.frustumCull",
      fallback: "视锥剔除",
      control: {
        get: () => false,
        set: () => {},
        onChange: (v: unknown) => { changed.push(v); },
      },
    };
    const view = nodeControlToView(node, snapshot);
    expect(view.onChange).toBeDefined();
    view.onChange!(true);
    expect(changed).toEqual([true]);
  });

  it("numeric 透传：slider 节点 numeric/unit/onCommit 透传到 view.slider", () => {
    const snapshot = previewSnapshot();
    const node: PreviewMenuNode = {
      id: "test-numeric",
      kind: "slider",
      labelKey: "preview.maxFps",
      fallback: "最大帧率",
      control: {
        min: 30,
        max: 120,
        step: 5,
        numeric: true,
        unit: "fps",
        get: () => 60,
        set: () => {},
        onCommit: () => {},
      },
    };
    const view = nodeControlToView(node, snapshot);
    expect(view.slider).toBeDefined();
    expect(view.slider!.min).toBe(30);
    expect(view.slider!.max).toBe(120);
    expect(view.slider!.step).toBe(5);
    expect(view.slider!.numeric).toBe(true);
    expect(view.slider!.unit).toBe("fps");
    expect(view.slider!.onCommit).toBeTypeOf("function");
  });

  it("无 labelKey 时 fallback 兜底：view.fallback = node.fallback ?? node.id", () => {
    const snapshot = previewSnapshot();
    const node: PreviewMenuNode = {
      id: "bare-control",
      kind: "toggle",
      control: { get: () => false, set: () => {} },
    };
    const view = nodeControlToView(node, snapshot);
    expect(view.labelKey).toBe("");
    expect(view.fallback).toBe("bare-control");
    expect(view.id).toBe("bare-control");
  });

  it("有 labelKey 时 view.labelKey = node.labelKey", () => {
    const snapshot = previewSnapshot();
    const node: PreviewMenuNode = {
      id: "labeled-control",
      kind: "toggle",
      labelKey: "preview.frustumCull",
      fallback: "视锥剔除",
      control: { get: () => false, set: () => {} },
    };
    const view = nodeControlToView(node, snapshot);
    expect(view.labelKey).toBe("preview.frustumCull");
    expect(view.fallback).toBe("视锥剔除");
  });

  it("select 节点透传 spec.options 到 view.select", () => {
    const snapshot = previewSnapshot();
    const node: PreviewMenuNode = {
      id: "test-select",
      kind: "select",
      labelKey: "preview.waterMode",
      fallback: "水面模式",
      control: {
        options: [
          { value: "film", label: "薄膜" },
          { value: "pool", label: "水池" },
        ],
        get: () => "film",
        set: () => {},
      },
    };
    const view = nodeControlToView(node, snapshot);
    expect(view.select).toBeDefined();
    expect(view.select!.length).toBe(2);
    expect(view.select![0].value).toBe("film");
  });

  it("hintKey 透传：node.hintKey → view.hintKey", () => {
    const snapshot = previewSnapshot();
    const node: PreviewMenuNode = {
      id: "hint-control",
      kind: "toggle",
      labelKey: "preview.frustumCull",
      fallback: "视锥剔除",
      hintKey: "preview.frustumCullHint",
      control: { get: () => false, set: () => {} },
    };
    const view = nodeControlToView(node, snapshot);
    expect(view.hintKey).toBe("preview.frustumCullHint");
  });

  it("无 spec 时 getValue 返回 null，setValue 不抛错", () => {
    const snapshot = previewSnapshot();
    const node: PreviewMenuNode = {
      id: "no-control",
      kind: "toggle",
    };
    const view = nodeControlToView(node, snapshot);
    expect(view.getValue()).toBe(null);
    expect(() => view.setValue(true)).not.toThrow();
  });
});


