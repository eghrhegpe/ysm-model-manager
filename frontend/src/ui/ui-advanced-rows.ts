// [doc:architecture] ui-advanced-rows — 高级菜单行控件（color-slider / mode-slider）
// addColorSliderRow / addModeSlider
// 自 MikuMikuAR 迁移：依赖改本库与 utils/core；颜色助手内联（解耦 Babylon Color3）。

import { createIconBox } from "./icons.ts";
import type { ControlOptions } from "./ui-types.ts";
import { initControl } from "./ui-rows.ts";
import { clampPct, clamp01 } from "../utils/core/clamp.ts";
import { DragSliderController } from "./ui-slider-controller.ts";
// DOM 契约单源：role/class 由 dom-contract 提供，禁止手写字符串
import { ROLE, SLIDER_BAR_CLASS, ARIA_ATTR } from "./dom-contract.ts";

// ---- 颜色助手（替代 MikuMikuAR color-helpers 的 Color3 耦合） ----
/** 三通道 [0,1] 三元组即其本身（原 col3FromTriple 仅做 Color3 包装）。 */
function col3FromTriple(c: [number, number, number]): [number, number, number] {
    return c;
}
/** 将 [0,1] 三元组转为 rgb() 字符串。 */
function rgbString(c: [number, number, number]): string {
    const r = Math.round(c[0] * 255);
    const g = Math.round(c[1] * 255);
    const b = Math.round(c[2] * 255);
    return `rgb(${r}, ${g}, ${b})`;
}

// ===================================================================
// addColorSliderRow
// ===================================================================

interface CsrRefs {
  val: HTMLSpanElement;
  fill: HTMLDivElement;
  thumb: HTMLDivElement;
  bar: HTMLDivElement;
}

export function addColorSliderRow(
    container: HTMLElement,
    label: string,
    color: [number, number, number],
    onChange: (v: [number, number, number]) => void,
    opts?: ControlOptions<[number, number, number]>,
    testId?: string
): void {
    // 与 addSliderRow 对齐：非有限通道值回落到 0，避免 .toFixed()/width 渲染 "NaN"；
    // 同时把越界通道钳到 [0,1]，防止外部状态异常时渲染出 150% 宽或 aria-valuenow=2
    const safeColor: [number, number, number] = [
        Number.isFinite(color[0]) ? clamp01(color[0]) : 0,
        Number.isFinite(color[1]) ? clamp01(color[1]) : 0,
        Number.isFinite(color[2]) ? clamp01(color[2]) : 0,
    ];

    const { block, swatch } = csrBuildShell(label, safeColor, testId);
    const channelColors = ['var(--clr-ch-r)', 'var(--clr-ch-g)', 'var(--clr-ch-b)'];
    const current: [number, number, number] = [safeColor[0], safeColor[1], safeColor[2]];
    const controllers: DragSliderController[] = [];
    const refs: CsrRefs[] = [];

    for (let ci = 0; ci < 3; ci++) {
        refs[ci] = csrBuildChannelRow(
            block, ci, safeColor[ci], channelColors[ci],
            current, controllers, label, onChange, swatch
        );
    }
    container.appendChild(block);

    // === 自更新支持 ===
    if (opts) {
        csrBindAutoUpdate(block, opts, safeColor, current, refs, controllers, swatch);
    }
}

function csrBuildShell(
    label: string,
    safeColor: [number, number, number],
    testId?: string
): { block: HTMLDivElement; swatch: HTMLSpanElement; title: HTMLSpanElement } {
    const block = document.createElement('div');
    block.className = 'clr-block';
    if (testId) block.setAttribute('data-testid', testId);
    const header = document.createElement('div');
    header.className = 'clr-header';
    const title = document.createElement('span');
    title.className = 'clr-title';
    title.textContent = label;
    title.id = `color-${Math.random().toString(36).slice(2, 11)}`;
    header.appendChild(title);
    const swatch = document.createElement('span');
    swatch.className = 'clr-swatch';
    swatch.style.background = rgbString(col3FromTriple(safeColor));
    header.appendChild(swatch);
    block.appendChild(header);
    return { block, swatch, title };
}

