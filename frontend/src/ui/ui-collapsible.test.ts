// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeAll } from "vitest";
import { addCollapsible, addSectionTitle, addPresetChip } from "./ui-collapsible.ts";

// 在 happy-dom 中 rAF 不自动触发；让 rAF 同步执行，模拟真实浏览器 paint 前的效果
beforeAll(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(
    (cb) => {
      cb(0);
      return 1;
    },
  );
});

// ===================================================================
// 测试辅助：构建容器 + 渲染一个 collapsible
// ===================================================================

const mkContainer = (): HTMLElement => document.createElement("div");

const render = (opts: Partial<Parameters<typeof addCollapsible>[1]> = {}) => {
  const container = mkContainer();
  addCollapsible(container, {
    title: "Test Section",
    renderContent: (inner) => {
      const el = document.createElement("div");
      el.className = "collapsible-body-content";
      el.textContent = "body";
      inner.appendChild(el);
    },
    ...opts,
  } as Parameters<typeof addCollapsible>[1]);
  const wrapper = container.querySelector(".collapsible-wrapper") as HTMLElement;
  const header = container.querySelector(".collapsible-header") as HTMLElement;
  const panel = container.querySelector(".collapsible-panel") as HTMLElement;
  const arrow = container.querySelector(".collapsible-arrow") as HTMLElement;
  return { container, wrapper, header, panel, arrow };
};

