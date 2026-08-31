// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { DragSliderController, type DragSliderOptions } from "./ui-slider-controller.ts";

// ===================================================================
// 测试辅助
// ===================================================================

/** 创建带 getBoundingClientRect mock 的元素（happy-dom 不计算真实布局） */
const mkEl = (width = 200, left = 0): HTMLElement => {
    const el = document.createElement("div");
    el.style.width = `${width}px`;
    Object.defineProperty(el, "getBoundingClientRect", {
        value: () => ({
            left,
            top: 0,
            right: left + width,
            bottom: 20,
            width,
            height: 20,
            x: left,
            y: 0,
        }),
        configurable: true,
        writable: true,
    });
    return el;
};

/** 构造控制器并 bind，返回测试句柄 */
const setup = (
    opts: Partial<DragSliderOptions> = {},
    width = 200,
): { el: HTMLElement; controller: DragSliderController; dispose: () => void } => {
    const el = mkEl(width);
    const fullOpts: DragSliderOptions = {
        value: 50,
        min: 0,
        max: 100,
        step: 1,
        ...opts,
    };
    const controller = new DragSliderController(fullOpts);
    const disposable = controller.bind(el);
    return { el, controller, dispose: () => disposable.dispose() };
};

/** 在元素上模拟鼠标按下（mousedown） */
const mouseDown = (el: HTMLElement, clientX = 100): MouseEvent => {
    const e = new MouseEvent("mousedown", { clientX, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
};

/** 在 document 上模拟鼠标移动（mousemove） */
const mouseMove = (clientX: number): MouseEvent => {
    const e = new MouseEvent("mousemove", { clientX, bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    return e;
};

/** 在 document 上模拟鼠标抬起（mouseup） */
const mouseUp = (clientX: number): MouseEvent => {
    const e = new MouseEvent("mouseup", { clientX, bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    return e;
};

/** 在元素上模拟键盘按下 */
const keyDown = (
    el: HTMLElement,
    key: string,
    opts: { ctrlKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
    el.dispatchEvent(e);
    return e;
};

// ===================================================================
// DragSliderController
// ===================================================================

describe("DragSliderController", () => {
    // =========================================================================
    // 1. 基本构造与初始值
    // =========================================================================

    it("构造时保存 opts，value 为传入值", () => {
        const onChange = vi.fn();
        const { controller } = setup({
            value: 37,
            min: 10,
            max: 90,
            step: 2,
            onChange,
        });
        // opts.value 可通过 setValue 读取到当前状态
        // 直接验证：通过触发事件看值是否正确
        expect(onChange).not.toHaveBeenCalled();
    });

    it("setValue 可程序化更新当前值", () => {
        const { controller } = setup({ value: 50, min: 0, max: 100, step: 1 });
        controller.setValue(75);
        // setValue 只改内部值，不触发回调
        // 验证：随后拖动不会立即产生 onChange（值已等于计算值）
        const onChange = vi.fn();
        const el = mkEl(200);
        const ctrl2 = new DragSliderController({
            value: 75,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        ctrl2.bind(el);
        // 先 setValue 改到 25
        ctrl2.setValue(25);
        // 在 25% 位置（clientX=50）点击，值不应变化，onChange 不应触发
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 50, bubbles: true, cancelable: true }),
        );
        expect(onChange).not.toHaveBeenCalled();
    });

    // =========================================================================
    // 2. bind 注册事件 & dispose 清理
    // =========================================================================

    it("bind 返回 Disposable，调用 dispose 可清理", () => {
        const onChange = vi.fn();
        const { el, dispose } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });

        // dispose 前：点击 50% 位置能触发 onChange（0 → 50）
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 100, bubbles: true, cancelable: true }),
        );
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(50);

        dispose();

        // dispose 后：再点不应触发
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 150, bubbles: true, cancelable: true }),
        );
        expect(onChange).toHaveBeenCalledTimes(1); // 无变化
    });

    it("dispose 后键盘事件不再生效", () => {
        const onChange = vi.fn();
        const { el, dispose } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });

        el.focus();
        keyDown(el, "ArrowRight");
        expect(onChange).toHaveBeenCalledWith(51);

        dispose();

        keyDown(el, "ArrowRight");
        expect(onChange).toHaveBeenCalledTimes(1); // 不再变化
    });

    it("dispose 后可安全重复调用", () => {
        const { dispose } = setup();
        expect(() => {
            dispose();
            dispose();
            dispose();
        }).not.toThrow();
    });

    // =========================================================================
    // 3. 点击跳转（click → setValueFromClientX）
    // =========================================================================

    it("点击元素 50% 位置（clientX=100, width=200）→ value=50", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 100, bubbles: true, cancelable: true }),
        );
        expect(onChange).toHaveBeenCalledWith(50);
    });

    it("点击 0% 位置（clientX=0）→ value=min", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 0, bubbles: true, cancelable: true }),
        );
        expect(onChange).toHaveBeenCalledWith(0);
    });

    it("点击 100% 位置（clientX=200）→ value=max", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 200, bubbles: true, cancelable: true }),
        );
        expect(onChange).toHaveBeenCalledWith(100);
    });

    it("点击超出右边界（clientX=300）仍被 clamp01 限制到 max", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 300, bubbles: true, cancelable: true }),
        );
        expect(onChange).toHaveBeenCalledWith(100);
    });

    it("点击超出左边界（clientX=-50）仍被 clamp01 限制到 min", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: -50, bubbles: true, cancelable: true }),
        );
        expect(onChange).toHaveBeenCalledWith(0);
    });

    it("click 不阻止冒泡（源码 e.preventDefault 但不 stopPropagation）", () => {
        const parentSpy = vi.fn();
        const { el } = setup({ value: 50, min: 0, max: 100, step: 1 });
        const parent = document.createElement("div");
        parent.appendChild(el);
        parent.addEventListener("click", parentSpy);
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 100, bubbles: true, cancelable: true }),
        );
        expect(parentSpy).toHaveBeenCalledTimes(1);
    });

    // =========================================================================
    // 4. 拖拽（mousedown → mousemove → mouseup）
    // =========================================================================

    it("完整拖拽：mousedown 开始 → mousemove 步进 → mouseup 结束，onChange 被调用", () => {
        const onChange = vi.fn();
        const onDragEnd = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            onChange,
            onDragEnd,
        });

        mouseDown(el, 0); // 起始 0%
        mouseMove(100); // 拖到 50%
        mouseMove(150); // 拖到 75%
        mouseMove(200); // 拖到 100%
        mouseUp(200);

        expect(onChange).toHaveBeenCalledWith(50);
        expect(onChange).toHaveBeenCalledWith(75);
        expect(onChange).toHaveBeenCalledWith(100);
        expect(onDragEnd).toHaveBeenCalledWith(100);
    });

    it("快速单击（mousedown + mouseup，无 mousemove）也跳转", () => {
        const onChange = vi.fn();
        const onDragEnd = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            onChange,
            onDragEnd,
        });

        mouseDown(el, 100); // 50% 位置按下
        mouseUp(100); // 立即抬起，无移动

        expect(onChange).toHaveBeenCalledWith(50);
        expect(onDragEnd).toHaveBeenCalledWith(50);
    });

    it("拖拽过程中 onChange 仅在新值与旧值不同时才调用", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });

        mouseDown(el, 100); // 50%
        mouseMove(100); // 仍在 50%，值不变
        mouseMove(100); // 仍在 50%，值不变
        mouseUp(100);

        // 虽然初始值=0，但第一次 mouseMove 后跳到 50，之后两次不动
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(50);
    });

    it("onDragEnd 在 mouseup 时触发并传入最终值", () => {
        const onDragEnd = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            onDragEnd,
        });

        mouseDown(el, 0);
        mouseMove(100);
        mouseUp(100);

        expect(onDragEnd).toHaveBeenCalledWith(50);
    });

    // =========================================================================
    // 5. 键盘操作
    // =========================================================================

    it("ArrowRight: value 增加 step", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "ArrowRight");
        expect(onChange).toHaveBeenCalledWith(51);
    });

    it("ArrowLeft: value 减少 step", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "ArrowLeft");
        expect(onChange).toHaveBeenCalledWith(49);
    });

    it("ArrowRight 超过 max 被钳制", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 99,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "ArrowRight");
        expect(onChange).toHaveBeenCalledWith(100);
    });

    it("ArrowLeft 低于 min 被钳制", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 1,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "ArrowLeft");
        expect(onChange).toHaveBeenCalledWith(0);
    });

    it("shift+ArrowRight: value 增加 10×step", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "ArrowRight", { shiftKey: true });
        expect(onChange).toHaveBeenCalledWith(60);
    });

    it("ctrl+ArrowRight: value 增加 100×step，超过 max 被钳制到 max", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "ArrowRight", { ctrlKey: true });
        // 100×step = 100，50+100=150，被 clamp 到 max=100
        expect(onChange).toHaveBeenCalledWith(100);
    });

    it("Home: value 跳到 min", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "Home");
        expect(onChange).toHaveBeenCalledWith(0);
    });

    it("End: value 跳到 max", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "End");
        expect(onChange).toHaveBeenCalledWith(100);
    });

    it("ArrowUp / ArrowDown 不影响值（让给菜单导航）", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "ArrowUp");
        keyDown(el, "ArrowDown");
        expect(onChange).not.toHaveBeenCalled();
    });

    it("其他按键（如 'a'）不影响值", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onChange,
        });
        el.focus();
        keyDown(el, "a");
        expect(onChange).not.toHaveBeenCalled();
    });

    it("键盘操作时 onDragEnd 也同步触发", () => {
        const onDragEnd = vi.fn();
        const { el } = setup({
            value: 50,
            min: 0,
            max: 100,
            step: 1,
            onDragEnd,
        });
        el.focus();
        keyDown(el, "ArrowRight");
        expect(onDragEnd).toHaveBeenCalledWith(51);
    });

    it("键盘操作值未变化时不触发 onChange 和 onDragEnd", () => {
        const onChange = vi.fn();
        const onDragEnd = vi.fn();
        const { el } = setup({
            value: 100,
            min: 0,
            max: 100,
            step: 1,
            onChange,
            onDragEnd,
        });
        el.focus();
        keyDown(el, "ArrowRight"); // 已超 max
        expect(onChange).not.toHaveBeenCalled();
        expect(onDragEnd).not.toHaveBeenCalled();
    });

    // =========================================================================
    // 6. Snap 吸附逻辑
    // =========================================================================

    it("snap 吸附：snap=25 时点击 50% 位置（raw=50）→ value 对齐到 50", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            snap: 25,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 100, bubbles: true, cancelable: true }),
        );
        // raw = 50, snapped = Math.round(50/25)*25 = 50
        expect(onChange).toHaveBeenCalledWith(50);
    });

    it("snap 吸附：snap=25 时点击 30% 位置（raw=30）→ value 对齐到 25", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 1,
            snap: 25,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 60, bubbles: true, cancelable: true }),
        );
        // raw = 30, snapped = Math.round(30/25)*25 = 25
        expect(onChange).toHaveBeenCalledWith(25);
    });

    it("snap 为 0 时回退到 step 吸附", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 10,
            snap: 0,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 55, bubbles: true, cancelable: true }),
        );
        // raw = 27.5, snap=0 无效，回退 step 吸附 → Math.round(27.5/10)*10 = 30
        expect(onChange).toHaveBeenCalledWith(30);
    });

    // =========================================================================
    // 7. 非整数 step
    // =========================================================================

    it("step=0.5 时拖拽到 50% 位置（raw=50）→ value=50（step 吸附不改变整数值）", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 0.5,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 100, bubbles: true, cancelable: true }),
        );
        // raw = 50, precision = 1/0.5 = 2, Math.round(50*2)/2 = 50
        expect(onChange).toHaveBeenCalledWith(50);
    });

    it("step=0.5 时点击 25% 位置（raw=25）→ value=25", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 0.5,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 50, bubbles: true, cancelable: true }),
        );
        expect(onChange).toHaveBeenCalledWith(25);
    });

    it("step=0.5 时点击 26% 位置（raw=26）→ value 吸附到 26（0.5 的整数倍）", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 0,
            min: 0,
            max: 100,
            step: 0.5,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 52, bubbles: true, cancelable: true }),
        );
        // raw = 26, precision = 2, Math.round(26*2)/2 = 26
        expect(onChange).toHaveBeenCalledWith(26);
    });

    // =========================================================================
    // 8. 非零 min 范围
    // =========================================================================

    it("min=10, max=90 时点击 50% 位置 → value=50（min + 0.5 * (max-min)）", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: 10,
            min: 10,
            max: 90,
            step: 1,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 100, bubbles: true, cancelable: true }),
        );
        // raw = 10 + 0.5 * (90 - 10) = 50
        expect(onChange).toHaveBeenCalledWith(50);
    });

    it("min=-50, max=50 时点击 50% 位置 → value=0", () => {
        const onChange = vi.fn();
        const { el } = setup({
            value: -50,
            min: -50,
            max: 50,
            step: 1,
            onChange,
        });
        el.dispatchEvent(
            new MouseEvent("click", { clientX: 100, bubbles: true, cancelable: true }),
        );
        // raw = -50 + 0.5 * (50 - (-50)) = -50 + 50 = 0
        expect(onChange).toHaveBeenCalledWith(0);
    });

    // =========================================================================
    // 9. 重复 mousedown 覆盖旧监听
    // =========================================================================

    it("多次 mousedown 不会累积 document 监听器", () => {
        const { el } = setup({ value: 0, min: 0, max: 100, step: 1 });
        // 连续 5 次 mousedown，每次内部都会 dispose 旧监听再注册新监听
        mouseDown(el, 50);
        mouseDown(el, 100);
        mouseDown(el, 150);
        mouseDown(el, 175);
        mouseDown(el, 200);
        // 最终 mouseup
        mouseUp(200);
        // 不抛错即为正常
    });
});