// ===== <context-menu> 组件测试（ADR-021 A 层）=====
// 触发 menu:show → 断言 Shadow DOM 渲染（items / divider / danger）；
// 点击 item → 断言 onClick 执行 + hide()。
import { describe, it, expect, vi, afterEach } from "vitest";
import { bus } from "../../bus.ts";
import type { MenuItem } from "../../bus";
import "./index.ts"; // 触发 customElements.define

/** 挂载 <context-menu> 到 document（connectedCallback → render） */
function mount() {
  const el = document.createElement("context-menu");
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  // 移除触发 disconnectedCallback，清理 bus.on / document 监听
  document.body.innerHTML = "";
});

/** 触发 menu:show 并返回组件 */
function showMenu(items: MenuItem[], x = 10, y = 20) {
  const el = mount();
  bus.emit("menu:show", { x, y, items });
  return el;
}

describe("<context-menu> 渲染", () => {
  it("渲染 items 的 label 文本", () => {
    const el = showMenu([{ label: "打开文件夹" }, { label: "复制路径" }]);
    const texts = [...el.shadowRoot!.querySelectorAll(".item span")].map(
      (s) => s.textContent,
    );
    expect(texts).toEqual(["打开文件夹", "复制路径"]);
  });

  it("divider 渲染为 <hr class=divider>", () => {
    const el = showMenu([
      { label: "A" },
      { divider: true },
      { label: "B" },
    ]);
    const hr = el.shadowRoot!.querySelector("hr.divider");
    expect(hr).not.toBeNull();
  });

  it("danger 项带 danger class", () => {
    const el = showMenu([{ label: "删除", danger: true }]);
    const item = el.shadowRoot!.querySelector(".item")!;
    expect(item.classList.contains("danger")).toBe(true);
  });

  it("icon 渲染在图标 span 内", () => {
    const el = showMenu([{ label: "打开", icon: "📂" }]);
    const icon = el.shadowRoot!.querySelector(".item .icon")!;
    expect(icon.textContent).toBe("📂");
  });

  it("label 特殊字符被转义（防 XSS）", () => {
    const el = showMenu([{ label: '<img src=x onerror=alert(1)>' }]);
    expect(el.shadowRoot!.querySelector("img")).toBeFalsy();
    expect(el.shadowRoot!.querySelector(".item span")!.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });
});

describe("<context-menu> 交互", () => {
  it("点击 item 触发对应 onClick 并 hide", () => {
    const onClick = vi.fn();
    const el = showMenu([{ label: "打开文件夹", onClick }]);
    const item = el.shadowRoot!.querySelector(".item") as HTMLElement;
    item.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(el.style.display).toBe("none"); // hide()
  });

  it("多 item 点击按 data-idx 命中正确 handler", () => {
    const onClickA = vi.fn();
    const onClickB = vi.fn();
    const el = showMenu([
      { label: "A", onClick: onClickA },
      { label: "B", onClick: onClickB },
    ]);
    const items = el.shadowRoot!.querySelectorAll(".item");
    (items[1] as HTMLElement).click();
    expect(onClickA).not.toHaveBeenCalled();
    expect(onClickB).toHaveBeenCalledTimes(1);
  });

  it("divider 不参与点击（无 .item）", () => {
    const el = showMenu([{ label: "A" }, { divider: true }]);
    expect(el.shadowRoot!.querySelectorAll(".item")).toHaveLength(1);
  });

  it("无 onClick 的 item 点击不抛错", () => {
    const el = showMenu([{ label: "标题项" }]);
    expect(() =>
      (el.shadowRoot!.querySelector(".item") as HTMLElement).click(),
    ).not.toThrow();
  });
});

describe("<context-menu> 键盘导航", () => {
  /** 深焦解析：document.activeElement 对 shadow 内元素 retarget 成 host（浏览器行为），
   *  测试断言需沿 shadowRoot.activeElement 下钻到真实聚焦项（与组件实现同范式） */
  function focusedItem(el: Element): Element | null {
    let active = document.activeElement as Element | null;
    if (active?.shadowRoot) active = el.shadowRoot?.activeElement ?? null;
    return active;
  }

  it("ArrowDown/ArrowUp 逐项移动焦点（含循环），Enter 激活当前项并 hide", () => {
    const onClickA = vi.fn();
    const onClickB = vi.fn();
    const el = showMenu([
      { label: "A", onClick: onClickA },
      { label: "B", onClick: onClickB },
    ]);
    const items = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".item")];
    expect(items).toHaveLength(2);
    (items[0] as HTMLElement).focus(); // show() 的 rAF 内 firstItem.focus() 同效

    // ArrowDown：0 → 1
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(focusedItem(el)).toBe(items[1]);
    // ArrowDown：1 → 0（循环）
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(focusedItem(el)).toBe(items[0]);
    // ArrowUp：0 → 1（循环）
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(focusedItem(el)).toBe(items[1]);
    // Enter 激活当前聚焦项（items[1] = B）
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onClickA).not.toHaveBeenCalled();
    expect(onClickB).toHaveBeenCalledTimes(1);
    expect(el.style.display).toBe("none"); // hide()
  });

  it("Escape 关闭菜单且焦点不在菜单内时不劫持方向键（外部元素不受影响）", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const el = showMenu([{ label: "A", onClick: vi.fn() }]);
    // 焦点在菜单外（Tab 逃逸场景）→ ArrowDown 不应被菜单拦截
    outside.focus();
    const items = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".item")];
    const spyFocus = vi.spyOn(items[0] as HTMLElement, "focus");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(spyFocus).not.toHaveBeenCalled(); // 焦点不属于本菜单 → 不接管

    // Escape 仍关闭菜单
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(el.style.display).toBe("none");
    spyFocus.mockRestore();
    outside.remove();
  });

  it("hide() 归还打开前焦点（键盘上下文不丢到 body）", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    const el = showMenu([{ label: "A", onClick: vi.fn() }]);
    (el.shadowRoot!.querySelector(".item") as HTMLElement).focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(el.style.display).toBe("none");
    expect(document.activeElement).toBe(btn); // 归还给打开前聚焦的按钮
    btn.remove();
  });
});