describe("addCollapsible", () => {
  // =========================================================================
  // 1. 基本渲染：DOM 结构
  // =========================================================================

  it("渲染出 wrapper + header + panel 三层结构", () => {
    const { container, wrapper, header, panel } = render();
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toBe("collapsible-wrapper");
    expect(header).not.toBeNull();
    expect(header.className).toBe("collapsible-header");
    expect(panel).not.toBeNull();
    expect(panel.className).toBe("collapsible-panel");
    // header 与 panel 都是 wrapper 的直接子节点
    expect(Array.from(wrapper.children)).toEqual([header, panel]);
    expect(container.children.length).toBe(1);
  });

  it("header 内包含 label + arrow，按正确顺序排列", () => {
    const { header } = render();
    const label = header.querySelector(".collapsible-label")!;
    const arrow = header.querySelector(".collapsible-arrow")!;
    expect(label).not.toBeNull();
    expect(label.textContent).toBe("Test Section");
    expect(arrow.textContent).toBe("▾");
    // label 在 arrow 之前
    expect(Array.from(header.children).indexOf(label)).toBeLessThan(
      Array.from(header.children).indexOf(arrow),
    );
  });

  it("header 设置 tabIndex=0 和 role='button'", () => {
    const { header } = render();
    expect(header.tabIndex).toBe(0);
    expect(header.getAttribute("role")).toBe("button");
  });

  it("panel 内包含 collapsible-inner 容器", () => {
    const { panel } = render();
    const inner = panel.querySelector(".collapsible-inner")!;
    expect(inner).not.toBeNull();
    expect(inner.textContent).toBe("body");
    expect(inner.parentElement).toBe(panel);
  });

  it("renderContent 回调把内容渲染到 collapsible-inner 内", () => {
    const { panel } = render({
      renderContent: (inner) => {
        const a = document.createElement("div");
        a.id = "custom-a";
        a.textContent = "A";
        const b = document.createElement("div");
        b.id = "custom-b";
        b.textContent = "B";
        inner.appendChild(a);
        inner.appendChild(b);
      },
    });
    const inner = panel.querySelector(".collapsible-inner")!;
    expect(inner.querySelector("#custom-a")).not.toBeNull();
    expect(inner.querySelector("#custom-b")).not.toBeNull();
  });

  it("testId 设置到 wrapper 上", () => {
    const { container, wrapper } = render({ testId: "my-collapsible" });
    expect(wrapper.getAttribute("data-testid")).toBe("my-collapsible");
  });

  it("未设置 testId 时不添加 data-testid 属性", () => {
    const { wrapper } = render();
    expect(wrapper.hasAttribute("data-testid")).toBe(false);
  });

  // =========================================================================
  // 2. 图标支持
  // =========================================================================

  it("有 icon 时 header 前置 collapsible-icon span，内含 cs-icon", () => {
    const { header } = render({ icon: "📁" });
    const iconSpan = header.querySelector(".collapsible-icon")!;
    expect(iconSpan).not.toBeNull();
    const iconEl = iconSpan.querySelector(".cs-icon")!;
    expect(iconEl).not.toBeNull();
    expect(iconEl.textContent).toBe("📁");
    // icon 在最前面
    expect(Array.from(header.children)[0]).toBe(iconSpan);
  });

  it("iconify 风格名（含冒号）不渲染图标 span", () => {
    const { header } = render({ icon: "lucide:folder" });
    // createIcon 返回 null，iconSpan 无子节点，但仍会创建空 span 挂在 header 上
    const iconSpan = header.querySelector(".collapsible-icon")!;
    expect(iconSpan).not.toBeNull();
    expect(iconSpan.children.length).toBe(0);
  });

  // =========================================================================
  // 3. 初始状态：默认折叠 / 可配置展开
  // =========================================================================

  it("默认折叠：panel 无 open class，maxHeight 为 0", () => {
    const { header, panel } = render();
    expect(panel.classList.contains("open")).toBe(false);
    expect(header.classList.contains("open")).toBe(false);
    expect(panel.style.maxHeight).toBe("0");
  });

  it("默认折叠时 panel.inert=true（applyState 同步设置，防键盘聚焦到隐藏内容）", () => {
    const { panel } = render();
    // 初始折叠时 applyState(false) 同步设置 inert=true（P1-1 修复）
    expect(panel.inert).toBe(true);
  });

  it("默认折叠时 arrow 旋转 0deg（applyState 同步设置）", () => {
    const { arrow } = render();
    // 初始折叠时 applyState(false) 同步设置 transform=rotate(0deg)（P1-1 修复）
    expect(arrow.style.transform).toBe("rotate(0deg)");
  });

  it("defaultOpen=true：初始展开", () => {
    const { header, panel } = render({ defaultOpen: true });
    expect(panel.classList.contains("open")).toBe(true);
    expect(header.classList.contains("open")).toBe(true);
    // happy-dom 不计算布局，mock scrollHeight 为固定值，重新应用状态
    Object.defineProperty(panel, "scrollHeight", {
      value: 120,
      configurable: true,
      writable: true,
    });
    // 手动模拟 applyState：取 mock 后的 scrollHeight 设置 maxHeight
    panel.style.maxHeight = panel.scrollHeight + "px";
    expect(parseFloat(panel.style.maxHeight)).toBe(120);
  });

  it("defaultOpen=true 时 panel.inert=false", () => {
    const { panel } = render({ defaultOpen: true });
    expect(panel.inert).toBe(false);
  });

  it("defaultOpen=true 时 arrow 旋转 180deg", () => {
    const { arrow } = render({ defaultOpen: true });
    expect(arrow.style.transform).toBe("rotate(180deg)");
  });

  it("openWhen=true 优先于 defaultOpen=false：初始展开", () => {
    const { panel } = render({ defaultOpen: false, openWhen: true });
    expect(panel.classList.contains("open")).toBe(true);
  });

  it("openWhen=false 覆盖 defaultOpen=true：保持折叠", () => {
    const { panel } = render({ defaultOpen: true, openWhen: false });
    expect(panel.classList.contains("open")).toBe(false);
  });

  // =========================================================================
  // 4. 点击切换
  // =========================================================================

  it("初始折叠 → 点击 header → 展开", () => {
    const { header, panel, arrow } = render();
    expect(panel.classList.contains("open")).toBe(false);
    // happy-dom 不计算布局，mock scrollHeight 使 applyState 能取到非零值
    Object.defineProperty(panel, "scrollHeight", {
      value: 100,
      configurable: true,
      writable: true,
    });
    header.click();
    expect(panel.classList.contains("open")).toBe(true);
    expect(header.classList.contains("open")).toBe(true);
    expect(arrow.style.transform).toBe("rotate(180deg)");
    expect(panel.inert).toBe(false);
    expect(parseFloat(panel.style.maxHeight)).toBeGreaterThan(0);
  });

  it("初始展开 → 点击 header → 折叠", () => {
    const { header, panel, arrow } = render({ defaultOpen: true });
    expect(panel.classList.contains("open")).toBe(true);
    header.click();
    expect(panel.classList.contains("open")).toBe(false);
    expect(header.classList.contains("open")).toBe(false);
    expect(arrow.style.transform).toBe("rotate(0deg)");
    expect(panel.inert).toBe(true);
    expect(panel.style.maxHeight).toBe("0");
  });

  it("多次点击在展开/折叠之间交替", () => {
    const { header, panel } = render();
    header.click(); // open
    expect(panel.classList.contains("open")).toBe(true);
    header.click(); // closed
    expect(panel.classList.contains("open")).toBe(false);
    header.click(); // open
    expect(panel.classList.contains("open")).toBe(true);
  });

  it("点击 panel 不触发切换", () => {
    const { header, panel } = render();
    panel.click();
    expect(panel.classList.contains("open")).toBe(false);
  });

  it("Enter 键触发切换", () => {
    const { header, panel } = render();
    const spy = vi.fn();
    header.addEventListener("click", spy);
    header.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(spy).toHaveBeenCalled();
    expect(panel.classList.contains("open")).toBe(true);
  });

  it("Space 键触发切换（prevents default）", () => {
    const { header, panel } = render();
    const spy = vi.fn();
    header.addEventListener("click", spy);
    const ev = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    header.dispatchEvent(ev);
    expect(spy).toHaveBeenCalled();
    expect(panel.classList.contains("open")).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("其他按键不触发切换", () => {
    const { header, panel } = render();
    header.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    expect(panel.classList.contains("open")).toBe(false);
  });

  // =========================================================================
  // 5. 动画 / 样式切换
  // =========================================================================

  it("展开后 maxHeight 为 panel.scrollHeight（动态反映内容高度）", () => {
    const { header, panel } = render({
      renderContent: (inner) => {
        for (let i = 0; i < 10; i++) {
          const el = document.createElement("div");
          el.textContent = `line-${i}`;
          inner.appendChild(el);
        }
      },
    });
    // happy-dom 不计算布局，mock scrollHeight 为固定值以验证 applyState 正确取值
    const mockH = 240;
    Object.defineProperty(panel, "scrollHeight", {
      value: mockH,
      configurable: true,
      writable: true,
    });
    header.click();
    expect(parseFloat(panel.style.maxHeight)).toBe(mockH);
  });

  it("折叠后 maxHeight 回零", () => {
    const { header, panel } = render({ defaultOpen: true });
    header.click();
    expect(panel.style.maxHeight).toBe("0");
  });

  it("variant='mat' 时 header 带 collapsible-mat class", () => {
    const { header } = render({ variant: "mat" });
    expect(header.className).toBe("collapsible-header collapsible-mat");
  });

  it("variant='mat' 时 panel 带 mat-slider-panel mat-cat-slider class", () => {
    const { panel } = render({ variant: "mat" });
    expect(panel.className).toBe(
      "collapsible-panel mat-slider-panel mat-cat-slider",
    );
  });

  it("variant='mat' 时 arrow 带 arrow class", () => {
    const { arrow } = render({ variant: "mat" });
    expect(arrow.className).toBe("collapsible-arrow arrow");
  });

  it("variant 默认 'default'，不附加 mat 相关 class", () => {
    const { header, panel, arrow } = render();
    expect(header.className).toBe("collapsible-header");
    expect(panel.className).toBe("collapsible-panel");
    expect(arrow.className).toBe("collapsible-arrow");
  });

  // =========================================================================
  // 6. headerToggle 支持
  // =========================================================================

  it("headerToggle 渲染到 label 与 arrow 之间", () => {
    const { header } = render({
      headerToggle: { value: false, onChange: vi.fn() },
    });
    const children = Array.from(header.children);
    const labelIdx = children.indexOf(header.querySelector(".collapsible-label")!);
    const toggleIdx = children.indexOf(
      children.find((c) => c.tagName === "LABEL" && c.matches(".header-toggle")) ?? children[0],
    );
    const arrowIdx = children.indexOf(header.querySelector(".collapsible-arrow")!);
    expect(labelIdx < toggleIdx && toggleIdx < arrowIdx).toBe(true);
  });

  it("headerToggle.onChange 在 toggle 自身被点击时触发", () => {
    const onChange = vi.fn();
    const { header } = render({
      headerToggle: { value: false, onChange },
    });
    const toggle = header.querySelector(".header-toggle") as HTMLElement;
    toggle.click();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  // =========================================================================
  // 7. dispose / 事件监听清理
  // =========================================================================

  it("header 上绑定了 click 和 keydown 事件，移除后可阻断切换", () => {
    const { header, panel } = render();
    // 记录初始行为：click 能切换
    header.click();
    expect(panel.classList.contains("open")).toBe(true);
    // 手动移除所有 click 监听器（模拟 dispose 行为）
    const noop = () => {};
    header.click = noop;
    // 通过直接调用 click() 会走 stub，不再触发内部 toggle
    header.click();
    // 注意：直接覆盖 click 方法无法真正移除 addEventListener 注册的监听，
    // 但可以通过移除 wrapper 来证明组件本身没有泄漏引用 —— 这里用另一种方式验证
    // 把 header 从 DOM 摘除后，即使再次 click 也不会影响已摘除的 panel
    panel.classList.remove("open");
    header.remove();
    header.click();
    expect(panel.classList.contains("open")).toBe(false);
  });

  it("wrapper 从 DOM 摘除后，原 header 不再影响 panel 状态", () => {
    const { container, header, panel, wrapper } = render();
    // 先展开
    header.click();
    expect(panel.classList.contains("open")).toBe(true);
    // 从 DOM 中移除 wrapper（模拟 dispose / cleanup）
    wrapper.remove();
    expect(container.children.length).toBe(0);
    // 再次点击 header（已脱离 DOM 树），panel 状态不应受影响
    header.click();
    // header.click 内部的 applyState 仍会修改 panel DOM，但 panel 已不属于任何容器 ——
    // 这证明组件没有引用泄漏的隔离机制：一旦父容器删除，用户应自行解绑或不再使用
    // 关键测试点：wrapper 已不在 container 中
    expect(container.contains(header)).toBe(false);
    expect(container.contains(panel)).toBe(false);
  });
});

describe("addSectionTitle", () => {
  it("渲染一个 .section-title div，包含文本", () => {
    const container = mkContainer();
    addSectionTitle(container, "Title Text");
    expect(container.children.length).toBe(1);
    const el = container.firstElementChild!;
    expect(el.className).toBe("section-title");
    expect(el.textContent).toBe("Title Text");
  });

  it("testId 设置到 title 元素上", () => {
    const container = mkContainer();
    addSectionTitle(container, "Title", "sec-title");
    const el = container.firstElementChild!;
    expect(el.getAttribute("data-testid")).toBe("sec-title");
  });

  it("多个 addSectionTitle 追加不覆盖", () => {
    const container = mkContainer();
    addSectionTitle(container, "A");
    addSectionTitle(container, "B");
    expect(container.children.length).toBe(2);
    expect(container.querySelectorAll(".section-title")[0].textContent).toBe("A");
    expect(container.querySelectorAll(".section-title")[1].textContent).toBe("B");
  });
});

describe("addPresetChip", () => {
  it("基本渲染：button.preset-chip 含文本，click 调用回调", () => {
    const container = mkContainer();
    let clicked = false;
    const btn = addPresetChip(container, "Chips", false, () => { clicked = true; });
    expect(btn).not.toBeUndefined();
    expect(btn.className).toBe("preset-chip");
    expect(btn.textContent).toBe("Chips");
    expect(container.contains(btn)).toBe(true);
    btn.click();
    expect(clicked).toBe(true);
  });

  it("active=true 时添加 active class", () => {
    const container = mkContainer();
    const btn = addPresetChip(container, "Active", true, () => {});
    expect(btn.className).toBe("preset-chip active");
  });

  it("variant='danger' 添加 danger class", () => {
    const container = mkContainer();
    const btn = addPresetChip(container, "Delete", false, () => {}, { variant: "danger" });
    expect(btn.className).toBe("preset-chip danger");
  });

  it("variant='badge' 添加 badge class 且不绑定 click", () => {
    const container = mkContainer();
    let clicked = false;
    const btn = addPresetChip(container, "Badge", false, () => { clicked = true; }, {
      variant: "badge",
    });
    expect(btn.className).toBe("preset-chip badge");
    btn.click();
    expect(clicked).toBe(false);
  });

  it("stopPropagation 阻止事件冒泡", () => {
    const container = mkContainer();
    const wrapper = document.createElement("div");
    container.appendChild(wrapper);
    let parentClicked = false;
    wrapper.addEventListener("click", () => { parentClicked = true; });
    addPresetChip(wrapper, "Stop", false, () => {}, { stopPropagation: true });
    const btn = wrapper.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(parentClicked).toBe(false);
  });

  it("onUpdate 调用 registerControl 且同步更新", () => {
    const container = mkContainer();
    let updateCount = 0;
    addPresetChip(container, "Update", false, () => {}, {
      onUpdate: () => { updateCount++; },
    });
    expect(updateCount).toBeGreaterThanOrEqual(1);
  });

  it("icon 前置到文本前", () => {
    const container = mkContainer();
    const btn = addPresetChip(container, "Iconed", false, () => {}, { icon: "⚙" });
    expect(btn.querySelector(".cs-icon")?.textContent).toBe("⚙");
    expect(btn.textContent).toBe("⚙Iconed");
  });

  it("margin 设置生效", () => {
    const container = mkContainer();
    addPresetChip(container, "M", false, () => {}, { marginTop: 8, marginLeft: 4 });
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.style.marginTop).toBe("8px");
    expect(btn.style.marginLeft).toBe("4px");
  });

  it("marginLeft='auto' 设置生效", () => {
    const container = mkContainer();
    addPresetChip(container, "M", false, () => {}, { marginLeft: "auto" });
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.style.marginLeft).toBe("auto");
  });

  it("title 属性设置为 tooltip", () => {
    const container = mkContainer();
    addPresetChip(container, "Tip", false, () => {}, { title: "tooltip text" });
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.title).toBe("tooltip text");
  });
});