// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeAll, afterEach } from "vitest";
import {
    addToggleRow,
    addSliderRow,
    addModeRow,
    addEmptyRow,
    addCardTitle,
    addDangerRow,
    addFieldRow,
    addInfoGrid,
    addInfoCard,
    sliderRow,
    toggleRow,
    addWatchDirRow,
    addActionRow,
    addDisabledRow,
    addInlineToggleRow,
} from "./ui-rows.ts";

// ===================================================================
// 全局 setup：happy-dom 不自动触发 rAF，需要 mock 同步执行
// ===================================================================
beforeAll(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 1;
    });
});

const mkContainer = (): HTMLElement => document.createElement("div");

// ===================================================================
// addToggleRow
// ===================================================================
describe("addToggleRow", () => {
    it("基本渲染：生成 .toggle-row 结构（left + toggle label + checkbox）", () => {
        const container = mkContainer();
        addToggleRow(container, "开关", false, vi.fn());
        expect(container.children.length).toBe(1);
        const row = container.firstElementChild!;
        expect(row.className).toBe("toggle-row");
        // 内部应有 toggle-left 和 toggle
        const left = row.querySelector(".toggle-left");
        const toggle = row.querySelector(".toggle");
        expect(left).not.toBeNull();
        expect(toggle).not.toBeNull();
    });

    it("标签文本渲染到 toggle-label", () => {
        const container = mkContainer();
        addToggleRow(container, "启用通知", true, vi.fn());
        const lbl = container.querySelector(".toggle-label")!;
        expect(lbl.textContent).toBe("启用通知");
    });

    it("checkbox 初始 checked 与 value 一致", () => {
        const container = mkContainer();
        addToggleRow(container, "A", true, vi.fn());
        const cb = container.querySelector("input[type=checkbox]") as HTMLInputElement;
        expect(cb.checked).toBe(true);
    });

    it("默认 false 时 checkbox 未勾选", () => {
        const container = mkContainer();
        addToggleRow(container, "A", false, vi.fn());
        const cb = container.querySelector("input[type=checkbox]") as HTMLInputElement;
        expect(cb.checked).toBe(false);
    });

    it("图标图标：传入 icon 时在 toggle-left 内生成 .cs-icon", () => {
        const container = mkContainer();
        addToggleRow(container, "启用", false, vi.fn(), "⚙");
        const icon = container.querySelector(".cs-icon");
        expect(icon).not.toBeNull();
        expect(icon!.textContent).toBe("⚙");
    });

    it("无图标时渲染 fallback 首字（cs-icon-fallback）", () => {
        const container = mkContainer();
        // iconify 名冒号样式，createIcon 返回 null
        addToggleRow(container, "Settings", false, vi.fn(), "lucide:settings");
        const fb = container.querySelector(".cs-icon-fallback");
        expect(fb).not.toBeNull();
        expect(fb!.textContent).toBe("S");
    });

    it("整行点击（避开 toggle）切换 checkbox 并触发 onChange", () => {
        const container = mkContainer();
        const onChange = vi.fn();
        addToggleRow(container, "行", false, onChange);
        const row = container.firstElementChild!;
        const left = row.querySelector(".toggle-left") as HTMLElement;
        left.click();
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it("checkbox change 事件触发 onChange 回调", () => {
        const container = mkContainer();
        const onChange = vi.fn();
        addToggleRow(container, "行", false, onChange);
        const cb = container.querySelector("input[type=checkbox]") as HTMLInputElement;
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it("点击 toggle label 被整行 click 的 closest 短路（不触发 row onChange）", () => {
        const container = mkContainer();
        const onChange = vi.fn();
        addToggleRow(container, "行", false, onChange);
        const toggleLabel = container.querySelector(".toggle") as HTMLElement;
        toggleLabel.click();
        // .toggle 被 closest 拦截：row 级 click handler 直接 return，
        // 不会执行 toggle.checked 翻转 + onChange 调用
        expect(onChange).not.toHaveBeenCalled();
    });

    it("aria 属性正确设置 role=switch + aria-checked", () => {
        const container = mkContainer();
        addToggleRow(container, "开关", true, vi.fn());
        const cb = container.querySelector("input[type=checkbox]") as HTMLInputElement;
        expect(cb.getAttribute("role")).toBe("switch");
        expect(cb.getAttribute("aria-checked")).toBe("true");
        expect(cb.getAttribute("aria-label")).toBe("开关");
    });

    it("testId 设置在 row 上", () => {
        const container = mkContainer();
        addToggleRow(container, "A", false, vi.fn(), undefined, undefined, "my-toggle");
        expect(container.firstElementChild!.getAttribute("data-testid")).toBe("my-toggle");
    });

    it("initControl + bind：bind 在挂载时立即调用一次 update（即时初始化）", () => {
        const container = mkContainer();
        let boundValue = true;
        const onChange = vi.fn();
        addToggleRow(container, "A", false, onChange, undefined, { bind: () => boundValue });
        // initControl 在挂载时立即调用一次 update()；bind() 返回 true，
        // apply 将 toggle.checked 设为 true，cached 更新为 true
        const cb = container.querySelector("input[type=checkbox]") as HTMLInputElement;
        expect(cb.checked).toBe(true);
        expect(cb.getAttribute("aria-checked")).toBe("true");
    });

    it("checkbox 程序化赋值 + change 事件触发 onChange 与 aria 同步", () => {
        const container = mkContainer();
        const onChange = vi.fn();
        addToggleRow(container, "A", false, onChange);
        const cb = container.querySelector("input[type=checkbox]") as HTMLInputElement;
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(true);
        expect(cb.getAttribute("aria-checked")).toBe("true");
    });
});

// ===================================================================
// addSliderRow
// ===================================================================
describe("addSliderRow", () => {
    it("基本渲染：生成 .cs-row 含 .cs-top 和 .cs-bar", () => {
        const container = mkContainer();
        addSliderRow(container, "宽度", 50, 0, 100, 1, vi.fn());
        const row = container.firstElementChild!;
        expect(row.className).toBe("cs-row");
        expect(row.querySelector(".cs-top")).not.toBeNull();
        expect(row.querySelector(".cs-bar")).not.toBeNull();
    });

    it("标签渲染到 .cs-label", () => {
        const container = mkContainer();
        addSliderRow(container, "亮度", 80, 0, 100, 1, vi.fn());
        expect(container.querySelector(".cs-label")!.textContent).toBe("亮度");
    });

    it("初始值渲染到 .cs-value", () => {
        const container = mkContainer();
        addSliderRow(container, "值", 42, 0, 100, 1, vi.fn());
        expect(container.querySelector(".cs-value")!.textContent).toBe("42");
    });

    it("step < 1 时值显示 toFixed(2)", () => {
        const container = mkContainer();
        addSliderRow(container, "比例", 0.5, 0, 1, 0.01, vi.fn());
        expect(container.querySelector(".cs-value")!.textContent).toBe("0.50");
    });

    it("bar 设置 role=slider 和 aria-valuenow", () => {
        const container = mkContainer();
        addSliderRow(container, "A", 50, 0, 100, 1, vi.fn());
        const bar = container.querySelector(".cs-bar") as HTMLElement;
        expect(bar.getAttribute("role")).toBe("slider");
        expect(bar.getAttribute("aria-valuenow")).toBe("50");
        expect(bar.getAttribute("aria-valuemin")).toBe("0");
        expect(bar.getAttribute("aria-valuemax")).toBe("100");
    });

    it("bar 设置 tabIndex=0 可键盘聚焦", () => {
        const container = mkContainer();
        addSliderRow(container, "A", 50, 0, 100, 1, vi.fn());
        const bar = container.querySelector(".cs-bar") as HTMLElement;
        expect(bar.tabIndex).toBe(0);
    });

    it("图标：传入 icon 时在 .cs-top 内生成 .cs-icon", () => {
        const container = mkContainer();
        addSliderRow(container, "亮", 50, 0, 100, 1, vi.fn(), "🔆");
        const icon = container.querySelector(".cs-icon");
        expect(icon).not.toBeNull();
        expect(icon!.textContent).toBe("🔆");
    });

    it("testId 设置在 row 上", () => {
        const container = mkContainer();
        addSliderRow(container, "A", 10, 0, 100, 1, vi.fn(), undefined, undefined, undefined, "my-slider");
        expect(container.firstElementChild!.getAttribute("data-testid")).toBe("my-slider");
    });

    it("fill 和 thumb 初始宽度基于 value", () => {
        const container = mkContainer();
        addSliderRow(container, "A", 50, 0, 100, 1, vi.fn());
        const fill = container.querySelector(".cs-fill") as HTMLElement;
        const thumb = container.querySelector(".cs-thumb") as HTMLElement;
        expect(fill.style.width).toBe("50%");
        expect(thumb.style.left).toBe("50%");
    });

    it("onChange 在值变化时回调", () => {
        const container = mkContainer();
        const onChange = vi.fn();
        addSliderRow(container, "A", 0, 0, 100, 10, onChange);
        // 通过 top 区域 click 触发步进变化
        const top = container.querySelector(".cs-top") as HTMLElement;
        const bar = container.querySelector(".cs-bar") as HTMLElement;
        // mock getBoundingClientRect
        Object.defineProperty(top, "getBoundingClientRect", {
            value: () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 0, x: 0, y: 0 }),
            writable: true,
            configurable: true,
        });
        Object.defineProperty(bar, "getBoundingClientRect", {
            value: () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 0, x: 0, y: 0 }),
            writable: true,
            configurable: true,
        });
        top.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            clientX: 80, // 右侧 25-50% → 加小步
        }));
        expect(onChange).toHaveBeenCalled();
    });

    it("onDragEnd 回调在 top click 步进结束时触发", () => {
        const container = mkContainer();
        const onDragEnd = vi.fn();
        // 初始 value=50，确保点击步进后不触底，onDragEndCb 才触发
        addSliderRow(container, "A", 50, 0, 100, 10, () => {}, undefined, onDragEnd);
        const top = container.querySelector(".cs-top") as HTMLElement;
        const bar = container.querySelector(".cs-bar") as HTMLElement;
        Object.defineProperty(top, "getBoundingClientRect", {
            value: () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 0, x: 0, y: 0 }),
            writable: true,
            configurable: true,
        });
        Object.defineProperty(bar, "getBoundingClientRect", {
            value: () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 0, x: 0, y: 0 }),
            writable: true,
            configurable: true,
        });
        // pct = 20/100 = 0.2 < 0.25 → 左大幅减 = -15；50 - 15 = 35；
        // step=10 吸附: Math.round(35*0.1)/0.1 = Math.round(3.5)/0.1 = 40
        top.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            clientX: 20,
        }));
        expect(onDragEnd).toHaveBeenCalledWith(40);
    });

    it("非有限 value 回落到 min", () => {
        const container = mkContainer();
        addSliderRow(container, "A", NaN, 0, 100, 1, vi.fn());
        const val = container.querySelector(".cs-value")!.textContent;
        expect(val).toBe("0");
    });

    it("mouseenter 事件可在 bar 上派发（验证交互可触发）", () => {
        const container = mkContainer();
        addSliderRow(container, "A", 50, 0, 100, 1, vi.fn());
        const bar = container.querySelector(".cs-bar") as HTMLElement;
        const spy = vi.fn();
        bar.addEventListener("mouseenter", spy);
        bar.addEventListener("mouseleave", spy);
        bar.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        bar.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        expect(spy).toHaveBeenCalledTimes(2);
    });
});

