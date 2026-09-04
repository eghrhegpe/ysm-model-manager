// [doc:architecture] ui-rows — 菜单行控件（toggle/slider/mode）
// addToggleRow / addSliderRow / addModeRow / sliderRow / toggleRow
// 自 MikuMikuAR 迁移：解耦 render-context(i18n/iconify)，依赖改为本库与 utils/core。

import { createIcon, createIconBox } from "./icons.ts";
import { registerControl } from "./control-registry.ts";
import type { ControlOptions } from "./ui-types.ts";
import { slideRow } from "./ui-slide-row.ts";
import { clamp01, clampPct } from "../utils/core/clamp.ts";
import { DragSliderController } from "./ui-slider-controller.ts";
import { SLIDER_QUARTER_LARGE_STEP, SLIDER_QUARTER_SMALL_STEP } from "./ui-constants.ts";
// DOM 契约单源：role/class 由 dom-contract 提供，禁止手写字符串
import { ROLE, SLIDER_BAR_CLASS, ARIA_ATTR } from "./dom-contract.ts";

// ===================================================================
// createIconBox 现为 icons.ts 导出（icon 渲染工具，消除多文件重复）：
// 创建 <span.cs-icon> 元素：有图标则插入 createIcon 结果，无图标则用首字 fallback。
// ===================================================================

// 自增计数器，用于生成稳定的唯一 ID
let nextToggleId = 0;

/** Toggle DOM 元素包，供各子函数传递引用 */
interface ToggleElements {
    row: HTMLDivElement;
    toggle: HTMLInputElement;
}

/**
 * [子函数 1/4] 构建 Toggle 全套 DOM 元素：row / left / icon / label / toggle(input) / slider。
 * 返回元素包供后续阶段消费。
 */
function buildToggleElements(
    label: string,
    value: boolean,
    icon: string | undefined,
    testId: string | undefined
): ToggleElements {
    const row = document.createElement('div');
    row.className = 'toggle-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }

    const left = document.createElement('div');
    left.className = 'toggle-left';

    if (icon) {
        createIconBox(icon, label, left);
    }

    const lbl = document.createElement('span');
    lbl.className = 'toggle-label';
    lbl.textContent = label;
    lbl.id = `toggle-${++nextToggleId}`;
    left.appendChild(lbl);

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = value;
    toggle.setAttribute('role', ROLE.switch);
    toggle.setAttribute(ARIA_ATTR.label, label);
    toggle.setAttribute(ARIA_ATTR.checked, String(value));
    toggle.setAttribute(ARIA_ATTR.labelledby, lbl.id);

    const slider = document.createElement('span');
    slider.className = 'slider';
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(slider);

    row.appendChild(left);
    row.appendChild(toggleLabel);

    return { row, toggle };
}

/**
 * [子函数 2/4] 同步 Toggle 状态：input.checked + ARIA checked。
 * 用于 checkbox change、整行点击、自更新三处共享逻辑，消除重复。
 */
function updateToggleState(toggle: HTMLInputElement, v: boolean): void {
    toggle.checked = v;
    toggle.setAttribute(ARIA_ATTR.checked, String(v));
}

/**
 * [子函数 3/4] 整行点击切换（除 toggle 开关本体外的区域）。
 * 点击开关本身时由原生 change 事件接管，避免重复触发 onChange。
 */
function handleToggleRowClick(
    e: MouseEvent,
    toggle: HTMLInputElement,
    onChange: (v: boolean) => void
): void {
    if ((e.target as HTMLElement).closest('.toggle')) {
        return;
    }
    const next = !toggle.checked;
    updateToggleState(toggle, next);
    onChange(next);
}

/**
 * [子函数 4/4] 注册自更新支持：外部 bind/onUpdate 触发时同步更新 checked/ARIA 状态。
 */
function initToggleControl(
    els: ToggleElements,
    opts: ControlOptions<boolean> | undefined,
    initial: boolean
): void {
    initControl(els.row, opts, initial, (v, cached) => {
        const b = !!v;
        if (b === cached) {
            return false;
        }
        updateToggleState(els.toggle, b);
        return true;
    });
}

// ===================================================================
// addToggleRow — 主函数
// ===================================================================