function csrBuildChannelRow(
    block: HTMLDivElement,
    ci: number,
    initValue: number,
    channelColor: string,
    current: [number, number, number],
    controllers: DragSliderController[],
    label: string,
    onChange: (v: [number, number, number]) => void,
    swatch: HTMLSpanElement
): CsrRefs {
    const sub = document.createElement('div');
    sub.className = 'clr-row';
    const ch = document.createElement('span');
    ch.className = 'clr-channel';
    ch.style.color = channelColor;
    ch.textContent = ['R', 'G', 'B'][ci];
    // titleId 用 block 内随机 id 会更好，这里用 label + ci 即可（labelledby 指向 ch 自己）
    ch.id = `clr-ch-${label}-${ci}-${Math.random().toString(36).slice(2, 7)}`;
    sub.appendChild(ch);

    const val = document.createElement('span');
    val.className = 'clr-value';
    val.textContent = initValue.toFixed(2);

    const bar = document.createElement('div');
    bar.className = SLIDER_BAR_CLASS;
    bar.tabIndex = 0;
    bar.setAttribute('role', ROLE.slider);
    bar.setAttribute(ARIA_ATTR.label, `${label} ${['Red', 'Green', 'Blue'][ci]} channel`);
    bar.setAttribute(ARIA_ATTR.valuemin, '0');
    bar.setAttribute(ARIA_ATTR.valuemax, '1');
    bar.setAttribute(ARIA_ATTR.valuenow, String(initValue));
    bar.setAttribute(ARIA_ATTR.labelledby, ch.id);

    const fill = document.createElement('div');
    fill.className = 'cs-fill';
    fill.style.background = channelColor;
    fill.style.width = initValue * 100 + '%';

    const thumb = document.createElement('div');
    thumb.className = 'cs-thumb';
    thumb.style.left = initValue * 100 + '%';

    bar.appendChild(fill);
    bar.appendChild(thumb);

    const updateDisplay = (v: number): void => {
        current[ci] = v;
        val.textContent = v.toFixed(2);
        fill.style.width = v * 100 + '%';
        thumb.style.left = v * 100 + '%';
        bar.setAttribute(ARIA_ATTR.valuenow, String(v));
        swatch.style.background = rgbString(col3FromTriple(current));
        onChange([current[0], current[1], current[2]]);
    };

    const controller = new DragSliderController({
        value: initValue,
        min: 0,
        max: 1,
        step: 0.01,
        onChange: (v) => updateDisplay(v),
    });
    controller.bind(bar);
    controllers[ci] = controller;

    sub.appendChild(bar);
    sub.appendChild(val);
    block.appendChild(sub);
    return { val, fill, thumb, bar };
}

function csrBindAutoUpdate(
    block: HTMLDivElement,
    opts: ControlOptions<[number, number, number]>,
    safeColor: [number, number, number],
    current: [number, number, number],
    refs: CsrRefs[],
    controllers: DragSliderController[],
    swatch: HTMLSpanElement
): void {
    initControl(block, opts, [safeColor[0], safeColor[1], safeColor[2]], (v, cached) => {
        if (!Array.isArray(v) || v.length < 3) return false;
        let changed = false;
        for (let i = 0; i < 3; i++) {
            const safe = Number.isFinite(v[i]) ? clamp01(v[i]) : 0;
            if (safe !== cached[i]) {
                changed = true;
                current[i] = safe;
                refs[i].val.textContent = safe.toFixed(2);
                refs[i].fill.style.width = safe * 100 + '%';
                refs[i].thumb.style.left = safe * 100 + '%';
                refs[i].bar.setAttribute(ARIA_ATTR.valuenow, String(safe));
                controllers[i].setValue(safe);
            }
        }
        if (changed) swatch.style.background = rgbString(col3FromTriple(current));
        return changed;
    });
}

// ===================================================================
// addVector3SliderRow — 三维向量滑块（X/Y/Z 三通道）
// ===================================================================

interface VsrRefs {
  val: HTMLSpanElement;
  fill: HTMLDivElement;
  thumb: HTMLDivElement;
  bar: HTMLDivElement;
}

export function addVector3SliderRow(
    container: HTMLElement,
    label: string,
    value: [number, number, number],
    min: number,
    max: number,
    step: number,
    onChange: (v: [number, number, number]) => void,
    axisLabels?: [string, string, string],
    icon?: string,
    onDragEndCb?: (v: [number, number, number]) => void,
    opts?: ControlOptions<[number, number, number]>,
    testId?: string
): void {
    const axes: [string, string, string] = axisLabels ?? ['X', 'Y', 'Z'];
    const range = max - min;
    const hasRange = Number.isFinite(range) && range > 0;
    // 与 addSliderRow 对齐：非有限轴值回落到 min，避免 .toFixed()/width 渲染 "NaN"；
    // 越界轴值钳到 [min,max]，保持显示、ARIA 与控制器状态一致
    const safeValue: [number, number, number] = [
        Number.isFinite(value[0]) ? Math.min(max, Math.max(min, value[0])) : min,
        Number.isFinite(value[1]) ? Math.min(max, Math.max(min, value[1])) : min,
        Number.isFinite(value[2]) ? Math.min(max, Math.max(min, value[2])) : min,
    ];

    const block = vsrBuildBlock(label, icon, testId);
    const current: [number, number, number] = [safeValue[0], safeValue[1], safeValue[2]];
    const axisColors = ['var(--accent)', 'var(--status-success)', 'var(--warning, #e6b800)'];
    const controllers: DragSliderController[] = [];
    const refs: VsrRefs[] = [];

    for (let ai = 0; ai < 3; ai++) {
        refs[ai] = vsrBuildAxisRow(
            block, ai, axes, safeValue[ai], axisColors[ai], min, max, step, hasRange, range,
            current, controllers, label, onChange, onDragEndCb
        );
    }

    container.appendChild(block);

    // === 自更新支持 ===
    if (opts) {
        vsrBindAutoUpdate(block, opts, safeValue, current, refs, controllers, min, max, step, hasRange, range);
    }
}

