// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeAll } from "vitest";
import { cardContainer } from "./ui-card.ts";

// happy-dom 不自动触发 rAF；同步执行
beforeAll(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 1;
  });
});

const mkContainer = (): HTMLElement => {
  const c = document.createElement("div");
  c.className = "render-card";
  return c;
};

// ===================================================================
// cardContainer
// ===================================================================

describe("cardContainer", () => {
  // ------------------------------------------------------------------
  // 1. 基本渲染：标题 + 内容
  // ------------------------------------------------------------------

  it("移除 container 的 'render-card' class 并创建 .lcard 卡片", () => {
    const container = mkContainer();
    cardContainer(container, (card) => {
      card.textContent = "Hello";
    });

    expect(container.classList.contains("render-card")).toBe(false);
    const lcard = container.querySelector(".lcard");
    expect(lcard).not.toBeNull();
    expect(lcard!.textContent).toBe("Hello");
    expect(container.children.length).toBe(1);
    expect(container.children[0]).toBe(lcard);
  });

  it("container 原本没有 'render-card' class 时不报错", () => {
    const container = document.createElement("div");
    cardContainer(container, (card) => {
      card.textContent = "ok";
    });

    const lcard = container.querySelector(".lcard");
    expect(lcard).not.toBeNull();
    expect(lcard!.textContent).toBe("ok");
  });

  // ------------------------------------------------------------------
  // 2. 点击事件
  // ------------------------------------------------------------------

  it("fn 回调可以在卡片上添加 click 监听器", () => {
    const container = mkContainer();
    const handler = vi.fn();
    cardContainer(container, (card) => {
      card.addEventListener("click", handler);
      card.textContent = "click me";
    });

    const lcard = container.querySelector(".lcard") as HTMLElement;
    lcard.click();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fn 可返回 dispose 函数，cardContainer 将其透传", () => {
    const container = mkContainer();
    const disposed = vi.fn();
    const dispose = cardContainer(container, () => disposed) as () => void;

    expect(typeof dispose).toBe("function");
    dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it("fn 不返回 dispose 时 cardContainer 返回 undefined", () => {
    const container = mkContainer();
    const result = cardContainer(container, () => undefined);
    expect(result).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // 3. 自定义样式
  // ------------------------------------------------------------------

  it("fn 回调可对卡片设置自定义内联样式", () => {
    const container = mkContainer();
    cardContainer(container, (card) => {
      card.style.backgroundColor = "#fff";
      card.style.borderRadius = "8px";
      card.textContent = "styled";
    });

    const lcard = container.querySelector(".lcard") as HTMLElement;
    expect(lcard.style.backgroundColor).toBe("#fff");
    expect(lcard.style.borderRadius).toBe("8px");
  });

  it("fn 回调可对卡片添加自定义 class", () => {
    const container = mkContainer();
    cardContainer(container, (card) => {
      card.classList.add("custom-theme");
      card.textContent = "themed";
    });

    const lcard = container.querySelector(".lcard");
    expect(lcard!.classList.contains("lcard")).toBe(true);
    expect(lcard!.classList.contains("custom-theme")).toBe(true);
  });

  // ------------------------------------------------------------------
  // 4. 子内容插槽
  // ------------------------------------------------------------------

  it("fn 回调可向卡片内追加子元素", () => {
    const container = mkContainer();
    cardContainer(container, (card) => {
      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = "Title";

      const body = document.createElement("div");
      body.className = "card-body";
      body.textContent = "Body content";

      card.appendChild(title);
      card.appendChild(body);
    });

    const lcard = container.querySelector(".lcard");
    expect(lcard!.children.length).toBe(2);
    expect(lcard!.children[0].className).toBe("card-title");
    expect(lcard!.children[0].textContent).toBe("Title");
    expect(lcard!.children[1].className).toBe("card-body");
    expect(lcard!.children[1].textContent).toBe("Body content");
  });

  it("多次调用 cardContainer 可创建多张卡片", () => {
    const container = mkContainer();
    cardContainer(container, (card) => {
      card.textContent = "Card 1";
    });
    cardContainer(container, (card) => {
      card.textContent = "Card 2";
    });

    const cards = container.querySelectorAll(".lcard");
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toBe("Card 1");
    expect(cards[1].textContent).toBe("Card 2");
  });
});
