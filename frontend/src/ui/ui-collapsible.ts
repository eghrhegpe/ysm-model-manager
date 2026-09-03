// [doc:architecture] ui-collapsible — 折叠面板 + preset-chip + 区块标题
// addCollapsible / addPresetChip / addSectionTitle
// 自 MikuMikuAR 迁移：图标工厂改 createIcon；自更新注册改 control-registry。

import { createIcon } from "./icons.ts";
import { registerControl } from "./control-registry.ts";
import { createHeaderToggle } from "./ui-header-toggle.ts";
// DOM 契约单源：role/class 由 dom-contract 提供，禁止手写字符串
import { ROLE, COLLAPSIBLE } from "./dom-contract.ts";

// ===================================================================
// addCollapsible
// ===================================================================

/**
 * 通用折叠面板组件
 * @param container 父容器
 * @param config.title 标题
 * @param config.icon Iconify 图标名（可选）
 * @param config.defaultOpen 默认是否展开（默认 false）
 * @param config.openWhen 当此条件为 true 时自动展开面板（覆盖 defaultOpen），适用于"开关触发后自动展开子设置"场景
 * @param config.renderContent 内容渲染回调
 */
export function addCollapsible(
    container: HTMLElement,
    config: {
        title: string;
        icon?: string;
        variant?: 'default' | 'mat';
        defaultOpen?: boolean;
        /** 当此条件为 true 时自动展开面板（覆盖 defaultOpen），适用于"开关触发后自动展开子设置"场景 */
        openWhen?: boolean;
        testId?: string;
        headerToggle?: {
            value: boolean;
            onChange: (v: boolean) => void;
            /** 声明取值方式，updateControls() 时自动同步 toggle 状态 */
            bind?: () => boolean;
        };
        renderContent: (container: HTMLElement) => void;
    }
): void {
    const variant = config.variant ?? 'default';
    const wrapper = document.createElement('div');
    wrapper.className = COLLAPSIBLE.wrapperClass;
    if (config.testId) {
        wrapper.setAttribute('data-testid', config.testId);
    }

    // Header
    const header = document.createElement('div');
    header.className = COLLAPSIBLE.headerClass + (variant === 'mat' ? ' collapsible-mat' : '');
    header.tabIndex = 0;
    header.role = ROLE.button;

    if (config.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'collapsible-icon';
        const iconEl = createIcon(config.icon);
        if (iconEl) {
            iconSpan.appendChild(iconEl);
        }
        header.appendChild(iconSpan);
    }

    const label = document.createElement('span');
    label.className = 'collapsible-label';
    label.textContent = config.title;
    header.appendChild(label);

    // Header toggle (between label and arrow)
    if (config.headerToggle) {
        const toggle = createHeaderToggle({
            value: config.headerToggle.value,
            onChange: (v) => config.headerToggle!.onChange(v),
            ...(config.headerToggle.bind != null ? { bind: config.headerToggle.bind } : {}),
        });
        header.appendChild(toggle);
    }

    const arrow = document.createElement('span');
    arrow.className = 'collapsible-arrow' + (variant === 'mat' ? ' arrow' : '');
    arrow.textContent = '▾';
    header.appendChild(arrow);

    // Panel
    const panel = document.createElement('div');
    panel.className =
        COLLAPSIBLE.panelClass + (variant === 'mat' ? ' mat-slider-panel mat-cat-slider' : '');
    const inner = document.createElement('div');
    inner.className = 'collapsible-inner';
    config.renderContent(inner);
    panel.appendChild(inner);

    // State
    let isOpen = config.openWhen ?? config.defaultOpen ?? false;

    function applyState(open: boolean) {
        panel.classList.toggle(COLLAPSIBLE.openClass, open);
        header.classList.toggle(COLLAPSIBLE.openClass, open);
        arrow.style.transform = open ? 'rotate(180deg)' : 'rotate(0deg)';
        panel.style.maxHeight = open ? panel.scrollHeight + 'px' : '0';
        panel.inert = !open; // 收起时从 Tab 顺序中移除，防止 AI 和键盘用户聚焦到不可见元素
    }

    header.addEventListener('click', () => {
        isOpen = !isOpen;
        applyState(isOpen);
    });
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            header.click();
        }
    });

    wrapper.appendChild(header);
    wrapper.appendChild(panel);
    container.appendChild(wrapper);

    // Init
    if (isOpen) {
        requestAnimationFrame(() => applyState(true));
    } else {
        applyState(false); // 统一走 applyState，确保 panel.inert 等状态同步（P1-1 修复）
    }
}