function vsrBuildBlock(label: string, icon?: string, testId?: string): HTMLDivElement {
    const block = document.createElement('div');
    block.className = 'vec3-block';
    if (testId) block.setAttribute('data-testid', testId);

    const header = document.createElement('div');
    header.className = 'vec3-header';
    createIconBox(icon, label, header);
    const title = document.createElement('span');
    title.className = 'vec3-title';
    title.textContent = label;
    title.id = `vec3-${Math.random().toString(36).slice(2, 11)}`;
    header.appendChild(title);
    block.appendChild(header);
    return block;
}

function vsrBuildAxisRow(
    block: HTMLDivElement,
    ai: number,
    axes: [string, string, string],
    initValue: number,
    axisColor: string,
    min: number,
    max: number,
    step: number,
    hasRange: boolean,
    range: number,
    current: [number, number, number],
    controllers: DragSliderController[],
    label: string,
    onChange: (v: [number, number, number]) => void,
    onDragEndCb?: (v: [number, number, number]) => void
): VsrRefs {
    const sub = document.createElement('div');
    sub.className = 'vec3-row';
    const ch = document.createElement('span');
    ch.className = 'vec3-axis';
    ch.style.color = axisColor;
    ch.textContent = axes[ai];
    ch.id = `vec3-${label}-ax${ai}-${Math.random().toString(36).slice(2, 7)}`;
    sub.appendChild(ch);

    const val = document.createElement('span');
    val.className = 'vec3-value';
    val.textContent = step < 1 ? initValue.toFixed(2) : String(Math.round(initValue));

    const bar = document.createElement('div');
    bar.className = SLIDER_BAR_CLASS;
    bar.tabIndex = 0;
    bar.setAttribute('role', ROLE.slider);
    bar.setAttribute(ARIA_ATTR.label, `${label} ${axes[ai]}`);
    bar.setAttribute(ARIA_ATTR.valuemin, String(min));
    bar.setAttribute(ARIA_ATTR.valuemax, String(max));
    bar.setAttribute(ARIA_ATTR.valuenow, String(initValue));
    bar.setAttribute(ARIA_ATTR.labelledby, ch.id);

    const pct = hasRange ? ((initValue - min) / range) * 100 : 0;

    const fill = document.createElement('div');
    fill.className = 'cs-fill';
    fill.style.background = axisColor;
    fill.style.width = clampPct(pct) + '%';

    const thumb = document.createElement('div');
    thumb.className = 'cs-thumb';
    thumb.style.left = clampPct(pct) + '%';

    bar.appendChild(fill);
    bar.appendChild(thumb);

    const updateDisplay = (v: number): void => {
        const safe = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
        current[ai] = safe;
        val.textContent = step < 1 ? safe.toFixed(2) : String(Math.round(safe));
        const newPct = hasRange ? ((safe - min) / range) * 100 : 0;
        const clamped = clampPct(newPct);
        fill.style.width = clamped + '%';
        thumb.style.left = clamped + '%';
        bar.setAttribute(ARIA_ATTR.valuenow, String(safe));
        onChange([current[0], current[1], current[2]]);
    };

    const controller = new DragSliderController({
        value: initValue,
        min,
        max,
        step,
        onChange: (v) => updateDisplay(v),
        onDragEnd: (_v) => onDragEndCb?.([current[0], current[1], current[2]]),
    });
    controller.bind(bar);
    controllers[ai] = controller;

    sub.appendChild(bar);
    sub.appendChild(val);
    block.appendChild(sub);
    return { val, fill, thumb, bar };
}

