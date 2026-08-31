import { describe, expect, it, vi } from "vitest";
import type { MenuControlDef } from "../caps/scene-capability.ts";
import { renderCapControls } from "../menu/core.ts";

// 工厂：构造 MenuControlDef，简化用例书写
const mk = (
  kind: MenuControlDef["kind"],
  opts: {
    id?: string;
    labelKey?: string;
    fallback?: string;
    group?: string;
    slider?: NonNullable<MenuControlDef["slider"]>;
    select?: NonNullable<MenuControlDef["select"]>;
    button?: NonNullable<MenuControlDef["button"]>;
    thumb?: NonNullable<MenuControlDef["thumb"]>;
    getValue?: () => number | string | boolean | null;
    setValue?: (v: number | string | boolean) => void;
  } = {},
): MenuControlDef => ({
  id: opts.id ?? `c-${kind}`,
  kind,
  labelKey: opts.labelKey ?? "preview.test.label",
  fallback: opts.fallback ?? `test-${kind}`,
  group: opts.group,
  slider: opts.slider,
  select: opts.select,
  button: opts.button,
  thumb: opts.thumb,
  getValue: opts.getValue ?? (() => (kind === "toggle" ? true : kind === "image" ? "http://x/y.png" : kind === "color" ? 0xff0000 : kind === "timeline" ? 12 : kind === "preset-thumb" ? "" : 0.5)),
  setValue: opts.setValue ?? (() => {}),
});

const mkList = (): HTMLElement => document.createElement("div");