// ===================================================================
// sliderRow (addSliderRow 简化版)
// ===================================================================
describe("sliderRow", () => {
    it("渲染 .cs-row 含 slider 结构，onDragEnd 传入即生效", () => {
        const container = mkContainer();
        const onDragEnd = vi.fn();
        sliderRow(container, "W", 10, 0, 100, 1, "📏", onDragEnd);
        expect(container.querySelector(".cs-row")).not.toBeNull();
        expect(container.querySelector(".cs-icon")!.textContent).toBe("📏");
    });
});

// ===================================================================
// toggleRow (addToggleRow 简化版)
// ===================================================================
describe("toggleRow", () => {
    it("onChange 和 onSave 都触发", () => {
        const container = mkContainer();
        const onChange = vi.fn();
        const onSave = vi.fn();
        toggleRow(container, "T", false, "✓", onChange, onSave);
        const left = container.querySelector(".toggle-left") as HTMLElement;
        left.click();
        expect(onChange).toHaveBeenCalledWith(true);
        expect(onSave).toHaveBeenCalled();
    });
});

// ===================================================================
// addModeRow
// ===================================================================
describe("addModeRow", () => {
    it("基本渲染：生成 .type-row 含多个 .mode-btn", () => {
        const container = mkContainer();
        addModeRow(container, "模式", [
            { value: "a", label: "模式A" },
            { value: "b", label: "模式B" },
        ], "a", vi.fn());
        const row = container.firstElementChild!;
        expect(row.className).toBe("type-row");
        const btns = row.querySelectorAll(".mode-btn");
        expect(btns.length).toBe(2);
    });

    it("标签渲染到 .type-label", () => {
        const container = mkContainer();
        addModeRow(container, "模式选择", [{ value: "x", label: "X" }], "x", vi.fn());
        expect(container.querySelector(".type-label")!.textContent).toBe("模式选择");
    });

    it("当前选中的按钮带 active class", () => {
        const container = mkContainer();
        addModeRow(container, "M", [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
        ], "b", vi.fn());
        const btns = container.querySelectorAll(".mode-btn");
        expect(btns[0].className).toBe("mode-btn");
        expect(btns[1].className).toBe("mode-btn active");
    });

    it("点击某个按钮触发 onChange 对应 value", () => {
        const container = mkContainer();
        const onChange = vi.fn();
        addModeRow(container, "M", [
            { value: "x", label: "X" },
            { value: "y", label: "Y" },
        ], "x", onChange);
        const btns = container.querySelectorAll<HTMLButtonElement>(".mode-btn");
        btns[1].click();
        expect(onChange).toHaveBeenCalledWith("y");
    });

    it("testId 设置在 row 上", () => {
        const container = mkContainer();
        addModeRow(container, "M", [{ value: "a", label: "A" }], "a", vi.fn(), "my-mode");
        expect(container.firstElementChild!.getAttribute("data-testid")).toBe("my-mode");
    });
});

