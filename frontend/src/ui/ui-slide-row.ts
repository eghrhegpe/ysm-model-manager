// [doc:architecture] slideRow — 菜单行组件
// 带图标+标签+箭头+可选 sublabel/tag/headerToggle + actionBtn + variant 的通用菜单行
// 自 MikuMikuAR 迁移：图标工厂改为本库 createIcon（解耦 iconify）；契约常量来自 dom-contract。

import { createIcon } from "./icons.ts";
import { createHeaderToggle, type HeaderToggleConfig } from "./ui-header-toggle.ts";
// DOM 契约单源：role/class 由 dom-contract 提供，禁止手写字符串
import { ROLE, COLLAPSIBLE } from "./dom-contract.ts";

export type { HeaderToggleConfig };

export interface TrailingAction {
    /** 图标：含 ':' 视为 iconify 名（如 'lucide:settings-2'）渲染为 SVG；否则作为字面字符（如 '▶'）。 */
    icon: string;
    title?: string;
    danger?: boolean;
    onClick: (e: MouseEvent) => void;
}

/**
 * 统一尾部第二动作按钮工厂——供 slideRow 与 menu.ts createRow 共用，
 * 确保两条渲染路径的第二按钮观感与行为一致（22px .slide-add-btn；iconify 名渲染 SVG，
 * 否则 textContent；点击 stopPropagation 防冒泡触发整行 onClick）。
 */
/**
 * 动作按钮内部构造器——供 createTrailingBtn / createLeadingBtn 共用，
 * 消除两份 ~90% 相同的函数体（仅 class 名不同：右侧 22px 盒装 / 左侧 21px 透明指示）。
 */
function buildActionBtn(act: TrailingAction, cls: string): HTMLElement {
    const btn = document.createElement('span');
    btn.className = cls + (act.danger ? ' slide-act-danger' : '');
    if (act.icon.includes(':')) {
        const iconEl = createIcon(act.icon);
        if (iconEl) {
            btn.appendChild(iconEl);
        } else {
            btn.textContent = act.icon;
        }
    } else {
        btn.textContent = act.icon;
    }
    btn.title = act.title || '';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        act.onClick(e);
    });
    return btn;
}

/**
 * 统一尾部第二动作按钮工厂——供 slideRow 与 menu.ts createRow 共用，
 * 确保两条渲染路径的第二按钮观感与行为一致（22px .slide-add-btn；iconify 名渲染 SVG，
 * 否则 textContent；点击 stopPropagation 防冒泡触发整行 onClick）。
 */
export function createTrailingBtn(act: TrailingAction): HTMLElement {
    return buildActionBtn(act, 'slide-add-btn');
}

/**
 * 统一左侧行为区按钮工厂——镜像 createTrailingBtn，但渲染为 21px 透明可点击
 * `.slide-lead-btn`（复用 .slide-icon 尺寸，非 22px 盒装），保持指示图标（如 radio）
 * 视觉一致；点击 stopPropagation 防冒泡触发整行 onClick。
 */
export function createLeadingBtn(act: TrailingAction): HTMLElement {
    return buildActionBtn(act, 'slide-lead-btn');
}

export interface SlideRowExtra {
    /** label 颜色变体：danger(红), accent(主题色) */
    variant?: 'default' | 'danger' | 'accent';
    /** 统一尾部行为区：传入则在行最右侧渲染为可点击图标，并【不】渲染装饰性 `>`。
     *  用于「+ 加载」「▶ 播放」「✕ 删除」等第二动作；与 hasArrow 互斥，
     *  从构造上杜绝「文件行既渲染 + 又渲染 >」的误渲染。 */
    trailing?: TrailingAction;
    /** 统一左侧行为区：传入则左侧图标（如 radio 指示）被渲染为可点击按钮，
     *  点击 stopPropagation 后触发该动作（如切焦点），与整行 onClick 解耦。
     *  视觉复用 .slide-icon 尺寸（非 22px 盒装），保持指示图标一致性。 */
    leading?: TrailingAction;
    /** 自定义右侧 label（key-value 布局用） */
    rightLabel?: string;
    /** 动态图标工厂函数——替代 icon 字符串参数，每次渲染调用 */
    iconFactory?: () => HTMLElement;
    /** key-value 字段行专用：为 true 时不渲染左侧图标占位，避免 21px 空白。addFieldRow 默认开启 */
    hideIcon?: boolean;
    /** sublabel 内联在 label 后（而非右对齐），适合需要 text-overflow 的场景 */
    inlineSub?: boolean;
    /** label 允许双行显示（用于长文件名等场景） */
    wrapLabel?: boolean;
    /**
     * 稳定测试钩子：建议传声明式节点的稳定 id（非可见文本），e2e 用
     * `getByTestId` 定位，避免依赖文本/位置导致重构即红。仅作测试属性，
     * 生产行为不受影响。
     */
    testId?: string;
}

export function slideRow(
    container: HTMLElement,
    icon: string,
    label: string,
    hasArrow: boolean,
    onClick: () => void,
    sublabel?: string,
    tag?: string,
    focused?: boolean,
    headerToggle?: HeaderToggleConfig,
    extra?: SlideRowExtra
): HTMLElement {
    const row = document.createElement('div');
    if (extra?.testId) row.setAttribute('data-testid', extra.testId);

    if (headerToggle) {
        srBuildCollapsibleVariant(row, icon, label, sublabel, headerToggle, hasArrow);
    } else {
        srBuildSlideItemVariant(row, icon, label, hasArrow, sublabel, tag, focused, extra);
    }
    srBindRowClick(row, onClick);

    container.appendChild(row);
    return row;
}

