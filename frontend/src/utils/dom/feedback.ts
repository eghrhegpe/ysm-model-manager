// ===== 轻量原地反馈原语（ADR-044 策略 A：基础设施工具函数收敛）=====
// flashBtn：操作成功的原地瞬时反馈——加 flash class，时长后移除。
// 收敛自 views/app-tree/utils.ts（原树组件私有实现，已全局化供各视图复用，
// 避免「想用只能复制」导致的私有实现扩散，R10 同款教训）。
// 与 toast（全局重反馈）/ modal（模态槽位）并列，属轻量层。
// 样式约定：.flash 基础高亮；非 success 色系追加 .flash--warn / .flash--error 修饰符，
// 颜色由消费方组件样式用 --status-* 变量实现（如 app-tree 内 .hdr-btn.flash / .fl.flash）。

/** 默认闪烁时长（ms） */
export const FLASH_DURATION_MS = 400;

/** 闪烁反馈配置 */
export interface FlashOptions {
  /** 闪烁时长 ms；默认 FLASH_DURATION_MS */
  duration?: number;
  /** 反馈色系；默认 success（不加修饰符，兼容既有 .flash 选择器）；warn/error 追加修饰符 */
  tone?: "success" | "warn" | "error";
}

// 元素 → 在途闪烁定时器。WeakMap 弱引用：元素被移除后条目随 GC 回收，无泄漏；
// 同一元素连点先清旧定时器防重入，避免定时器堆积。
const flashTimers = new WeakMap<HTMLElement, number>();

/**
 * 按钮/行闪烁反馈：加 flash class，duration 后移除。
 * null 安全；同一元素重复调用会重置计时（防连点堆积）。
 * @el 目标元素（null 时静默返回）
 * @opts 闪烁配置（时长、色系）
 */
export function flashBtn(el: HTMLElement | null, opts?: FlashOptions): void {
  if (!el) return;
  // no-animations 偏好（ui-prefs 切换，documentElement 挂类，各组件 :host-context 关 CSS 动画）：
  // 闪烁是 classList+setTimeout 的瞬态变色，不在 CSS animation 体系内、现有规则管不到，
  // 此处显式跳过——对光敏/眩晕用户同样构成视觉干扰；操作本身的反馈
  // （toast/状态变化/树刷新）不受影响
  if (document.documentElement.classList.contains("no-animations")) return;
  // 数值守卫范式：NaN/Infinity/非正数一律回退默认时长
  const raw = opts?.duration;
  const duration =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : FLASH_DURATION_MS;
  const tone = opts?.tone ?? "success";
  const toneCls = tone === "warn" || tone === "error" ? `flash--${tone}` : "";

  const prev = flashTimers.get(el);
  if (prev !== undefined) window.clearTimeout(prev);

  // 跨 tone 连点防残留：旧定时器被清后无人移除旧修饰符（如 warn→success），
  // add 前统一清除全部 tone 修饰符；回调也统一移除，保证 classList 收敛
  el.classList.remove("flash--warn");
  el.classList.remove("flash--error");
  el.classList.add("flash");
  if (toneCls) el.classList.add(toneCls);
  flashTimers.set(
    el,
    window.setTimeout(() => {
      el.classList.remove("flash");
      el.classList.remove("flash--warn");
      el.classList.remove("flash--error");
      flashTimers.delete(el);
    }, duration),
  );
}