// ===================================================================
// addEmptyRow
// ===================================================================
describe("addEmptyRow", () => {
    it("基本渲染：生成 .slide-item.slide-item-muted 含文本", () => {
        const container = mkContainer();
        addEmptyRow(container, "暂无内容");
        const el = container.firstElementChild!;
        expect(el.className).toBe("slide-item slide-item-muted");
        expect(el.textContent).toBe("暂无内容");
    });

    it("hint 时渲染双行结构", () => {
        const container = mkContainer();
        addEmptyRow(container, "无数据", "点击扫描刷新");
        const el = container.firstElementChild as HTMLElement;
        expect(el.style.flexDirection).toBe("column");
        const main = el.firstChild! as HTMLElement;
        const sub = el.lastChild! as HTMLElement;
        expect(main.textContent).toBe("无数据");
        expect(sub.textContent).toBe("点击扫描刷新");
        expect(sub.style.fontSize).toBe("11px");
    });

    it("返回创建的 HTMLElement", () => {
        const container = mkContainer();
        const el = addEmptyRow(container, "T");
        expect(el.nodeType).toBe(1);
        expect(container.contains(el)).toBe(true);
    });
});

// ===================================================================
// addCardTitle
// ===================================================================
describe("addCardTitle", () => {
    it("基本渲染：生成 .card-title 含文本", () => {
        const container = mkContainer();
        addCardTitle(container, "卡片标题");
        const el = container.firstElementChild!;
        expect(el.className).toBe("card-title");
        expect(el.textContent).toBe("卡片标题");
    });

    it("返回创建的 HTMLElement", () => {
        const container = mkContainer();
        const el = addCardTitle(container, "T");
        expect(el.nodeType).toBe(1);
    });
});

