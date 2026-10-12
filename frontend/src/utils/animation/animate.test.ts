// ===== animateNumber 里程表动画单元测试 =====
// 覆盖：null 守卫、无数字文本、相同数值短路、单帧跳转、逐帧进位、取消函数、onFinish 完成事件
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

  it("重复调用同一元素：新动画先取消旧动画，旧定时器不再写回（P4 反推修复）", () => {
    const el = document.createElement("div");
    el.textContent = "0";
    const onFinish1 = vi.fn();
    const cancel1 = animateNumber(el, 21, 100, onFinish1); // 0→21: 帧 [1, 21]
    expect(el.textContent).toBe("1");
    // 新一轮动画（0→2 单帧立即落地）应取消旧动画的后续定时器
    animateNumber(el, 2, 100);
    expect(el.textContent).toBe("2");
    vi.advanceTimersByTime(300);
    // 旧动画第 2 帧定时器已被取消，不得覆盖为 21
    expect(el.textContent).toBe("2");
    // 隐式取消同样不算「完成落定」：旧轮 onFinish 不得回调
    expect(onFinish1).not.toHaveBeenCalled();
    cancel1(); // 已取消的 cancel 幂等，不抛错
  });

  it("onFinish：动画在途不回调；自然结束回调一次", () => {
    const el = document.createElement("div");
    el.textContent = "0";
    const onFinish = vi.fn();
    animateNumber(el, 21, 100, onFinish);
    expect(el.textContent).toBe("1");
    expect(onFinish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(el.textContent).toBe("21");
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("onFinish：取消不回调（值未落定，终值归接管方）", () => {
    const el = document.createElement("div");
    el.textContent = "0";
    const onFinish = vi.fn();
    const cancel = animateNumber(el, 21, 100, onFinish);
    cancel();
    vi.advanceTimersByTime(300);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("onFinish：短路分支（单帧/等值/无数字）同步回调——终值写不丢失", () => {
    const el = document.createElement("div");
    el.textContent = "0";
    const single = vi.fn();
    animateNumber(el, 1, 100, single); // 单帧立即落地 = 已落定
    expect(single).toHaveBeenCalledTimes(1);
    const el2 = document.createElement("div");
    el2.textContent = "文件数: 42";
    const same = vi.fn();
    animateNumber(el2, 42, 100, same); // from === to
    expect(same).toHaveBeenCalledTimes(1);
    const el3 = document.createElement("div");
    el3.textContent = "Hello World";
    const none = vi.fn();
    animateNumber(el3, 42, 100, none); // 文本无数字
    expect(none).toHaveBeenCalledTimes(1);
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
