// ===== 渲染辅助测试（renderComponent）=====
// 覆盖：默认挂载 body、自定义容器、connected 事件 + shadowRoot 就绪、unmount 清理
import { describe, it, expect } from "vitest";
import { renderComponent } from "./render.ts";

// 注册一个真实自定义元素：connectedCallback 里建 shadowRoot 并发 connected 事件
class TestEl extends HTMLElement {
  connectedCallback(): void {
    this.attachShadow({ mode: "open" });
    this.dispatchEvent(new CustomEvent("connected", { bubbles: true }));
  }
}
customElements.define("test-el", TestEl);

describe("renderComponent", () => {
  it("挂载到 document.body 并等待 shadowRoot 就绪", () => {
    const { el, container, unmount } = renderComponent<TestEl>("test-el");
    expect(container).toBe(document.body);
    expect(el.shadowRoot).not.toBeNull();
    expect(document.body.contains(el)).toBe(true);
    unmount();
    expect(document.body.contains(el)).toBe(false);
  });

  it("挂载到自定义容器", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { el, container } = renderComponent<TestEl>("test-el", { container: host });
    expect(container).toBe(host);
    expect(host.contains(el)).toBe(true);
    host.remove();
  });

  it("unmount 后再次调用安全", () => {
    const { unmount } = renderComponent<TestEl>("test-el");
    unmount();
    expect(() => unmount()).not.toThrow();
  });
});