export function addToggleRow(
    container: HTMLElement,
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
    icon?: string,
    opts?: ControlOptions<boolean>,
    testId?: string
): void {
    // 阶段1：构建 DOM 元素
    const els = buildToggleElements(label, value, icon, testId);

    // 阶段2：绑定 checkbox change 监听（复用 updateToggleState）
    els.toggle.addEventListener('change', () => {
        updateToggleState(els.toggle, els.toggle.checked);
        onChange(els.toggle.checked);
    });

    // 阶段3：整行点击切换
    els.row.addEventListener('click', (e) => handleToggleRowClick(e, els.toggle, onChange));

    // 阶段4：挂载 + 自更新注册
    container.appendChild(els.row);
    initToggleControl(els, opts, value);
}

// ===================================================================
// initControl — 控件自更新注册 + 立即初始化
// ===================================================================

// 递增计数器，为每个 initControl 调用生成唯一 id，防止多实例注册 ID 互相覆盖
let _initControlSeq = 0;

/**
 * 封装 registerControl + immediate update 模式。
 * `apply` 返回 true 表示值已变更，用于更新缓存。
 */
export function initControl<T>(
    el: HTMLElement,
    opts: ControlOptions<T> | undefined,
    initial: T,
    apply: (v: T, cached: T) => boolean
): void {
    if (!opts) {
        return;
    }
    let cached = initial;
    const update = (): void => {
        if (opts.onUpdate) {
            opts.onUpdate(el);
            return;
        }
        if (!opts.bind) {
            return;
        }
        const v = opts.bind();
        if (apply(v, cached)) {
            cached = v;
        }
    };
    // 解耦：原 getCurrentRenderingContext()?.registerControl(...) 改为可选注入的注册表。
    // 未接入外部系统时 bind 仍会在挂载时通过下方 update() 即时初始化一次。
    // 使用递增计数器确保每个行控件有唯一 id，避免多实例互相覆盖（P1-2 修复）。
    const _rowId = ++_initControlSeq;
    registerControl(`slider-row-bind:${_rowId}`, update);
    update();
}

// ===================================================================
// addSliderRow — 子函数类型与工具
// ===================================================================

/** Slider DOM 元素包，供各子函数传递引用 */
interface SliderElements {
    row: HTMLDivElement;
    top: HTMLDivElement;
    bar: HTMLDivElement;
    fill: HTMLDivElement;
    thumb: HTMLDivElement;
    val: HTMLSpanElement;
}

/**
 * [子函数 1/5] 构建 Slider 全套 DOM 元素：row / top / label / value / bar / fill / thumb。
 * 返回元素包供后续阶段消费。
 */
function buildSliderElements(
    label: string,
    min: number,
    max: number,
    icon: string | undefined,
    testId: string | undefined
): SliderElements {
    const row = document.createElement('div');
    row.className = 'cs-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }

    const top = document.createElement('div');
    top.className = 'cs-top';
    if (icon) {
        createIconBox(icon, label, top);
    }

    const lbl = document.createElement('span');
    lbl.className = 'cs-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = 'cs-value';

    top.appendChild(lbl);
    top.appendChild(val);

    const bar = document.createElement('div');
    bar.className = SLIDER_BAR_CLASS;
    bar.tabIndex = 0;
    bar.setAttribute('role', ROLE.slider);
    bar.setAttribute(ARIA_ATTR.label, label);
    bar.setAttribute(ARIA_ATTR.valuemin, String(min));
    bar.setAttribute(ARIA_ATTR.valuemax, String(max));

    const fill = document.createElement('div');
    fill.className = 'cs-fill';

    const thumb = document.createElement('div');
    thumb.className = 'cs-thumb';

    bar.appendChild(fill);
    bar.appendChild(thumb);

    return { row, top, bar, fill, thumb, val };
}

/**
 * [子函数 2/5] 更新 Slider 显示：value 文本、fill 宽度、thumb 位置、ARIA valuenow。
 * 原闭包升格为包级函数，接收 currentValue 引用以回写值。
 */
function updateSliderDisplay(
    v: number,
    step: number,
    min: number,
    range: number,
    els: SliderElements,
    currentValueRef: { value: number }
): void {
    currentValueRef.value = v;
    els.val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
    const newPct = ((v - min) / range) * 100;
    const clamped = clampPct(newPct);
    els.fill.style.width = clamped + '%';
    els.thumb.style.left = clamped + '%';
    els.bar.setAttribute(ARIA_ATTR.valuenow, String(v));
}

