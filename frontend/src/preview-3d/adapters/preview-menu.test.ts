import { describe, expect, it } from "vitest";
import type { PreviewControlDef } from "@/preview-3d/caps/scene-capability.ts";
import { renderCapControls } from "@/preview-3d/menu/engine/core.ts";

// 工厂：构造 PreviewControlDef（[增量2a] 通道收窄为复杂件专用——button/image/timeline/
// histogram/preset-thumb），简化用例书写。简单件（slider/select/toggle/color/divider）
// 已从 PreviewControlKind 移除、不再经本通道，其渲染改由 node 路径直供 CapControlView
// 渲染器测（见 cap-controls.test.ts），故本文件不再覆盖简单件。
const mk = (
  kind: PreviewControlDef["kind"],
  opts: {
    id?: string;
    labelKey?: string;
    fallback?: string;
    group?: string | undefined;
    button?: NonNullable<PreviewControlDef["button"]>;
    thumb?: NonNullable<PreviewControlDef["thumb"]>;
    getValue?: () => number | string | boolean | null;
    setValue?: (v: number | string | boolean) => void;
  } = {},
): PreviewControlDef => ({
  id: opts.id ?? `c-${kind}`,
  kind,
  labelKey: opts.labelKey ?? "preview.test.label",
  fallback: opts.fallback ?? `test-${kind}`,
  // 可选槽位仅真实存在时附带（exactOptional 收紧后避免显式 undefined 流入 PreviewControlDef）
  ...(opts.group !== undefined ? { group: opts.group } : {}),
  ...(opts.button !== undefined ? { button: opts.button } : {}),
  ...(opts.thumb !== undefined ? { thumb: opts.thumb } : {}),
  getValue: opts.getValue ?? (() => (kind === "image" ? "http://x/y.png" : kind === "timeline" ? 12 : 0.5)),
  setValue: opts.setValue ?? (() => {}),
});

const mkList = (): HTMLElement => document.createElement("div");