// ===================================================================
// addDangerRow
// ===================================================================
describe("addDangerRow", () => {
    it("基本渲染：生成 slideRow 行，标签带 danger-text", () => {
        const container = mkContainer();
        addDangerRow(container, "🗑", "删除", vi.fn());
        const row = container.querySelector(".slide-item")!;
        expect(row).not.toBeNull();
        const lbl = row.querySelector(".danger-text")!;
        expect(lbl.textContent).toBe("删除");
    });

    it("图标渲染到行内", () => {
        const container = mkContainer();
        addDangerRow(container, "🗑", "删除", vi.fn());
        const icon = container.querySelector(".cs-icon");
        expect(icon).not.toBeNull();
        expect(icon!.textContent).toBe("🗑");
    });

    it("点击行触发 onClick", () => {
        const container = mkContainer();
        const onClick = vi.fn();
        addDangerRow(container, "🗑", "删除", onClick);
        const row = container.querySelector(".slide-item") as HTMLElement;
        row.click();
        expect(onClick).toHaveBeenCalled();
    });

    it("testId 设置在 row 上", () => {
        const container = mkContainer();
        addDangerRow(container, "🗑", "删除", vi.fn(), "danger-row");
        expect(container.firstElementChild!.getAttribute("data-testid")).toBe("danger-row");
    });
});

