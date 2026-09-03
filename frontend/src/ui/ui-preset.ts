// [doc:architecture] ui-preset — 预设面板复合组件（preset-chip 组 + 清除行）
// 收敛 env 面板中 5 处手写 chip 组与 3 处手写清除行的重复拼接逻辑。
// 自 MikuMikuAR 迁移：依赖改本库 ui-collapsible。

import { addPresetChip } from "./ui-collapsible.ts";

// ===================================================================
// PresetChipItem
// ===================================================================

/**
 * 单个预设芯片的描述。
 * - `isActive` 可选：提供则用于「初始高亮 + 自更新同步」（registerControl）；
 *   不提供则 active=false 且不做状态同步（如一次性应用的预设）。
 */
export interface PresetChipItem {
    label: string;
    onClick: () => void;
    isActive?: () => boolean;
    wrap?: boolean;
}

// ===================================================================
// buildPresetChipGroup
// ===================================================================

/**
 * 渲染一组 preset-chip（统一 .preset-group 容器 + addPresetChip 布局）。
 * 替代 env 面板中 5 处手工 `for-of` + `addPresetChip` + `onUpdate` 重复块。
 *
 * @param container 父容器
 * @param items     芯片项（label / onClick / 可选 isActive / 可选 wrap）
 * @param opts      paddingBottom 与额外 className（如 sky 时段组需要 6px 底距）
 */
export function buildPresetChipGroup(
    container: HTMLElement,
    items: PresetChipItem[],
    opts?: { paddingBottom?: number; className?: string }
): void {
    const group = document.createElement('div');
    group.className = 'preset-group' + (opts?.className ? ' ' + opts.className : '');
    if (opts?.paddingBottom != null) {
        group.style.paddingBottom = `${opts.paddingBottom}px`;
    }
    for (const item of items) {
        const active = item.isActive ? item.isActive() : false;
        addPresetChip(group, item.label, active, item.onClick, {
            ...(item.wrap != null ? { wrap: item.wrap } : {}),
            ...(item.isActive
                ? {
                      onUpdate: (btn: HTMLButtonElement) =>
                          btn.classList.toggle('active', item.isActive!()),
                  }
                : {}),
        });
    }
    container.appendChild(group);
}

// ===================================================================
// addClearRow
// ===================================================================

/**
 * 渲染一行右对齐的「清除」按钮（统一 cs-btn cs-btn-sm 样式）。
 * 替代 env 面板中 3 处手写清除行重复块。仅在 hasValue 为真时渲染。
 *
 * @param container 父容器
 * @param hasValue  是否显示清除行（对应纹理/贴图是否已设置）
 * @param onClear   清除回调
 * @param label     按钮文案（默认 'Clear'）
 */
export function addClearRow(
    container: HTMLElement,
    hasValue: boolean,
    onClear: () => void,
    label: string = 'Clear',
    testId?: string
): void {
    if (!hasValue) {
        return;
    }
    const clearRow = document.createElement('div');
    clearRow.style.cssText = 'display:flex;justify-content:flex-end;padding:0 14px 4px;';
    if (testId) {
        clearRow.setAttribute('data-testid', testId);
    }
    const clearBtn = document.createElement('button');
    clearBtn.className = 'cs-btn cs-btn-sm';
    clearBtn.textContent = label;
    clearBtn.onclick = onClear;
    clearRow.appendChild(clearBtn);
    container.appendChild(clearRow);
}
