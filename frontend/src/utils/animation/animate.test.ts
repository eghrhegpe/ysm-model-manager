// ===== animateNumber 里程表动画单元测试 =====
// 覆盖：null 守卫、无数字文本、相同数值短路、单帧跳转、逐帧进位、取消函数
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { animateNumber } from "./animate.ts";

describe("animateNumber", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("null 元素 → 返回空取消函数，不抛错", () => {
    const cancel = animateNumber(null as unknown as HTMLElement, 42);
    expect(typeof cancel).toBe("function");
    cancel();
  });

  it("文本无数字 → 返回空取消函数，textContent 不变", () => {
    const el = document.createElement("div");
    el.textContent = "Hello World";
    const cancel = animateNumber(el, 42);
    expect(el.textContent).toBe("Hello World");
    cancel();
  });

  it("from === to → 直接短路，textContent 不变", () => {
    const el = document.createElement("div");
    el.textContent = "文件数: 42";
    const cancel = animateNumber(el, 42);
    expect(el.textContent).toBe("文件数: 42");
    cancel();
  });

  it("单帧路径（如 0 → 1）→ 立即跳转目标值", () => {
    const el = document.createElement("div");
    el.textContent = "0";
    animateNumber(el, 1, 100);
    // 0→1 只有一帧，直接设置
    expect(el.textContent).toBe("1");
  });

  it("多帧动画：逐帧滚动到目标值", () => {
    const el = document.createElement("div");
    el.textContent = "0";
    const duration = 100;
    animateNumber(el, 21, duration);

    // 0 → 21: frames = [1, 21]（2 帧）
    // 第一帧立即执行
    expect(el.textContent).toBe("1");
    vi.advanceTimersByTime(duration / 2);
    expect(el.textContent).toBe("21");
    // 动画结束后不再变化
    vi.advanceTimersByTime(duration);
    expect(el.textContent).toBe("21");
  });

  it("多位数进位：0 → 141 从个位到百位", () => {
    const el = document.createElement("div");
    el.textContent = "0";
    animateNumber(el, 141, 300);

    // frames: 个位先转 [1, 41, 141]
    expect(el.textContent).toBe("1");
    vi.advanceTimersByTime(100);
    expect(el.textContent).toBe("41");
    vi.advanceTimersByTime(100);
    expect(el.textContent).toBe("141");
  });

  it("取消函数：调用后停止后续帧更新", () => {
    const el = document.createElement("div");
    el.textContent = "0";
    const cancel = animateNumber(el, 21, 100);

    expect(el.textContent).toBe("1");
    cancel();
    vi.advanceTimersByTime(100);
    // 取消后不再更新（停留在取消时的值）
    expect(el.textContent).toBe("1");
  });

  it("保留文本中数字以外的内容", () => {
    const el = document.createElement("div");
    el.textContent = "共 0 个文件";
    animateNumber(el, 5, 200);
    expect(el.textContent).toContain("共");
    expect(el.textContent).toContain("个文件");
    expect(el.textContent).toMatch(/\d/);
    // 最终值
    vi.advanceTimersByTime(500);
    expect(el.textContent).toBe("共 5 个文件");
  });
});
