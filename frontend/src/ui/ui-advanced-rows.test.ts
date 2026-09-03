// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
    addColorSliderRow,
    addVector3SliderRow,
    addModeSlider,
} from "./ui-advanced-rows.ts";

// ===================================================================
// 测试辅助
// ===================================================================

/** 便捷：拿到元素的 textContent */
const txt = (node: HTMLElement | null): string | null => node?.textContent ?? null;

// ===================================================================
// addColorSliderRow
// ===================================================================

describe("addColorSliderRow", () => {
    it("创建 clr-block，包含 header (title+swatch) 与 R/G/B 三行", () => {
        const container = document.createElement("div");
        addColorSliderRow(container, "MyColor", [0.2, 0.5, 0.8], vi.fn());

        const block = container.querySelector(".clr-block")!;
        expect(block).not.toBeNull();

        expect(block.querySelector(".clr-header")).not.toBeNull();
        expect(txt(block.querySelector(".clr-title"))).toBe("MyColor");
        expect(block.querySelector(".clr-swatch")).not.toBeNull();

        const rows = block.querySelectorAll(".clr-row");
        expect(rows.length).toBe(3);

        const channels = Array.from(
            block.querySelectorAll(".clr-channel"),
        ).map((el) => el.textContent);
        expect(channels).toEqual(["R", "G", "B"]);
    });

    it("三行各自携带 cs-bar（SLIDER_BAR_CLASS），含 role=slider 与 aria-valuenow", () => {
        const container = document.createElement("div");
        addColorSliderRow(container, "C", [0.1, 0.5, 0.9], vi.fn());

        const bars = container.querySelectorAll(".cs-bar");
        expect(bars.length).toBe(3);

        bars.forEach((bar) => {
            expect(bar.getAttribute("role")).toBe("slider");
            expect(bar.hasAttribute("aria-valuenow")).toBe(true);
        });
    });

    it("初始值文本为 .toFixed(2)，fill width 匹配比例", () => {
        const container = document.createElement("div");
        addColorSliderRow(container, "C", [0.33, 0.66, 0.99], vi.fn());

        const vals = Array.from(
            container.querySelectorAll(".clr-value"),
        ).map((el) => el.textContent);
        expect(vals).toEqual(["0.33", "0.66", "0.99"]);

        const widths = Array.from(
            container.querySelectorAll(".cs-fill"),
        ).map((el) => (el as HTMLElement).style.width);
        expect(widths[0]).toContain("33");
        expect(widths[1]).toContain("66");
        expect(widths[2]).toContain("99");
    });

    it("初始 swatch background 为 rgb 字符串", () => {
        const container = document.createElement("div");
        addColorSliderRow(container, "C", [0, 0.5, 1], vi.fn());

        const swatch = container.querySelector(".clr-swatch") as HTMLElement;
        expect(swatch.style.background).toBe("rgb(0, 128, 255)");
    });

    it("非有限通道值回落到 0（避免 toFixed/width 渲染 NaN）", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        // @ts-expect-error 故意传入非法值
        addColorSliderRow(container, "C", [NaN, undefined, Infinity], onChange);

        const vals = Array.from(
            container.querySelectorAll(".clr-value"),
        ).map((el) => el.textContent);
        expect(vals).toEqual(["0.00", "0.00", "0.00"]);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("越界通道值被钳到 [0,1]", () => {
        const container = document.createElement("div");
        addColorSliderRow(container, "C", [-0.2, 1.5, 0.5], vi.fn());

        const vals = Array.from(
            container.querySelectorAll(".clr-value"),
        ).map((el) => el.textContent);
        expect(vals).toEqual(["0.00", "1.00", "0.50"]);
    });

    it("点击某条 cs-bar 触发 onChange，回调参数为 [r, g, b] 数组", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        addColorSliderRow(container, "C", [0, 0, 0], onChange);

        const bars = container.querySelectorAll(".cs-bar");
        const firstBar = bars[0];
        Object.defineProperty(firstBar, "getBoundingClientRect", {
            value: () => ({
                left: 0, top: 0, right: 200, bottom: 20,
                width: 200, height: 20, x: 0, y: 0,
            }),
            configurable: true,
        });
        firstBar.dispatchEvent(
            new MouseEvent("click", { clientX: 100, bubbles: true }),
        );

        expect(onChange).toHaveBeenCalled();
        const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(Array.isArray(lastCall)).toBe(true);
        expect(lastCall.length).toBe(3);
        expect(lastCall[0]).toBeCloseTo(0.5, 2);
    });

    it("testId 被写入 block 的 data-testid", () => {
        const container = document.createElement("div");
        addColorSliderRow(
            container, "C", [0, 0, 0], vi.fn(), undefined, "clr-test",
        );
        expect(container.querySelector('[data-testid="clr-test"]')).not.toBeNull();
    });

    it("opts.onUpdate 被 initControl 调用时能拿到 block 引用", () => {
        const container = document.createElement("div");
        const onUpdateSpy = vi.fn();

        addColorSliderRow(
            container,
            "C",
            [0.5, 0.5, 0.5],
            vi.fn(),
            { onUpdate: onUpdateSpy },
        );

        expect(onUpdateSpy).toHaveBeenCalledTimes(1);
        expect(onUpdateSpy.mock.calls[0][0]).toBe(
            container.querySelector(".clr-block"),
        );
    });

    it("opts.bind 被 initControl 在构造时立即调用（同步初始化）", () => {
        const container = document.createElement("div");
        const bindSpy = vi.fn((): [number, number, number] => [0.1, 0.2, 0.3]);

        addColorSliderRow(
            container,
            "C",
            [0, 0, 0],
            vi.fn(),
            { bind: bindSpy },
        );

        expect(bindSpy).toHaveBeenCalled();
    });
});