function vsrBindAutoUpdate(
    block: HTMLDivElement,
    opts: ControlOptions<[number, number, number]>,
    safeValue: [number, number, number],
    current: [number, number, number],
    refs: VsrRefs[],
    controllers: DragSliderController[],
    min: number,
    max: number,
    step: number,
    hasRange: boolean,
    range: number
): void {
    initControl(block, opts, [safeValue[0], safeValue[1], safeValue[2]], (v, cached) => {
        if (!Array.isArray(v) || v.length < 3) return false;
        let changed = false;
        for (let i = 0; i < 3; i++) {
            const safe = Number.isFinite(v[i]) ? Math.min(max, Math.max(min, v[i])) : min;
            if (safe !== cached[i]) {
                changed = true;
                current[i] = safe;
                refs[i].val.textContent = step < 1 ? safe.toFixed(2) : String(Math.round(safe));
                const newPct = hasRange ? ((safe - min) / range) * 100 : 0;
                const clamped = clampPct(newPct);
                refs[i].fill.style.width = clamped + '%';
                refs[i].thumb.style.left = clamped + '%';
                refs[i].bar.setAttribute(ARIA_ATTR.valuenow, String(safe));
                controllers[i].setValue(safe);
            }
        }
        return changed;
    });
}

// ===================================================================
// addModeSlider
// ===================================================================

export function addModeSlider<T extends string | number>(
    container: HTMLElement,
    label: string,
    options: Array<{ value: T; label: string }>,
    currentValue: T,
    onChange: (v: T) => void,
    icon?: string,
    onDragEndCb?: (v: T) => void,
    opts?: ControlOptions<T>,
    testId?: string
): void {
    const total = options.length;
    if (total === 0) {
        return;
    }

    let currentIndex = options.findIndex((o) => o.value === currentValue);
    if (currentIndex < 0) {
        currentIndex = 0;
    }

    const row = document.createElement('div');
    row.className = 'cs-row';
    if (testId) {
        row.setAttribute('data-testid', testId);
    }

    const top = document.createElement('div');
    top.className = 'cs-top';
    top.tabIndex = 0;
    // ARIA 合规：modeSlider 是循环步进控件（键盘方向键 cycleIdx），
    // 语义为 slider——原 role=listbox + aria-valuemin/max/now 违反 ARIA 规范
    // （valuenow 等仅允许 slider/scrollbar/spinbutton/progressbar/meter）。
    top.setAttribute('role', ROLE.slider);
    top.setAttribute(ARIA_ATTR.label, label);
    top.setAttribute(ARIA_ATTR.valuenow, String(currentIndex));
    top.setAttribute(ARIA_ATTR.valuemin, '0');
    top.setAttribute(ARIA_ATTR.valuemax, String(total - 1));

    createIconBox(icon, label, top);

    const lbl = document.createElement('span');
    lbl.className = 'cs-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = 'cs-value';
    val.textContent = options[currentIndex].label;

    top.appendChild(lbl);
    top.appendChild(val);

    const bar = document.createElement('div');
    bar.className = SLIDER_BAR_CLASS;

    const fill = document.createElement('div');
    fill.className = 'cs-fill';
    const pct = total > 1 ? (currentIndex / (total - 1)) * 100 : 100;
    fill.style.width = clampPct(pct) + '%';

    const thumb = document.createElement('div');
    thumb.className = 'cs-thumb';
    thumb.style.left = clampPct(pct) + '%';

    bar.appendChild(fill);
    bar.appendChild(thumb);

    function updateDisplay(idx: number): void {
        currentIndex = idx;
        val.textContent = options[idx].label;
        const newPct = total > 1 ? (idx / (total - 1)) * 100 : 100;
        const clamped = clampPct(newPct);
        fill.style.width = clamped + '%';
        thumb.style.left = clamped + '%';
        top.setAttribute(ARIA_ATTR.valuenow, String(idx));
    }

    function cycleIdx(dir: -1 | 1): void {
        const next = Math.max(0, Math.min(total - 1, currentIndex + dir));
        if (next !== currentIndex) {
            updateDisplay(next);
            onChange(options[next].value);
            onDragEndCb?.(options[next].value);
        }
    }

    // 键盘方向键切换
    top.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            cycleIdx(-1);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            cycleIdx(1);
        }
    });

    // 点击 cs-top：左半前一项、右半后一项
    top.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = top.getBoundingClientRect();
        const x = clamp01((e.clientX - rect.left) / (rect.width || 1));
        cycleIdx(x < 0.5 ? -1 : 1);
    });

    row.appendChild(top);
    row.appendChild(bar);
    container.appendChild(row);

    // === 自更新支持 ===
    initControl(row, opts, currentValue, (v, cached) => {
        if (v === cached) {
            return false;
        }
        const idx = options.findIndex((o) => o.value === v);
        // 外部值不在选项内时显示回落到第一个选项；仍返回 true 让缓存跟踪原始值，
        // 以便后续从非法值恢复合法值时能触发更新
        updateDisplay(idx >= 0 ? idx : 0);
        return true;
    });
}