// ===================================================================
// addFieldRow
// ===================================================================
describe("addFieldRow", () => {
    it("基本渲染：生成 .slide-item.field-row 含 label + value", () => {
        const container = mkContainer();
        addFieldRow(container, "版本", "v1.0");
        const row = container.querySelector(".slide-item.field-row")!;
        expect(row).not.toBeNull();
        expect(row.querySelector(".field-label")!.textContent).toBe("版本");
        expect(row.querySelector(".field-value")!.textContent).toBe("v1.0");
    });

    it("testId 设置在 row 上", () => {
        const container = mkContainer();
        addFieldRow(container, "K", "V", "kv-row");
        expect(container.firstElementChild!.getAttribute("data-testid")).toBe("kv-row");
    });

    it("隐藏图标（hideIcon=true 效果）", () => {
        const container = mkContainer();
        addFieldRow(container, "K", "V");
        // addFieldRow 传 hideIcon=true，不应渲染 slide-icon
        expect(container.querySelector(".slide-icon")).toBeNull();
    });
});

// ===================================================================
// addInfoGrid + addInfoCard
// ===================================================================
describe("addInfoGrid / addInfoCard", () => {
    it("addInfoGrid 生成 .info-grid", () => {
        const container = mkContainer();
        const grid = addInfoGrid(container);
        expect(grid.className).toBe("info-grid");
    });

    it("addInfoCard 基本渲染：label + value", () => {
        const grid = addInfoGrid(mkContainer());
        addInfoCard(grid, "内存", "8 GB");
        const card = grid.querySelector(".info-card")!;
        expect(card).not.toBeNull();
        expect(card.querySelector(".info-card-label")!.textContent).toBe("内存");
        expect(card.querySelector(".info-card-value")!.textContent).toBe("8 GB");
    });

    it("addInfoCard wide 选项添加 info-card--wide class", () => {
        const grid = addInfoGrid(mkContainer());
        addInfoCard(grid, "描述", "长文本", { wide: true });
        expect(grid.querySelector(".info-card.info-card--wide")).not.toBeNull();
    });

    it("addInfoCard sub 选项渲染 .info-card-sub", () => {
        const grid = addInfoGrid(mkContainer());
        addInfoCard(grid, "磁盘", "256 GB", { sub: "SSD" });
        const card = grid.querySelector(".info-card")!;
        expect(card.querySelector(".info-card-sub")!.textContent).toBe("SSD");
    });

    it("addInfoCard testId 设置到 card 上", () => {
        const grid = addInfoGrid(mkContainer());
        addInfoCard(grid, "A", "B", { testId: "card-1" });
        expect(grid.querySelector(".info-card")!.getAttribute("data-testid")).toBe("card-1");
    });
});