// ===================================================================
// addVector3SliderRow
// ===================================================================

describe("addVector3SliderRow", () => {
    it("创建 vec3-block，包含 header (title) 与 X/Y/Z 三行", () => {
        const container = document.createElement("div");
        addVector3SliderRow(container, "MyVec", [1, 2, 3], 0, 10, 1, vi.fn());

        const block = container.querySelector(".vec3-block")!;
        expect(block).not.toBeNull();
        expect(block.querySelector(".vec3-header")).not.toBeNull();
        expect(txt(block.querySelector(".vec3-title"))).toBe("MyVec");

        const rows = block.querySelectorAll(".vec3-row");
        expect(rows.length).toBe(3);

        const axes = Array.from(
            block.querySelectorAll(".vec3-axis"),
        ).map((el) => el.textContent);
        expect(axes).toEqual(["X", "Y", "Z"]);
    });

    it("自定义 axisLabels 覆盖默认 X/Y/Z", () => {
        const container = document.createElement("div");
        addVector3SliderRow(
            container, "V", [0, 0, 0], 0, 10, 1, vi.fn(),
            ["U", "V", "W"],
        );

        const axes = Array.from(
            container.querySelectorAll(".vec3-axis"),
        ).map((el) => el.textContent);
        expect(axes).toEqual(["U", "V", "W"]);
    });

    it("step>=1 时显示整数（Math.round），step<1 时显示 .toFixed(2)", () => {
        const container = document.createElement("div");
        addVector3SliderRow(
            container, "V", [0.33, 0.66, 0.99], 0, 10, 1, vi.fn(),
        );
        const vals = Array.from(
            container.querySelectorAll(".vec3-value"),
        ).map((el) => el.textContent);
        expect(vals).toEqual(["0", "1", "1"]);

        const container2 = document.createElement("div");
        addVector3SliderRow(
            container2, "V", [0.33, 0.66, 0.99], 0, 10, 0.1, vi.fn(),
        );
        const vals2 = Array.from(
            container2.querySelectorAll(".vec3-value"),
        ).map((el) => el.textContent);
        expect(vals2).toEqual(["0.33", "0.66", "0.99"]);
    });

    it("icon 参数存在时渲染 cs-icon（图标不可用走 fallback 首字）", () => {
        const container = document.createElement("div");
        addVector3SliderRow(
            container, "Velocity", [0, 0, 0], 0, 10, 1, vi.fn(),
            undefined,
            "lucide:arrow-right",
        );

        const iconBox = container.querySelector(".cs-icon");
        expect(iconBox).not.toBeNull();
        const fb = iconBox!.querySelector(".cs-icon-fallback");
        expect(fb).not.toBeNull();
        expect(txt(fb as HTMLElement)).toBe("V");
    });

    it("非有限轴值回落到 min，越界值被钳到 [min, max]", () => {
        const container = document.createElement("div");
        addVector3SliderRow(
            container, "V", [NaN, -5, 15], 0, 10, 1, vi.fn(),
        );

        const vals = Array.from(
            container.querySelectorAll(".vec3-value"),
        ).map((el) => el.textContent);
        expect(vals).toEqual(["0", "0", "10"]);
    });

    it("aria-valuenow/valuemin/valuemax 正确设置", () => {
        const container = document.createElement("div");
        addVector3SliderRow(container, "V", [3, 5, 7], 0, 10, 1, vi.fn());

        const bars = container.querySelectorAll(".cs-bar");
        expect(bars.length).toBe(3);

        const nows = Array.from(bars).map((b) => b.getAttribute("aria-valuenow"));
        const mins = Array.from(bars).map((b) => b.getAttribute("aria-valuemin"));
        const maxs = Array.from(bars).map((b) => b.getAttribute("aria-valuemax"));

        expect(nows).toEqual(["3", "5", "7"]);
        expect(mins).toEqual(["0", "0", "0"]);
        expect(maxs).toEqual(["10", "10", "10"]);
    });

    it("点击某条 cs-bar 触发 onChange，回调参数为 [x, y, z] 数组", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        addVector3SliderRow(
            container, "V", [0, 0, 0], 0, 100, 1, onChange,
        );

        const bars = container.querySelectorAll(".cs-bar");
        const firstBar = bars[0];
        Object.defineProperty(firstBar, "getBoundingClientRect", {
            value: () => ({
                left: 0, top: 0, right: 200, bottom: 20,
                width: 200, height: 20, x: 0, y: 0,
            }),
            configurable: true,
        });
        firstBar.dispatchEvent(
            new MouseEvent("click", { clientX: 100, bubbles: true }),
        );

        expect(onChange).toHaveBeenCalled();
        const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(Array.isArray(lastCall)).toBe(true);
        expect(lastCall.length).toBe(3);
        expect(lastCall[0]).toBeCloseTo(50, 0);
    });

    it("onDragEndCb 在键盘触发后调用", () => {
        const onDragEnd = vi.fn();
        const container = document.createElement("div");
        addVector3SliderRow(
            container, "V", [50, 50, 50], 0, 100, 1, vi.fn(),
            undefined, undefined, onDragEnd,
        );

        const bar = container.querySelector(".cs-bar") as HTMLElement;
        bar.focus();
        bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(onDragEnd).toHaveBeenCalled();
        const last = onDragEnd.mock.calls[onDragEnd.mock.calls.length - 1][0];
        expect(last[0]).toBe(51);
    });

    it("testId 被写入 block 的 data-testid", () => {
        const container = document.createElement("div");
        addVector3SliderRow(
            container, "V", [0, 0, 0], 0, 10, 1, vi.fn(),
            undefined, undefined, undefined, undefined, "vec-test",
        );
        expect(container.querySelector('[data-testid="vec-test"]')).not.toBeNull();
    });

    it("initControl 通过 opts.onUpdate 拿到 block 引用", () => {
        const container = document.createElement("div");
        const onUpdateSpy = vi.fn();

        addVector3SliderRow(
            container, "V", [5, 5, 5], 0, 10, 1, vi.fn(),
            undefined, undefined, undefined, { onUpdate: onUpdateSpy },
        );

        expect(onUpdateSpy).toHaveBeenCalledTimes(1);
        expect(onUpdateSpy.mock.calls[0][0]).toBe(
            container.querySelector(".vec3-block"),
        );
    });

    it("opts.bind 被 initControl 在构造时调用一次", () => {
        const container = document.createElement("div");
        const bindSpy = vi.fn((): [number, number, number] => [1, 2, 3]);

        addVector3SliderRow(
            container, "V", [0, 0, 0], 0, 10, 1, vi.fn(),
            undefined, undefined, undefined, { bind: bindSpy },
        );

        expect(bindSpy).toHaveBeenCalled();
    });
});

