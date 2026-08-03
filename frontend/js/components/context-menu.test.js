// ===== <context-menu> 组件测试（ADR-021 A 层）=====
// 触发 menu:show → 断言 Shadow DOM 渲染（items / divider / danger）；
// 点击 item → 断言 onClick 执行 + hide()。
import { describe, it, expect, vi, afterEach } from "vitest";
import { bus } from "../bus.ts";
import "./context-menu.ts"; // 触发 customElements.define

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
function showMenu(items, x = 10, y = 20) {
  const el = mount();
  bus.emit("menu:show", { x, y, items });
  return el;
}

describe("<context-menu> 渲染", () => {
  it("渲染 items 的 label 文本", () => {
    const el = showMenu([{ label: "打开文件夹" }, { label: "复制路径" }]);
    const texts = [...el.shadowRoot.querySelectorAll(".item span")].map(
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
    const hr = el.shadowRoot.querySelector("hr.divider");
    expect(hr).toBeTruthy();
  });

  it("danger 项带 danger class", () => {
    const el = showMenu([{ label: "删除", danger: true }]);
    const item = el.shadowRoot.querySelector(".item");
    expect(item.classList.contains("danger")).toBe(true);
  });

  it("icon 渲染在图标 span 内", () => {
    const el = showMenu([{ label: "打开", icon: "📂" }]);
    const icon = el.shadowRoot.querySelector(".item .icon");
    expect(icon.textContent).toBe("📂");
  });

  it("label 特殊字符被转义（防 XSS）", () => {
    const el = showMenu([{ label: '<img src=x onerror=alert(1)>' }]);
    expect(el.shadowRoot.querySelector("img")).toBeFalsy();
    expect(el.shadowRoot.querySelector(".item span").textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });
});

describe("<context-menu> 交互", () => {
  it("点击 item 触发对应 onClick 并 hide", () => {
    const onClick = vi.fn();
    const el = showMenu([{ label: "打开文件夹", onClick }]);
    const item = el.shadowRoot.querySelector(".item");
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
    const items = el.shadowRoot.querySelectorAll(".item");
    items[1].click();
    expect(onClickA).not.toHaveBeenCalled();
    expect(onClickB).toHaveBeenCalledTimes(1);
  });

  it("divider 不参与点击（无 .item）", () => {
    const el = showMenu([{ label: "A" }, { divider: true }]);
    expect(el.shadowRoot.querySelectorAll(".item")).toHaveLength(1);
  });

  it("无 onClick 的 item 点击不抛错", () => {
    const el = showMenu([{ label: "标题项" }]);
    expect(() => el.shadowRoot.querySelector(".item").click()).not.toThrow();
  });
});
