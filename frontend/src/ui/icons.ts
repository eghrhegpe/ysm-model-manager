// 🥉 ui-helpers 组件库 — 图标工厂（替代 MikuMikuAR 的 iconify 图标系统）。
//
// MikuMikuAR 用 createIconifyIcon 渲染 SVG 图标，依赖其 iconify 运行时，本库不引入。
// 这里提供轻量替代：
//  - 含 ':' 的 iconify 风格名（如 'lucide:settings-2'）→ 返回 null，由调用方走文本兜底；
//  - 普通字形（如 '▶' '✕' '📁'）→ 渲染为 .cs-icon 文本节点。
// 这样组件 DOM 结构与 CSS 类保持不变，且不耦合任何图标运行时。

/** 创建一个图标元素（可能返回 null，调用方应走兜底层）。 */
export function createIcon(icon: string): HTMLElement | null {
    if (!icon) {
        return null;
    }
    if (icon.includes(':')) {
        // iconify 风格名：ysm 无 iconify 运行时，交还 null 触发文本兜底
        return null;
    }
    const span = document.createElement('span');
    span.className = 'cs-icon';
    span.textContent = icon;
    return span;
}

/**
 * 创建 <span.cs-icon> 图标盒并挂到 parent 下（icon 为空则不创建）。
 * 有图标则插入 createIcon 结果；iconify 风格名（createIcon 返回 null）走首字 fallback。
 * 从 ui-rows.createIconBox 上移，ui-advanced-rows / ui-slide-row 共用，消除 jscpd 重复。
 */
export function createIconBox(icon: string | undefined, label: string, parent: HTMLElement): void {
    if (!icon) return;
    const iconBox = document.createElement('span');
    iconBox.className = 'cs-icon';
    const iconEl = createIcon(icon);
    if (iconEl) {
        iconBox.appendChild(iconEl);
    } else {
        const fb = document.createElement('span');
        fb.className = 'cs-icon-fallback';
        fb.textContent = label.charAt(0) || '?';
        iconBox.appendChild(fb);
    }
    parent.appendChild(iconBox);
}