function srBuildCollapsibleVariant(
    row: HTMLDivElement,
    icon: string,
    label: string,
    sublabel: string | undefined,
    headerToggle: HeaderToggleConfig,
    hasArrow: boolean
): void {
    // 使用 addCollapsible 的 header 样式：图标 + label + toggle + 箭头
    row.className = COLLAPSIBLE.headerClass;
    row.tabIndex = 0;
    row.role = ROLE.button;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'collapsible-icon';
    iconSpan.appendChild(srResolveIcon(icon, label));
    row.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'collapsible-label';
    labelSpan.textContent = label;
    row.appendChild(labelSpan);

    if (sublabel) {
        const sub = document.createElement('span');
        sub.className = 'slide-sublabel';
        sub.textContent = sublabel;
        row.appendChild(sub);
    }

    const toggle = createHeaderToggle({
        value: headerToggle.value,
        onChange: (v) => headerToggle.onChange(v),
        ...(headerToggle.bind != null ? { bind: headerToggle.bind } : {}),
        ...(headerToggle.disabled !== undefined ? { disabled: headerToggle.disabled } : {}),
        ...(headerToggle.onDisabledClick != null ? { onDisabledClick: headerToggle.onDisabledClick } : {}),
    });
    row.appendChild(toggle);

    if (hasArrow) {
        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'collapsible-arrow';
        arrowSpan.textContent = '▾';
        row.appendChild(arrowSpan);
    }
}

function srBuildSlideItemVariant(
    row: HTMLDivElement,
    icon: string,
    label: string,
    hasArrow: boolean,
    sublabel: string | undefined,
    _tag: string | undefined,
    focused: boolean | undefined,
    extra: SlideRowExtra | undefined
): void {
    const variant = extra?.variant ?? 'default';
    row.className = 'slide-item' + (focused ? ' slide-focused' : '');
    row.tabIndex = 0;
    row.role = ROLE.button;

    srAppendLeading(row, icon, label, extra);
    srAppendLabels(row, label, sublabel, variant, extra);
    srAppendTrailing(row, hasArrow, extra);
}

function srAppendLeading(row: HTMLDivElement, icon: string, label: string, extra: SlideRowExtra | undefined): void {
    // === 统一左侧行为区：leading 优先于纯展示 .slide-icon（互斥）===
    // leading 存在时，左侧图标被渲染为可点击按钮（保持 radio 指示视觉），
    // 点击 stopPropagation 后触发该动作（如切焦点），与整行 onClick 解耦。
    if (extra?.leading) {
        row.appendChild(createLeadingBtn(extra.leading));
    } else if (!extra?.hideIcon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'slide-icon';
        if (extra?.iconFactory) {
            const el = extra.iconFactory();
            if (el) iconSpan.appendChild(el);
        } else {
            iconSpan.appendChild(srResolveIcon(icon, label));
        }
        row.appendChild(iconSpan);
    }
}

function srAppendLabels(
    row: HTMLDivElement,
    label: string,
    sublabel: string | undefined,
    variant: 'default' | 'danger' | 'accent',
    extra: SlideRowExtra | undefined
): void {
    // 右侧 label（key-value 布局）：field-label + field-value 双段
    if (extra?.rightLabel !== undefined) {
        const leftSpan = document.createElement('span');
        leftSpan.className = 'slide-label field-label';
        leftSpan.textContent = label;
        row.appendChild(leftSpan);
        const rightSpan = document.createElement('span');
        rightSpan.className = 'field-value';
        rightSpan.textContent = extra.rightLabel;
        row.appendChild(rightSpan);
        // 原代码 sublabel 在 rightLabel 分支外、两种情况下都 append；重构时提前
        // return 会丢 sublabel——恢复为分支内也 append（行为保持）。
        if (sublabel) {
            const sub = document.createElement('span');
            sub.className = 'slide-sublabel' + (extra?.inlineSub ? ' slide-sublabel-inline' : '');
            sub.textContent = sublabel;
            row.appendChild(sub);
        }
        return;
    }
    // 普通 label：variant（danger/accent）+ wrap-2
    let labelCls = 'slide-label';
    if (variant === 'danger') labelCls += ' danger-text';
    else if (variant === 'accent') labelCls += ' accent-text';
    if (extra?.wrapLabel) labelCls += ' wrap-2';
    const labelSpan = document.createElement('span');
    labelSpan.className = labelCls;
    labelSpan.textContent = label;
    row.appendChild(labelSpan);
    if (sublabel) {
        const sub = document.createElement('span');
        sub.className = 'slide-sublabel' + (extra?.inlineSub ? ' slide-sublabel-inline' : '');
        sub.textContent = sublabel;
        row.appendChild(sub);
    }
}

function srAppendTrailing(row: HTMLDivElement, hasArrow: boolean, extra: SlideRowExtra | undefined): void {
    // === 统一尾部行为区：trailing 优先于装饰性 `>`（互斥，避免误渲染 `>`）===
    if (extra?.trailing) {
        row.appendChild(createTrailingBtn(extra.trailing));
    } else if (hasArrow) {
        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'slide-arrow';
        arrowSpan.textContent = '>';
        row.appendChild(arrowSpan);
    }
}

function srResolveIcon(icon: string, label: string): Node {
    const iconEl = createIcon(icon);
    if (iconEl) return iconEl;
    const fb = document.createElement('span');
    fb.className = 'cs-icon-fallback';
    fb.textContent = label.charAt(0) || '?';
    return fb;
}

function srBindRowClick(row: HTMLDivElement, onClick: () => void): void {
    row.addEventListener('click', () => {
        if (window.getSelection()?.toString()) return;
        onClick();
    });
}