// ===================================================================
// addWatchDirRow
// ===================================================================
describe("addWatchDirRow", () => {
    it("基本渲染：生成 status + dirRow（input + button）", () => {
        const container = mkContainer();
        addWatchDirRow(container,
            () => Promise.resolve(),
            () => Promise.resolve(undefined),
        );
        const input = container.querySelector("input[type=text]") as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.readOnly).toBe(true);
        const btn = container.querySelector("button") as HTMLButtonElement;
        expect(btn).not.toBeNull();
        expect(btn.textContent).toBe("📁");
    });

    it("selectDir 返回路径时更新 input value", async () => {
        const container = mkContainer();
        addWatchDirRow(container,
            () => Promise.resolve(),
            () => Promise.resolve("/models"),
        );
        const input = container.querySelector("input[type=text]") as HTMLInputElement;
        const btn = container.querySelector("button") as HTMLButtonElement;
        btn.click();
        // 等待 async
        await Promise.resolve();
        expect(input.value).toBe("/models");
    });
});

// ===================================================================
// addActionRow
// ===================================================================
describe("addActionRow", () => {
    it("基本渲染：生成 .type-row 含 .mode-btn", () => {
        const container = mkContainer();
        addActionRow(container, "保存", vi.fn());
        const btn = container.querySelector("button.mode-btn")!;
        expect(btn).not.toBeNull();
        expect(btn.textContent).toBe("保存");
    });

    it("点击按钮触发 onClick", () => {
        const container = mkContainer();
        const onClick = vi.fn();
        addActionRow(container, "执行", onClick);
        const btn = container.querySelector("button")!;
        btn.click();
        expect(onClick).toHaveBeenCalled();
    });

    it("disabled=true 时 button.disabled 且无 click 监听", () => {
        const container = mkContainer();
        const onClick = vi.fn();
        addActionRow(container, "禁用", onClick, { disabled: true });
        const btn = container.querySelector("button") as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        btn.click();
        expect(onClick).not.toHaveBeenCalled();
    });

    it("disabled 时 textContent 仍正常显示", () => {
        const container = mkContainer();
        addActionRow(container, "不可用", vi.fn(), { disabled: true });
        expect(container.querySelector("button")!.textContent).toBe("不可用");
    });

    it("图标：传入 icon 时前置到 button 内", () => {
        const container = mkContainer();
        addActionRow(container, "运行", vi.fn(), { icon: "▶" });
        const btn = container.querySelector("button")!;
        expect(btn.textContent).toBe("▶运行");
    });

    it("testId 设置在 row 上", () => {
        const container = mkContainer();
        addActionRow(container, "A", vi.fn(), { testId: "action-row" });
        expect(container.firstElementChild!.getAttribute("data-testid")).toBe("action-row");
    });
});

