// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { withLoadingIndicator } from "./ui-loading.ts";

// 每次测试前清空 body，防止残留 overlay 跨用例污染
beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  // 直接清空 body 即可，任何挂起的 setTimeout(overlay.remove, 200) 回调操作 detached 元素安全无害
  document.body.innerHTML = "";
});

// ===================================================================
// 1. 基本渲染：overlay + 文案 DOM 结构
// ===================================================================

describe("DOM 渲染", () => {
  it("调用 withLoadingIndicator 后 body 追加 .loading-overlay", () => {
    let whenMounted: () => void = () => {};
    const mountPromise = new Promise<void>((resolve) => { whenMounted = resolve; });

    withLoadingIndicator("加载中…", async () => {
      whenMounted();
      await new Promise((r) => setTimeout(r, 50));
    });

    mountPromise.then(() => {
      const overlay = document.body.querySelector(".loading-overlay");
      expect(overlay).not.toBeNull();
      expect(overlay!.classList.contains("loading-overlay")).toBe(true);
      // span 子节点
      const span = overlay!.querySelector(".loading-overlay-text");
      expect(span).not.toBeNull();
      expect(span!.className).toBe("loading-overlay-text");
    });

    return mountPromise;
  });

  it("overlay 文本内容为传入 text", () => {
    let whenMounted = () => {};
    const p = new Promise<void>((resolve) => { whenMounted = resolve; });

    withLoadingIndicator("正在保存", async () => { whenMounted(); });

    p.then(() => {
      const span = document.body.querySelector(".loading-overlay-text")!;
      expect(span.textContent).toBe("正在保存");
    });

    return p;
  });

  it("span 直接作为 overlay 子节点", () => {
    let whenMounted = () => {};
    const p = new Promise<void>((resolve) => { whenMounted = resolve; });

    withLoadingIndicator("保存中", async () => { whenMounted(); });

    p.then(() => {
      const overlay = document.body.querySelector(".loading-overlay")!;
      expect(overlay.children.length).toBe(1);
      expect(overlay.children[0].className).toBe("loading-overlay-text");
    });

    return p;
  });
});

// ===================================================================
// 2. 可见性过渡：先 append 再补 visible class
// ===================================================================

describe("可见性过渡", () => {
  it("append 之后 fn 首次 await 之前 overlay 已带 visible class", async () => {
    // 用 yield-then-resolve 模式：fn 在第一次 await 前检查 DOM，再 resolve
    const result = await withLoadingIndicator("visible", async () => {
      const overlay = document.body.querySelector(".loading-overlay")!;
      expect(overlay.classList.contains("visible")).toBe(true);
      return "ok";
    });
    expect(result).toBe("ok");
  });
});

// ===================================================================
// 3. 成功路径：返回 fn 的返回值
// ===================================================================

describe("成功路径", () => {
  it("fn 返回 Promise.resolve(v) → withLoadingIndicator 返回 v", async () => {
    const result = await withLoadingIndicator("ok", () => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("fn 返回 object → 透传", async () => {
    const obj = { x: 1, y: "hi" };
    const result = await withLoadingIndicator("ok", () => Promise.resolve(obj));
    expect(result).toBe(obj);
  });

  it("fn 返回 undefined → 透传 undefined", async () => {
    const result = await withLoadingIndicator("ok", () => Promise.resolve(undefined));
    expect(result).toBeUndefined();
  });
});

// ===================================================================
// 4. 失败路径：fn reject → 上层 rethrow，overlay 仍被清理
// ===================================================================

describe("失败路径", () => {
  it("fn reject 时上层 await 收到同一错误", async () => {
    const err = new Error("disk full");
    await expect(withLoadingIndicator("loading", () => Promise.reject(err)))
      .rejects.toBe(err);
  });

  it("fn reject 后 overlay 最终从 DOM 移除（finally 清理）", async () => {
    const err = new Error("boom");
    try {
      await withLoadingIndicator("loading", () => Promise.reject(err));
    } catch (_e) {
      // 吃掉错误
    }
    // 等 200ms setTimeout 走完
    await vi.waitFor(() => {
      expect(document.body.querySelector(".loading-overlay")).toBeNull();
    }, { timeout: 500, interval: 10 });
    expect(document.body.querySelector(".loading-overlay")).toBeNull();
  });
});

// ===================================================================
// 5. finally 清理：无论成功失败，overlay 移除
// ===================================================================

describe("finally 清理", () => {
  it("fn resolve 后 overlay.classList 移除 visible", async () => {
    await withLoadingIndicator("ok", () => Promise.resolve(undefined));
    await new Promise((r) => setTimeout(r, 10)); // 微任务走完
    const overlay = document.body.querySelector(".loading-overlay");
    if (overlay) {
      expect(overlay.classList.contains("visible")).toBe(false);
    }
  });

  it("fn resolve 后 200ms 内 overlay 从 DOM 移除", async () => {
    await withLoadingIndicator("ok", () => Promise.resolve(undefined));
    await vi.waitFor(() => {
      expect(document.body.querySelector(".loading-overlay")).toBeNull();
    }, { timeout: 500, interval: 10 });
  });
});

// ===================================================================
// 6. fn 中同步抛出（同步 throw）
// ===================================================================

describe("同步异常", () => {
  it("fn 同步 throw → 上层 reject，overlay 仍清理", async () => {
    const err = new Error("sync");
    try {
      await withLoadingIndicator("t", () => { throw err; });
    } catch (e) {
      expect(e).toBe(err);
    }
    await vi.waitFor(() => {
      expect(document.body.querySelector(".loading-overlay")).toBeNull();
    }, { timeout: 500, interval: 10 });
  });
});

// ===================================================================
// 7. 长耗时 fn：遮罩在整个执行期保持可见
// ===================================================================

describe("生命周期", () => {
  it("fn 持续期间 overlay 保持 .visible", async () => {
    let done = () => {};
    const p = new Promise<void>((resolve) => { done = resolve; });

    withLoadingIndicator("long", async () => {
      // 在 fn 执行中期检查
      const overlay = document.body.querySelector(".loading-overlay")!;
      expect(overlay.classList.contains("visible")).toBe(true);
      done();
      await new Promise((r) => setTimeout(r, 30));
    });

    await p;
  });
});