/**
 * [子函数 3/5] 创建并绑定 DragSliderController，返回控制器实例 + 挂载 dispose 清理钩子。
 */
function bindSliderController(
    els: SliderElements,
    min: number,
    max: number,
    step: number,
    currentValueRef: { value: number },
    onChange: (v: number) => void,
    onDragEndCb: ((v: number) => void) | undefined
): DragSliderController {
    const controller = new DragSliderController({
        value: currentValueRef.value,
        min,
        max,
        step,
        onChange: (v) => {
            updateSliderDisplay(v, step, min, max - min, els, currentValueRef);
            onChange(v);
        },
        onDragEnd: (v) => {
            onDragEndCb?.(v);
        },
    });
    const disposeSlider = controller.bind(els.bar);
    // 保存 Disposable 到 row 元素，供上层清理时调用（P1-1 修复）
    (els.row as unknown as Record<string, unknown>).__disposeSlider = () => disposeSlider.dispose();
    return controller;
}

/**
 * [子函数 4/5] cs-top 四分区域相对步进点击：左→右 = 减大步 → 减小步 → 加小步 → 加大步。
 */
function handleTopSliderClick(
    e: MouseEvent,
    min: number,
    max: number,
    step: number,
    range: number,
    els: SliderElements,
    currentValueRef: { value: number },
    onChange: (v: number) => void,
    onDragEndCb: ((v: number) => void) | undefined
): void {
    e.stopPropagation();
    const rect = els.top.getBoundingClientRect();
    const pct = clamp01((e.clientX - rect.left) / rect.width);
    const delta =
        pct < 0.25
            ? -(range * SLIDER_QUARTER_LARGE_STEP)
            : pct < 0.5
              ? -(range * SLIDER_QUARTER_SMALL_STEP)
              : pct < 0.75
                ? range * SLIDER_QUARTER_SMALL_STEP
                : range * SLIDER_QUARTER_LARGE_STEP;
    const raw = currentValueRef.value + delta;
    const precision = step > 0 ? 1 / step : 1;
    const snapped = Math.round(raw * precision) / precision;
    const clamped = Math.max(min, Math.min(max, snapped));
    if (clamped !== currentValueRef.value) {
        updateSliderDisplay(clamped, step, min, range, els, currentValueRef);
        onChange(clamped);
        onDragEndCb?.(clamped);
    }
}

/**
 * [子函数 5/5] 注册自更新支持：外部 bind/onUpdate 触发时同步更新显示与控制器内部值。
 */
function initSliderControl(
    els: SliderElements,
    opts: ControlOptions<number> | undefined,
    initial: number,
    step: number,
    min: number,
    max: number,
    currentValueRef: { value: number },
    controller: DragSliderController
): void {
    initControl(els.row, opts, initial, (v, cached) => {
        if (!Number.isFinite(v) || v === cached) {
            return false;
        }
        updateSliderDisplay(v, step, min, max - min, els, currentValueRef);
        controller.setValue(v);
        return true;
    });
}

// ===================================================================
// addSliderRow — 主函数
// ===================================================================

/**
 * 数字滑块行。内部统一由 {@link DragSliderController} 驱动
 * （拖拽 + 键盘 + 游标点击），行为与其他滑块 builder 保持一致。
 */
export function addSliderRow(
    container: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    icon?: string,
    onDragEndCb?: (v: number) => void,
    opts?: ControlOptions<number>,
    testId?: string
): void {
    // 防御: 非有限数值（undefined/NaN）回落到 min ?? 0，避免 .toFixed() 崩溃导致整个面板渲染失败
    const fallbackValue = min ?? 0;
    const currentValueRef = { value: typeof value === 'number' && Number.isFinite(value) ? value : fallbackValue };
    const range = max - min;

    // 阶段1：构建 DOM 元素
    const els = buildSliderElements(label, min, max, icon, testId);

    // 阶段2：初始化显示
    updateSliderDisplay(currentValueRef.value, step, min, range, els, currentValueRef);

    // 阶段3：绑定拖拽控制器
    const controller = bindSliderController(els, min, max, step, currentValueRef, onChange, onDragEndCb);

    // 阶段4：四分区域点击步进
    els.top.addEventListener('click', (e) =>
        handleTopSliderClick(e, min, max, step, range, els, currentValueRef, onChange, onDragEndCb)
    );

    // 阶段5：挂载 + 自更新注册
    els.row.appendChild(els.top);
    els.row.appendChild(els.bar);
    container.appendChild(els.row);

    initSliderControl(els, opts, value, step, min, max, currentValueRef, controller);
}

