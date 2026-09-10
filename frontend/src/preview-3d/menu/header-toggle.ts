// [doc:architecture] ui-header-toggle — 标题栏小型开关（toggle.header-toggle）
// 零依赖叶子（自 MikuMikuAR 迁移，经 ui-rows 抽出以断开文件级双向环）。
// 统一双触发去重 + disabled + forceToggle。
// 注意：状态回写场景走菜单 refresh 重建语义（重建即最新态），勿复刻已删的 control-registry 注册链。

export interface HeaderToggleConfig {
  value: boolean;
  onChange: (v: boolean) => void;
  /** 禁用态：input.disabled + toggle-disabled class，不响应 onChange */
  disabled?: boolean;
  /** 禁用态点击回调（如弹出提示） */
  onDisabledClick?: () => void;
}

/** createHeaderToggle 返回值：label 开关 + 程序化翻转出口。
 *  forceToggle 供外部触发（如整行点击）复用「用户点击开关」语义：
 *  未禁用 → 翻转 checked + onChange；禁用 → 转交 onDisabledClick（无则 no-op）。
 *  能力自 addToggleRow 下沉（原 handleToggleRowClick 的翻转语义）。 */
export interface HeaderToggleElement extends HTMLLabelElement {
  forceToggle(): void;
}

/**
 * 创建标题栏小型开关。返回 `<label class="toggle header-toggle">`，
 * 含双触发去重（跳过 target===input 的 synthetic click + preventDefault）。
 * onChange 接收新状态；若需附加 DOM 副作用（如 row.classList.toggle），调用方自行处理。
 */
export function createHeaderToggle(config: HeaderToggleConfig): HeaderToggleElement {
  const toggle = document.createElement("label") as HeaderToggleElement;
  toggle.className = "toggle header-toggle";
  if (config.disabled) {
    toggle.classList.add("toggle-disabled");
  }
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = config.value;
  input.disabled = !!config.disabled;
  const slider = document.createElement("span");
  slider.className = "slider";
  toggle.appendChild(input);
  toggle.appendChild(slider);

  if (!config.disabled) {
    // 修复：<label> 包裹 checkbox 时浏览器原生二次派发 click 到 input，导致 handler 双触发。
    // 跳过 synthetic click(target===input) 并 preventDefault 阻止原生切换造成的视觉错位。
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target === input) {
        return;
      }
      e.preventDefault();
      input.checked = !input.checked;
      config.onChange(input.checked);
    });
  } else if (config.onDisabledClick) {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      config.onDisabledClick!();
    });
  }

  // 程序化翻转出口：与用户点击开关本体同语义（disabled → onDisabledClick / no-op）。
  // 直接改 checked + 调 onChange，不派发 click 事件（避免与 label 原生二次派发纠缠）。
  toggle.forceToggle = (): void => {
    if (config.disabled) {
      config.onDisabledClick?.();
      return;
    }
    input.checked = !input.checked;
    config.onChange(input.checked);
  };

  return toggle;
}