// ===================================================================
// addSectionTitle
// ===================================================================

/**
 * 区块标题（section-title），用于 cardContainer 内的视觉分组。
 * 11px 白色文字，底部 border，和设计规范一致。
 */
export function addSectionTitle(container: HTMLElement, text: string, testId?: string): void {
    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = text;
    if (testId) {
        title.setAttribute('data-testid', testId);
    }
    container.appendChild(title);
}

// ===================================================================
// addPresetChip
// ===================================================================

/**
 * 创建一个 preset-chip 按钮并追加到 container（通常是 .preset-group div）。
 * 极简工具：只管单个 chip 的创建+追加，group 容器和数据源由调用方管理。
 *
 * @param container 父容器（一般是 div.preset-group）
 * @param label     按钮文本
 * @param active    是否激活（追加 'active' class）
 * @param onClick   点击回调
 * @param opts      自更新选项（onUpdate 自定义更新逻辑）
 * @returns 创建的 button 元素（调用方可继续加内联 style 等）
 */
export function addPresetChip(
    container: HTMLElement,
    label: string,
    active: boolean,
    onClick: () => void,
    opts?: {
        onUpdate?: (btn: HTMLButtonElement) => void;
        wrap?: boolean;
        /** Iconify 图标名，前置到文本前（无则忽略） */
        icon?: string;
        /** 'danger' = 红底动作按钮；'badge' = 只读标签（不可点击）；默认 'default' */
        variant?: 'default' | 'danger' | 'badge';
        /** tooltip 文本 */
        title?: string;
        /** 上外边距（px） */
        marginTop?: number;
        /** 左外边距（px 或 'auto'） */
        marginLeft?: number | 'auto';
        /** 点击时阻止冒泡到父行（行内嵌按钮防误触） */
        stopPropagation?: boolean;
    }
): HTMLButtonElement {
    const btn = document.createElement('button');
    const variant = opts?.variant ?? 'default';
    const classes = ['preset-chip'];
    if (active) {
        classes.push('active');
    }
    if (variant === 'danger') {
        classes.push('danger');
    }
    if (variant === 'badge') {
        classes.push('badge');
    }
    if (opts?.wrap) {
        classes.push('wrap-2');
    }
    btn.className = classes.join(' ');

    if (opts?.icon) {
        const iconEl = createIcon(opts.icon);
        if (iconEl) {
            btn.appendChild(iconEl);
        }
    }
    btn.appendChild(document.createTextNode(label));

    if (opts?.title) {
        btn.title = opts.title;
    }
    if (opts?.marginTop != null) {
        btn.style.marginTop = `${opts.marginTop}px`;
    }
    if (opts?.marginLeft != null) {
        btn.style.marginLeft = opts.marginLeft === 'auto' ? 'auto' : `${opts.marginLeft}px`;
    }

    if (variant !== 'badge') {
        btn.addEventListener('click', (e) => {
            if (opts?.stopPropagation) {
                e.stopPropagation();
            }
            onClick();
        });
    }

    container.appendChild(btn);

    // === 自更新支持 ===
    if (opts?.onUpdate) {
        const update = () => opts.onUpdate!(btn);
        // 用 label 做 id 后缀保证唯一性（预设 chip 的 label 通常不重复）
        registerControl(`preset-chip-update:${label}`, update);
        update();
    }

    return btn;
}