// ===================================================================
// addModeRow
// ===================================================================

export function addModeRow<T extends string | number>(
    container: HTMLElement,
    label: string,
    options: Array<{ value: T; label: string }>,
    currentValue: T,
    onChange: (v: T) => void,
    testId?: string
): void {
    const row = document.createElement('div');
    row.className = 'type-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }
    const lbl = document.createElement('span');
    lbl.className = 'type-label';
    lbl.textContent = label;
    row.appendChild(lbl);
    for (const opt of options) {
        const btn = document.createElement('button');
        btn.textContent = opt.label;
        btn.className = 'mode-btn' + (currentValue === opt.value ? ' active' : '');
        btn.addEventListener('click', () => onChange(opt.value));
        row.appendChild(btn);
    }
    container.appendChild(row);
}

// ===================================================================
// addEmptyRow — 空状态占位行
// ===================================================================

/**
 * 创建空状态占位行（灰色文字，不可点击），替代手动 `el.style.opacity = '0.5'` 模式
 * @param hint 可选第二行小字提示（居中双行引导场景），省略时保持单行行为
 */
export function addEmptyRow(parent: HTMLElement, text: string, hint?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'slide-item slide-item-muted';
    if (hint) {
        el.style.flexDirection = 'column';
        el.style.alignItems = 'center';
        el.style.textAlign = 'center';
        const main = document.createElement('div');
        main.textContent = text;
        const sub = document.createElement('div');
        sub.style.fontSize = '11px';
        sub.style.opacity = '0.7';
        sub.style.marginTop = '4px';
        sub.textContent = hint;
        el.append(main, sub);
    } else {
        el.textContent = text;
    }
    parent.appendChild(el);
    return el;
}

/** 创建 card-title 标题行并追加到容器 */
export function addCardTitle(container: HTMLElement, text: string): HTMLElement {
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = text;
    container.appendChild(title);
    return title;
}

// ===================================================================
// addDangerRow — 危险/删除操作行
// ===================================================================

/**
 * 创建危险操作行（icon + red label），替代手动拼接 `div.slide-item > icon + label.danger-text`
 */
export function addDangerRow(
    container: HTMLElement,
    icon: string,
    label: string,
    onClick: () => void,
    testId?: string
): HTMLElement {
    return slideRow(
        container,
        icon,
        label,
        false,
        onClick,
        undefined,
        undefined,
        undefined,
        undefined,
        {
            variant: 'danger',
            ...(testId ? { testId } : {}),
        }
    );
}

// ===================================================================
// addFieldRow — 键值字段行
// ===================================================================

/**
 * 创建字段行（左 label + 右 value），替代手动拼接的
 * `div.slide-item > span.slide-label.field-label + span.field-value`
 */
export function addFieldRow(
    container: HTMLElement,
    label: string,
    value: string,
    testId?: string
): HTMLElement {
    const row = slideRow(
        container,
        '',
        label,
        false,
        () => {},
        undefined,
        undefined,
        undefined,
        undefined,
        {
            rightLabel: value,
            hideIcon: true,
            ...(testId ? { testId } : {}),
        }
    );
    row.classList.add('field-row');
    return row;
}

// ===================================================================
// addInfoGrid / addInfoCard — 响应式信息卡网格
// 数字类短字段进常规卡（窄屏 2 列、宽屏 auto-fill 自动加列），
// 长文本字段传 wide:true 跨整行，避免截断。
// 用 textContent 写入，天然免疫 HTML 注入，无需 esc。
// ===================================================================

export function addInfoGrid(container: HTMLElement): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'info-grid';
    container.appendChild(grid);
    return grid;
}