describe("renderCapControls", () => {
  // ===== 分组折叠 =====

  it("基本分组：带 group 的控件归入同一 section", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("toggle", { group: "Sky" }),
      mk("slider", { group: "Sky" }),
      mk("select", { group: "Sky" }),
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
      mk("toggle", { id: "t-top" }),
      mk("slider", { id: "s-top" }),
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
      mk("toggle", { id: "a1", group: "A" }),
      mk("toggle", { id: "b1", group: "B" }),
      mk("toggle", { id: "a2", group: "A" }),
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
      mk("toggle", { group: "Sky" }),
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

  // ===== divider =====

  it("divider：无 group 时挂 list 顶层作为组间分隔", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("divider"),
      mk("toggle"),
    ]);
    // 顶层 dividers（margin: 4px 10px 的 hr）
    const dividers = Array.from(list.children).filter(
      (el) => (el as HTMLElement).style.margin === "4px 10px",
    );
    expect(dividers.length).toBe(1);
  });

  it("divider：有 group 时挂 section body 内作为组内分隔", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("toggle", { group: "Sky" }),
      mk("divider", { group: "Sky" }),
      mk("slider", { group: "Sky" }),
    ]);
    const body = list.querySelector(".cap-section-body") as HTMLElement;
    // body 内应包含一个 divider + 两个 slide-item
    const children = Array.from(body.children);
    const divider = children.find((el) => (el as HTMLElement).style.margin === "4px 10px");
    expect(divider).not.toBeUndefined();
    expect(body.querySelectorAll(".slide-item").length).toBe(2);
  });

  // ===== 所有控件类型 smoketest =====

  it("toggle：渲染出 slide-item + label + toggle", () => {
    const list = mkList();
    let lastValue = false;
    renderCapControls(list, [
      mk("toggle", {
        getValue: () => lastValue,
        setValue: (v: number | string | boolean) => { lastValue = v as boolean; },
      }),
    ]);
    const items = list.querySelectorAll(".slide-item");
    expect(items.length).toBe(1);
    const item = items[0];
    // label
    expect(item.querySelector(".slide-label")).not.toBeNull();
    // toggle
    expect(item.querySelector("label.toggle")).not.toBeNull();
    const input = item.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(input.checked).toBe(false);
    // 触发 onChange
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    item.querySelector("label.toggle")!.dispatchEvent(click);
    expect(lastValue).toBe(true);
  });

  it("slider：渲染出 range input 且显示值", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("slider", {
        slider: { min: 0, max: 10, step: 0.1 },
        getValue: () => 3.14,
      }),
    ]);
    const items = list.querySelectorAll(".slide-item");
    expect(items.length).toBe(1);
    const input = items[0].querySelector("input[type=range]") as HTMLInputElement;
    expect(input).not.toBeUndefined();
    expect(input.min).toBe("0");
    expect(input.max).toBe("10");
    expect(input.step).toBe("0.1");
    expect(input.value).toBe("3.14");
    // 值显示
    const valSpan = items[0].querySelectorAll("span")[1];
    expect(valSpan).not.toBeNull();
    expect(valSpan.textContent).toBe("3.14");
  });

  it("slider（unit=百分比）：显示百分比格式", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("slider", {
        slider: { min: 0, max: 1, step: 0.01, unit: "%" },
        getValue: () => 0.75,
      }),
    ]);
    const items = list.querySelectorAll(".slide-item");
    const valSpan = items[0].querySelectorAll("span")[1];
    expect(valSpan.textContent).toBe("75%");
  });

  it("slider（unit=h）：显示时:分格式", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("slider", {
        slider: { min: 0, max: 24, step: 0.01, unit: "h" },
        getValue: () => 14.5,
      }),
    ]);
    const items = list.querySelectorAll(".slide-item");
    const valSpan = items[0].querySelectorAll("span")[1];
    expect(valSpan.textContent).toBe("14:30");
  });

  it("select：渲染出 select 且填充 options", () => {
    const list = mkList();
    let lastValue = "b";
    renderCapControls(list, [
      mk("select", {
        select: [
          { value: "a", label: "Option A" },
          { value: "b", label: "Option B" },
          { value: "c", label: "Option C" },
        ],
        getValue: () => lastValue,
        setValue: (v: number | string | boolean) => { lastValue = v as string; },
      }),
    ]);
    const sel = list.querySelector("select") as HTMLSelectElement;
    expect(sel).not.toBeNull();
    expect(sel.options.length).toBe(3);
    expect(sel.options[0].value).toBe("a");
    expect(sel.options[0].textContent).toBe("Option A");
    expect(sel.value).toBe("b");
    // 触发 onChange
    sel.value = "c";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(lastValue).toBe("c");
  });

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
    expect(btn.style.background).toContain("--accent");
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

  it("color：渲染出 color input 且显示 hex", () => {
    const list = mkList();
    let lastVal = 0xff0000;
    renderCapControls(list, [
      mk("color", {
        getValue: () => lastVal,
        setValue: (v: number | string | boolean) => { lastVal = v as number; },
      }),
    ]);
    const picker = list.querySelector("input[type=color]") as HTMLInputElement;
    expect(picker).not.toBeNull();
    expect(picker.value).toBe("#ff0000");
    // 触发 input
    picker.value = "#00ff00";
    picker.dispatchEvent(new Event("input", { bubbles: true }));
    expect(lastVal).toBe(0x00ff00);
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
    // band：slide-item 内部 position:relative 的 div（含 canvas）
    const allDivs = items[0].querySelectorAll("div");
    const band = Array.from(allDivs).find(
      (d) => d.style.position === "relative" && d.querySelector("canvas"),
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

  // ===== 混合场景 =====

  it("混合：group + 无 group + divider 共存", () => {
    const list = mkList();
    renderCapControls(list, [
      mk("toggle", { id: "top", group: undefined }),
      mk("divider", { group: undefined }),
      mk("toggle", { id: "a1", group: "A" }),
      mk("toggle", { id: "a2", group: "A" }),
      mk("divider", { group: "A" }),
      mk("slider", { id: "a3", group: "A" }),
    ]);
    // 顶层：1 toggle + 1 divider
    const topItems = Array.from(list.children).filter(
      (el) => !el.classList.contains("cap-section"),
    );
    expect(topItems.length).toBe(2); // toggle + divider
    // section
    expect(list.querySelectorAll(".cap-section").length).toBe(1);
    const body = list.querySelector(".cap-section-body") as HTMLElement;
    // body 内：toggle a1 + toggle a2 + divider + slider a3 = 4
    expect(body.children.length).toBe(4);
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
    // 第二个（active）应该有 accent border
    expect((btns[1] as HTMLElement).style.borderColor).toContain("accent");
    // 第一个不应该有 accent border
    expect((btns[0] as HTMLElement).style.borderColor).not.toContain("accent");
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
});