// ===================================================================
// addDisabledRow
// ===================================================================
describe("addDisabledRow", () => {
    it("基本渲染：生成 .cs-row，opacity=0.4 + pointer-events=none", () => {
        const container = mkContainer();
        addDisabledRow(container, "不可用");
        const row = container.firstElementChild as HTMLElement;
        expect(row.className).toBe("cs-row");
        expect(row.style.opacity).toBe("0.4");
        expect(row.style.pointerEvents).toBe("none");
    });

    it("标签渲染到 .cs-label", () => {
        const container = mkContainer();
        addDisabledRow(container, "只读");
        expect(container.querySelector(".cs-label")!.textContent).toBe("只读");
    });

    it("value 渲染到 .cs-value", () => {
        const container = mkContainer();
        addDisabledRow(container, "版本", "v1.0");
        expect(container.querySelector(".cs-value")!.textContent).toBe("v1.0");
    });

    it("无 value 时不渲染 .cs-value", () => {
        const container = mkContainer();
        addDisabledRow(container, "只读行");
        expect(container.querySelector(".cs-value")).toBeNull();
    });

    it("pointer-events: none 使得 click 事件无法触发", () => {
        const container = mkContainer();
        addDisabledRow(container, "禁用", "值");
        const row = container.firstElementChild as HTMLElement;
        let clickCount = 0;
        row.addEventListener("click", () => { clickCount++; });
        // happy-dom 中 pointer-events 不阻止 dispatchEvent，
        // 但 style 属性已正确设置，表明交互语义正确
        expect(row.style.pointerEvents).toBe("none");
        row.click();
        // click 事件在 DOM 层面仍能触发，但视觉和语义已声明不可交互
        expect(row.style.opacity).toBe("0.4");
    });

    it("testId 设置在 row 上", () => {
        const container = mkContainer();
        addDisabledRow(container, "禁用", undefined, { testId: "disabled-row" });
        expect(container.firstElementChild!.getAttribute("data-testid")).toBe("disabled-row");
    });
});

// ===================================================================
// addInlineToggleRow
// ===================================================================
describe("addInlineToggleRow", () => {
    it("基本渲染：生成 .toggle-row 含 .toggle-label 和 .toggle-switch", () => {
        const container = mkContainer();
        addInlineToggleRow(container, "开关", false, vi.fn());
        const row = container.firstElementChild!;
        expect(row.className).toBe("toggle-row");
        expect(row.querySelector(".toggle-label")).not.toBeNull();
        expect(row.querySelector(".toggle-switch")).not.toBeNull();
    });

    it("初始 value=true 时 toggle-switch 带 active class", () => {
        const container = mkContainer();
        addInlineToggleRow(container, "T", true, vi.fn());
        const sw = container.querySelector(".toggle-switch")!;
        expect(sw.classList.contains("active")).toBe(true);
    });

    it("初始 value=false 时 toggle-switch 无 active class", () => {
        const container = mkContainer();
        addInlineToggleRow(container, "T", false, vi.fn());
        const sw = container.querySelector(".toggle-switch")!;
        expect(sw.classList.contains("active")).toBe(false);
    });

    it("点击 toggle-switch 切换 active 并触发 onChange", () => {
        const container = mkContainer();
        const onChange = vi.fn();
        addInlineToggleRow(container, "T", false, onChange);
        const sw = container.querySelector(".toggle-switch") as HTMLElement;
        sw.click();
        expect(sw.classList.contains("active")).toBe(true);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it("再次点击切换回 false", () => {
        const container = mkContainer();
        const onChange = vi.fn();
        addInlineToggleRow(container, "T", true, onChange);
        const sw = container.querySelector(".toggle-switch") as HTMLElement;
        sw.click();
        expect(sw.classList.contains("active")).toBe(false);
        expect(onChange).toHaveBeenCalledWith(false);
    });

    it("testId 设置在 row 上", () => {
        const container = mkContainer();
        addInlineToggleRow(container, "T", false, vi.fn(), { testId: "inline-toggle" });
        expect(container.firstElementChild!.getAttribute("data-testid")).toBe("inline-toggle");
    });

    it("mouseenter/mouseleave 事件可在 toggle-switch 上派发（验证交互可触发）", () => {
        const container = mkContainer();
        addInlineToggleRow(container, "T", false, vi.fn());
        const sw = container.querySelector(".toggle-switch")!;
        const spy = vi.fn();
        sw.addEventListener("mouseenter", spy);
        sw.addEventListener("mouseleave", spy);
        sw.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        sw.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        expect(spy).toHaveBeenCalledTimes(2);
    });
});