// ===================================================================
// addModeSlider<T>
// ===================================================================

describe("addModeSlider", () => {
    const options = [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
        { value: "c", label: "Gamma" },
    ];

    it("空 options 数组时提前返回，container 无子节点", () => {
        const container = document.createElement("div");
        addModeSlider(container, "M", [], "a", vi.fn());
        expect(container.children.length).toBe(0);
    });

    it("创建 cs-row，包含 cs-top (label+value) 与 cs-bar (fill+thumb)", () => {
        const container = document.createElement("div");
        addModeSlider(container, "MyMode", options, "b", vi.fn());

        const row = container.querySelector(".cs-row")!;
        expect(row).not.toBeNull();

        const top = row.querySelector(".cs-top")!;
        expect(top).not.toBeNull();
        expect(top.getAttribute("role")).toBe("slider");
        expect(top.getAttribute("aria-label")).toBe("MyMode");

        expect(txt(row.querySelector(".cs-label"))).toBe("MyMode");
        expect(txt(row.querySelector(".cs-value"))).toBe("Beta");

        expect(row.querySelector(".cs-bar")).not.toBeNull();
        expect(row.querySelector(".cs-fill")).not.toBeNull();
        expect(row.querySelector(".cs-thumb")).not.toBeNull();
    });

    it("currentValue 不在 options 内时回落到第一个选项", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        addModeSlider(
            container, "M", options, "not-a-real-value" as any, onChange,
        );

        expect(txt(container.querySelector(".cs-value"))).toBe("Alpha");
        expect(onChange).not.toHaveBeenCalled();
    });

    it("ArrowRight 切换到下一个选项并触发 onChange", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        addModeSlider(container, "M", options, "a", onChange);

        const top = container.querySelector(".cs-top")!;
        top.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

        expect(onChange).toHaveBeenCalledWith("b");
        expect(txt(container.querySelector(".cs-value"))).toBe("Beta");
    });

    it("ArrowLeft 切换到上一个选项", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        addModeSlider(container, "M", options, "c", onChange);

        const top = container.querySelector(".cs-top")!;
        top.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

        expect(onChange).toHaveBeenCalledWith("b");
        expect(txt(container.querySelector(".cs-value"))).toBe("Beta");
    });

    it("ArrowUp / ArrowDown 也支持（源码允许）", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        addModeSlider(container, "M", options, "a", onChange);

        const top = container.querySelector(".cs-top")!;
        top.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
        expect(onChange).not.toHaveBeenCalled();

        top.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        expect(onChange).toHaveBeenCalledWith("b");
    });

    it("到达最后一个选项后 ArrowRight 不再前进（边界钳制）", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        addModeSlider(container, "M", options, "c", onChange);

        const top = container.querySelector(".cs-top")!;
        top.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

        expect(onChange).not.toHaveBeenCalled();
        expect(txt(container.querySelector(".cs-value"))).toBe("Gamma");
    });

    it("到达第一个选项后 ArrowLeft 不再后退", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        addModeSlider(container, "M", options, "a", onChange);

        const top = container.querySelector(".cs-top")!;
        top.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

        expect(onChange).not.toHaveBeenCalled();
        expect(txt(container.querySelector(".cs-value"))).toBe("Alpha");
    });

    it("点击 cs-top 左半部分切换到上一个，右半部分切换到下一个", () => {
        const onChange = vi.fn();
        const container = document.createElement("div");
        addModeSlider(container, "M", options, "b", onChange);

        const top = container.querySelector(".cs-top")!;
        Object.defineProperty(top, "getBoundingClientRect", {
            value: () => ({
                left: 0, top: 0, right: 200, bottom: 20,
                width: 200, height: 20, x: 0, y: 0,
            }),
            configurable: true,
        });

        top.dispatchEvent(
            new MouseEvent("click", { clientX: 50, bubbles: true }),
        );
        expect(onChange).toHaveBeenCalledWith("a");

        top.dispatchEvent(
            new MouseEvent("click", { clientX: 150, bubbles: true }),
        );
        expect(onChange).toHaveBeenCalledWith("b");
    });

    it("onDragEndCb 在切换时触发", () => {
        const onDragEnd = vi.fn();
        const container = document.createElement("div");
        addModeSlider(
            container, "M", options, "a", vi.fn(),
            undefined, onDragEnd,
        );

        const top = container.querySelector(".cs-top")!;
        top.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(onDragEnd).toHaveBeenCalledWith("b");
    });

    it("icon 参数存在时渲染 cs-icon（图标不可用走 fallback）", () => {
        const container = document.createElement("div");
        addModeSlider(
            container, "Mode", options, "a", vi.fn(),
            "lucide:sliders",
        );

        const iconBox = container.querySelector(".cs-icon");
        expect(iconBox).not.toBeNull();
        const fb = iconBox!.querySelector(".cs-icon-fallback");
        expect(fb).not.toBeNull();
        expect(txt(fb as HTMLElement)).toBe("M");
    });

    it("testId 被写入 row 的 data-testid", () => {
        const container = document.createElement("div");
        addModeSlider(
            container, "M", options, "a", vi.fn(),
            undefined, undefined, undefined, "mode-test",
        );
        expect(container.querySelector('[data-testid="mode-test"]')).not.toBeNull();
    });

    it("initControl 通过 opts.onUpdate 能拿到 row 引用", () => {
        const container = document.createElement("div");
        const onUpdateSpy = vi.fn();

        addModeSlider(
            container, "M", options, "b", vi.fn(),
            undefined, undefined, { onUpdate: onUpdateSpy },
        );

        expect(onUpdateSpy).toHaveBeenCalledTimes(1);
        expect(onUpdateSpy.mock.calls[0][0]).toBe(
            container.querySelector(".cs-row"),
        );
    });

    it("opts.bind 被 initControl 在构造时调用一次", () => {
        const container = document.createElement("div");
        const bindSpy = vi.fn((): "a" | "b" | "c" => "b");

        addModeSlider(
            container, "M", options, "a", vi.fn(),
            undefined, undefined, { bind: bindSpy },
        );

        expect(bindSpy).toHaveBeenCalled();
    });

    it("数字 value 类型也能正常工作", () => {
        const numOptions = [
            { value: 1, label: "Low" },
            { value: 2, label: "Med" },
            { value: 3, label: "High" },
        ];
        const onChange = vi.fn();
        const container = document.createElement("div");
        addModeSlider(container, "Level", numOptions, 1, onChange);

        expect(txt(container.querySelector(".cs-value"))).toBe("Low");

        const top = container.querySelector(".cs-top")!;
        top.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(2);
        expect(txt(container.querySelector(".cs-value"))).toBe("Med");
    });

    it("单个选项时不崩溃（total=1，占比计算走 100% 分支）", () => {
        const container = document.createElement("div");
        addModeSlider(
            container, "Solo", [{ value: "only", label: "OnlyOne" }], "only", vi.fn(),
        );

        expect(txt(container.querySelector(".cs-value"))).toBe("OnlyOne");
        const fill = container.querySelector(".cs-fill") as HTMLElement;
        expect(fill.style.width).toBe("100%");
    });
});