describe("renderCapControls", () => {
  // ===== 分组折叠（复杂件走通道，group→section 归并逻辑 kind-agnostic）=====

  it("基本分组：带 group 的控件归入同一 section", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("button", { id: "g1", group: "Sky" }),
      mk("button", { id: "g2", group: "Sky" }),
      mk("button", { id: "g3", group: "Sky" }),
    ]);
    // 1 个 section
    const sections = list.querySelectorAll(".cap-section");
    expect(sections.length).toBe(1);
    // section 内有 header + body
    const body = sections[0].querySelector(".cap-section-body") as HTMLElement;
    expect(body).not.toBeNull();
    // body 内 3 个 slide-item
    expect(body.querySelectorAll(".slide-item").length).toBe(3);
    // body 是 list 的孙子（不直接挂 list 顶层）
    expect(list.contains(body)).toBe(true);
    expect(Array.from(list.children).includes(body)).toBe(false);
  });

  it("无 group 控件：直接挂到 list 顶层", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("button", { id: "t-top" }),
      mk("button", { id: "s-top" }),
    ]);
    // 无 section
    expect(list.querySelectorAll(".cap-section").length).toBe(0);
    // 两个 slide-item 直接是 list 的子节点
    const items = list.querySelectorAll(".slide-item");
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.parentElement).toBe(list);
    }
  });

  it("交替分组（A,B,A）：相同 group 归入同一 section（非连续也归并）", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("button", { id: "a1", group: "A" }),
      mk("button", { id: "b1", group: "B" }),
      mk("button", { id: "a2", group: "A" }),
    ]);
    const sections = list.querySelectorAll(".cap-section");
    // 只有 2 个 section（A 和 B 各一个，A 只出现一次）
    expect(sections.length).toBe(2);
    // 第一个 section 的 body 内应有 2 个 slide-item（a1 和 a2）
    const firstBody = sections[0].querySelector(".cap-section-body") as HTMLElement;
    expect(firstBody.querySelectorAll(".slide-item").length).toBe(2);
    const secondBody = sections[1].querySelector(".cap-section-body") as HTMLElement;
    expect(secondBody.querySelectorAll(".slide-item").length).toBe(1);
  });

  // ===== 空列表 =====

  it("空控件列表：不产生任何 DOM", () => {
    const list = mkList();
    renderCapControls(list, []);
    expect(list.children.length).toBe(0);
  });

  // ===== section 折叠/展开 =====

  it("section 折叠/展开：header 点击切换 collapsed 状态", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("button", { group: "Sky" }),
    ]);
    const header = list.querySelector(".cap-section-header") as HTMLElement;
    const body = list.querySelector(".cap-section-body") as HTMLElement;
    const arrow = list.querySelector(".cap-section-header span") as HTMLElement;
    expect(header).not.toBeNull();
    expect(arrow).not.toBeNull();

    // 初始展开
    expect(body.style.display).toBe("block");
    expect(arrow.textContent).toBe("▾");

    // 点击折叠
    header.click();
    expect(body.style.display).toBe("none");
    expect(arrow.textContent).toBe("▸");

    // 再次点击展开
    header.click();
    expect(body.style.display).toBe("block");
    expect(arrow.textContent).toBe("▾");
  });

  // ===== 复杂控件渲染（走通道）=====

  it("button：渲染出 button", () => {
    const list = mkList();
    let clicked = false;
    renderCapControls(list, [
      mk("button", {
        button: {
          textKey: "preview.test.btn",
          action: () => { clicked = true; },
        },
      }),
    ]);
    const btn = list.querySelector("button") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    // 点击
    btn.click();
    expect(clicked).toBe(true);
  });

  it("button（primary variant）：使用 primary 样式（有背景色）", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("button", {
        button: { variant: "primary", action: () => {} },
      }),
    ]);
    const btn = list.querySelector("button") as HTMLButtonElement;
    // P1 批次2 cssText→类：primary 背景规则在注入样式表（.cc-btn-primary 含 var(--accent)），
    // 断类归属 + 样式表原文两级（happy-dom 计算样式读 var(--accent) 背景不可靠）
    expect(btn.classList.contains("cc-btn-primary")).toBe(true);
    const btnSheet = [...document.querySelectorAll("style")].find((s) => s.textContent?.includes(".cc-btn-primary"));
    expect(btnSheet?.textContent ?? "").toContain("var(--accent)");
  });

  it("button（disabled）：按钮禁用不执行 action", () => {
    const list = mkList();
    let clicked = false;
    renderCapControls(list, [
      mk("button", {
        button: {
          action: () => { clicked = true; },
          disabled: () => true,
        },
      }),
    ]);
    const btn = list.querySelector("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(clicked).toBe(false);
  });

  it("image：有 URL 时渲染 img", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("image", {
        getValue: () => "http://example.com/foo.png",
      }),
    ]);
    const img = list.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain("foo.png");
  });

  it("image：URL 为空时跳过不渲染", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("image", {
        getValue: () => null,
      }),
    ]);
    expect(list.querySelector("img")).toBeNull();
    expect(list.children.length).toBe(0);
  });

  it("timeline：渲染出 canvas + marker", () => {
    const list = mkList();
    let lastHour = 12;
    renderCapControls(list, [
      mk("timeline", {
        getValue: () => lastHour,
        setValue: (v: number | string | boolean) => { lastHour = v as number; },
      }),
    ]);
    const items = list.querySelectorAll(".slide-item");
    expect(items.length).toBe(1);
    const canvas = items[0].querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).not.toBeNull();
    // happy-dom 的 canvas.getContext 返回 null，只验证 canvas 元素存在及尺寸
    expect(canvas.width).toBe(240);
    expect(canvas.height).toBe(28);
    // marker：内部有一个绝对定位的 div（marker）
    const markerDivs = items[0].querySelectorAll("div");
    const marker = Array.from(markerDivs).find((d) => d.style.position === "absolute");
    expect(marker).not.toBeNull();
    // 值显示为 12:00
    const valSpan = items[0].querySelectorAll("span")[1];
    expect(valSpan.textContent).toBe("12:00");
  });

  it("timeline：拖动 band 更新 timeOfDay", () => {
    const list = mkList();
    let lastHour = 0;
    renderCapControls(list, [
      mk("timeline", {
        getValue: () => lastHour,
        setValue: (v: number | string | boolean) => { lastHour = v as number; },
      }),
    ]);
    const items = list.querySelectorAll(".slide-item");
    // band：slide-item 内部 cc-band 类 div（含 canvas）——P1 批次2 cssText→类后
    // position:relative 收进 .cc-band 规则，内联探测不可用
    const allDivs = items[0].querySelectorAll("div");
    const band = Array.from(allDivs).find(
      (d) => d.classList.contains("cc-band") && d.querySelector("canvas"),
    ) as HTMLElement;
    expect(band).not.toBeNull();
    // mock getBoundingClientRect 返回固定值（band 内部 canvas 宽 240，但 band 元素宽由父级决定；这里返回 240 使计算简化）
    Object.defineProperty(band, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 240, height: 28 }),
      configurable: true,
    });
    Object.defineProperty(band, "setPointerCapture", { value: () => {}, configurable: true });
    const ev = new PointerEvent("pointerdown", {
      clientX: 120,
      bubbles: true,
      pointerId: 1,
      pointerType: "mouse",
    });
    band.dispatchEvent(ev);
    // 120 / 240 * 24 = 12
    expect(lastHour).toBe(12);
  });

  // ===== 混合场景（group + 无 group 共存，divider 已移出通道不再测）=====

  it("混合：group + 无 group 共存", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("button", { id: "top", group: undefined }),
      mk("button", { id: "a1", group: "A" }),
      mk("button", { id: "a2", group: "A" }),
    ]);
    // 顶层：1 无 group 控件
    const topItems = Array.from(list.children).filter(
      (el) => !el.classList.contains("cap-section"),
    );
    expect(topItems.length).toBe(1);
    // section
    expect(list.querySelectorAll(".cap-section").length).toBe(1);
    const body = list.querySelector(".cap-section-body") as HTMLElement;
    // body 内：button a1 + button a2 = 2
    expect(body.children.length).toBe(2);
  });

  // ===== preset-thumb =====

  it("preset-thumb：渲染出 img + label 按钮行", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("preset-thumb", {
        thumb: {
          size: 64,
          options: [
            { value: "a", label: "选项A", getThumb: () => "data:image/png;base64,abc" },
            { value: "b", label: "选项B", getThumb: () => null },
          ],
          activeValue: () => "a",
          onSelect: () => {},
        },
      }),
    ]);
    const items = list.querySelectorAll(".slide-item");
    expect(items.length).toBe(1);
    const btns = items[0].querySelectorAll("button");
    expect(btns.length).toBe(2);
    // 第一格有 img（有 dataURL）
    const img = btns[0].querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain("abc");
    // 第二格也有 img（placeholder，无 dataURL 时也渲染 img）
    const img2 = btns[1].querySelector("img") as HTMLImageElement;
    expect(img2).not.toBeNull();
    // 每个 button 内有 span 标签
    for (const b of btns) {
      expect(b.querySelector("span")).not.toBeNull();
    }
    // [点击穿透修复] 缩略图 img 必须 non-pointer-target：让 click 事件落点在 button 而非 img（否则
    // 真实引擎里 onSelect 不触发——renderCapButton 文本按钮能点，而此处有嵌套 img 被拦截）
    // getComputedStyle 在 happy-dom 不计算注入样式表，改查注入规则文本（与 cc-thumb-btn-active 测试同法）
    const thumbSheet = [...document.querySelectorAll("style")].find((s: HTMLStyleElement) =>
      s.textContent?.includes(".cc-thumb-img"),
    );
    expect(thumbSheet?.textContent ?? "").toContain("pointer-events:none");
  });

  it("preset-thumb：active 格有 accent 高亮样式", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("preset-thumb", {
        thumb: {
          size: 64,
          options: [
            { value: "a", label: "A", getThumb: () => "data:x" },
            { value: "b", label: "B", getThumb: () => "data:y" },
          ],
          activeValue: () => "b",
          onSelect: () => {},
        },
      }),
    ]);
    const btns = list.querySelectorAll("button");
    expect(btns.length).toBe(2);
    // 第二个（active）挂 cc-thumb-btn-active（border-color 派生 --accent——P1 批次2 类化，
    // 内联 borderColor 探测不可用；规则在注入样式表 .cc-thumb-btn-active）
    expect((btns[1] as HTMLElement).classList.contains("cc-thumb-btn-active")).toBe(true);
    expect((btns[0] as HTMLElement).classList.contains("cc-thumb-btn-active")).toBe(false);
    const thumbSheet = [...document.querySelectorAll("style")].find((s) => s.textContent?.includes(".cc-thumb-btn-active"));
    expect(thumbSheet?.textContent ?? "").toContain("var(--accent)");
  });

  it("preset-thumb：点击后 active 高亮即时从旧按钮切到新按钮（不依赖外部 refresh）", () => {
    const list = mkList();
    let selected = "";
    renderCapControls(list, [
      mk("preset-thumb", {
        thumb: {
          size: 64,
          options: [
            { value: "a", label: "A", getThumb: () => "data:x" },
            { value: "b", label: "B", getThumb: () => "data:y" },
            { value: "c", label: "C", getThumb: () => "data:z" },
          ],
          activeValue: () => "a",
          onSelect: (v) => { selected = v; },
        },
      }),
    ]);
    const btns = list.querySelectorAll("button");
    expect(btns[0]!.classList.contains("cc-thumb-btn-active")).toBe(true);
    // 点第二格 → onSelect 触发 + active 高亮本地即时切换
    (btns[1] as HTMLElement).click();
    expect(selected).toBe("b");
    expect(btns[0]!.classList.contains("cc-thumb-btn-active")).toBe(false);
    expect(btns[1]!.classList.contains("cc-thumb-btn-active")).toBe(true);
    // 再点第三格 → 高亮继续前移，旧格清除
    (btns[2] as HTMLElement).click();
    expect(selected).toBe("c");
    expect(btns[1]!.classList.contains("cc-thumb-btn-active")).toBe(false);
    expect(btns[2]!.classList.contains("cc-thumb-btn-active")).toBe(true);
  });

  it("preset-thumb：点击调用 onSelect", () => {
    const list = mkList();
    let lastSelected = "";
    renderCapControls(list, [
      mk("preset-thumb", {
        thumb: {
          size: 64,
          options: [
            { value: "sky", label: "天空", getThumb: () => "data:x" },
            { value: "sunset", label: "日落", getThumb: () => "data:y" },
          ],
          activeValue: () => "sky",
          onSelect: (v) => { lastSelected = v; },
        },
      }),
    ]);
    const btns = list.querySelectorAll("button");
    expect(btns.length).toBe(2);
    btns[1].click();
    expect(lastSelected).toBe("sunset");
  });

  it("preset-thumb：hideLabel=true 时不渲染控件顶部 label 行（外层折叠头已承载标题）", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("preset-thumb", {
        labelKey: "preview.envPresetThumbnail",
        fallback: "预设预览",
        thumb: {
          size: 64,
          hideLabel: true,
          options: [
            { value: "sky", label: "天空", getThumb: () => "data:x" },
          ],
          activeValue: () => "sky",
          onSelect: () => {},
        },
      }),
    ]);
    const row = list.querySelector(".slide-item");
    expect(row).not.toBeNull();
    // 无 .cc-label-dim（label 行被裁剪）；缩略图按钮仍渲染
    expect(row!.querySelector(".cc-label-dim")).toBeNull();
    expect(row!.querySelectorAll("button").length).toBe(1);
  });
});