export function addInfoCard(
    container: HTMLElement,
    label: string,
    value: string,
    opts?: { wide?: boolean; sub?: string; testId?: string }
): HTMLElement {
    const card = document.createElement('div');
    card.className = 'info-card' + (opts?.wide ? ' info-card--wide' : '');
    if (opts?.testId) {
        card.setAttribute('data-testid', opts.testId);
    }
    const labelEl = document.createElement('div');
    labelEl.className = 'info-card-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'info-card-value';
    valueEl.textContent = value;
    card.appendChild(labelEl);
    card.appendChild(valueEl);
    if (opts?.sub) {
        const subEl = document.createElement('div');
        subEl.className = 'info-card-sub';
        subEl.textContent = opts.sub;
        card.appendChild(subEl);
    }
    container.appendChild(card);
    return card;
}

// ===================================================================
// sliderRow — addSliderRow 的简化版，只保留 onDragEnd
// ===================================================================

export function sliderRow(
    container: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    icon: string,
    onDragEnd: (v: number) => void
): void {
    addSliderRow(container, label, value, min, max, step, () => {}, icon, onDragEnd);
}

// ===================================================================
// toggleRow — addToggleRow 的简化版，onChange 后自动调用 onSave
// ===================================================================

export function toggleRow(
    container: HTMLElement,
    label: string,
    value: boolean,
    icon: string,
    onChange: (v: boolean) => void,
    onSave?: () => void
): void {
    addToggleRow(
        container,
        label,
        value,
        (v) => {
            onChange(v);
            onSave?.();
        },
        icon
    );
}

// ===================================================================
// ADR-143 主题 6：收敛三个内联 DOM 孤岛
// ===================================================================
// 注：addWatchDirRow（监听目录行）已于 G3 复查确认生产零引用，删除（2026-09-04）。

/** 创建一个可点击的动作按钮行（替代手写 cs-row + button）。
 * 复用 addModeRow 的 mode-btn 样式，确保 UI 一致性。 */
export function addActionRow(
    container: HTMLElement,
    label: string,
    onClick: () => void,
    opts?: { icon?: string; disabled?: boolean; testId?: string }
): HTMLElement {
    const { icon, disabled, testId } = opts ?? {};
    const row = document.createElement('div');
    row.className = 'type-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }

    const btn = document.createElement('button');
    if (disabled) {
        btn.className = 'mode-btn';
        btn.disabled = true;
        btn.textContent = label;
    } else {
        btn.className = 'mode-btn';
        btn.style.flex = '1';
        btn.textContent = label;
        if (icon) {
            const iconEl = createIcon(icon);
            if (iconEl) {
                btn.prepend(iconEl);
            }
        }
        btn.addEventListener('click', onClick);
    }
    row.appendChild(btn);
    container.appendChild(row);
    return row;
}

/** 创建一个不可交互的提示行（替代手写 cs-row + opacity 0.4 + pointer-events none）。
 * 复用 cs-row / cs-label / cs-value 样式，视觉与既有行一致。 */
export function addDisabledRow(
    container: HTMLElement,
    label: string,
    value?: string,
    opts?: { testId?: string }
): HTMLElement {
    const { testId } = opts ?? {};
    const row = document.createElement('div');
    row.className = 'cs-row';
    row.style.opacity = '0.4';
    row.style.pointerEvents = 'none';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }
    const lbl = document.createElement('span');
    lbl.className = 'cs-label';
    lbl.textContent = label;
    row.appendChild(lbl);
    if (value !== undefined) {
        const val = document.createElement('span');
        val.className = 'cs-value';
        val.textContent = value;
        row.appendChild(val);
    }
    container.appendChild(row);
    return row;
}

/** 创建一个内联 toggle 行（替代手写 toggle-row + toggle-label + toggle-switch）。
 * 视觉上与 addToggleRow 保持一致，但用 span 模拟而非 input checkbox，
 * 适用于不需要 aria/accessibility 完整性的菜单内联场景。 */
export function addInlineToggleRow(
    container: HTMLElement,
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
    opts?: { testId?: string }
): HTMLElement {
    const { testId } = opts ?? {};
    const row = document.createElement('div');
    row.className = 'toggle-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }
    const lbl = document.createElement('span');
    lbl.className = 'toggle-label';
    lbl.textContent = label;
    const sw = document.createElement('span');
    sw.className = 'toggle-switch' + (value ? ' active' : '');
    sw.addEventListener('click', () => {
        const v = !sw.classList.contains('active');
        sw.classList.toggle('active', v);
        onChange(v);
    });
    row.appendChild(lbl);
    row.appendChild(sw);
    container.appendChild(row);
    return row;
}
