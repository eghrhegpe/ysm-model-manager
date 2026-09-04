// [doc:architecture] ui-header-toggle — 标题栏小型开关（toggle.header-toggle）
// 从 ui-rows 抽出的零依赖叶子：断开 ui-rows ⇄ ui-slide-row 文件级双向环。
// 统一双触发去重 + bind 自更新 + disabled。
// 自 MikuMikuAR 迁移：自更新注册改为本库的 control-registry（解耦 render-context）。

import { iterateControls, registerControl, unregisterControl } from "./control-registry.ts";

// 多实例唯一 id 前缀 + 序号；update 附带 __el 供断连清扫判定
// （不把 isConnected 守卫加进 update，保住未挂载时直调同步的既有语义）。
const ID_PREFIX = "header-toggle-bind#";
let _bindSeq = 0;
type HeaderToggleUpdater = (() => void) & { __el?: HTMLLabelElement };
const _graceIds = new Set<string>();
const _everConnected = new WeakSet<Element>();

// 挂载历史：MO 记录同步收割（takeRecords）+ 扫描时 isConnected 补记，
// 覆盖 Shadow DOM 内挂载（MO 观测不到影子树，靠后者兜底）。
let _mo: MutationObserver | null = null;
function _harvestMounts(): void {
  if (!_mo) {
    _mo = new MutationObserver((recs) => {
      for (const rec of recs) {
        for (const n of rec.addedNodes) {
          if (n instanceof Element) {
            _everConnected.add(n);
            // 子树内的 toggle 也一并标记（MO 只报直接 addedNodes）
            for (const child of n.querySelectorAll(".header-toggle")) {
              _everConnected.add(child);
            }
          }
        }
      }
    });
    _mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  // takeRecords() 作为同任务补充：收割回调间隙的记录
  for (const rec of _mo.takeRecords()) {
    for (const n of rec.addedNodes) {
      if (n instanceof Element) {
        _everConnected.add(n);
        for (const child of n.querySelectorAll(".header-toggle")) {
          _everConnected.add(child);
        }
      }
    }
  }
}

// 两击扫描：断连一轮记入宽限集，连续两轮断连才注销，中途恢复连接则移除标记；
// 从未挂载的实例豁免（宽限防误杀），只有曾挂载后断连的才参与清扫。
function _sweepDetached(): void {
  _harvestMounts();
  for (const [id, fn] of iterateControls()) {
    if (!id.startsWith(ID_PREFIX)) {
      continue;
    }
    const el = (fn as HeaderToggleUpdater).__el;
    if (!el) {
      continue;
    }
    if (el.isConnected) {
      _everConnected.add(el);
      _graceIds.delete(id);
      continue;
    }
    if (!_everConnected.has(el)) {
      continue;
    }
    if (_graceIds.has(id)) {
      unregisterControl(id);
      _graceIds.delete(id);
    } else {
      _graceIds.add(id);
    }
  }
}

export interface HeaderToggleConfig {
  value: boolean;
  onChange: (v: boolean) => void;
  /** 自更新：菜单重渲染时调用，返回值变化时同步 input.checked */
  bind?: () => boolean;
  /** 禁用态：input.disabled + toggle-disabled class，不响应 onChange */
  disabled?: boolean;
  /** 禁用态点击回调（如弹出提示） */
  onDisabledClick?: () => void;
  /** 禁用态提示文本（保留字段，由调用方自行消费） */
  disabledHint?: string;
}

/**
 * 创建标题栏小型开关。返回 `<label class="toggle header-toggle">`，
 * 含双触发去重（跳过 target===input 的 synthetic click + preventDefault）。
 * onChange 接收新状态；若需附加 DOM 副作用（如 row.classList.toggle），调用方自行处理。
 */
export function createHeaderToggle(config: HeaderToggleConfig): HTMLLabelElement {
  const toggle = document.createElement("label");
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

  // bind 自更新：菜单重渲染时同步 input.checked
  if (config.bind) {
    let cached = config.value;
    const update: HeaderToggleUpdater = (): void => {
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
      const v = !!config.bind!();
      if (v === cached) {
        return;
      }
      cached = v;
      input.checked = v;
    };
    update.__el = toggle;
    _sweepDetached();
    registerControl(ID_PREFIX + ++_bindSeq, update);
  }

  return toggle;
}
