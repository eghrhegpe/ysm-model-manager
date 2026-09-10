// ===== 3D overlay 链样式注入目标桥（ADR-175 M1）=====
// G6 Shadow DOM 化后，overlay 全部内容迁入 host.shadowRoot——document.head 注入的
// <style> 无法穿透 shadow 边界，链内 9 个 ensure*Styles 注入目标须随宿主迁移。
//
// 机制：模块级 target（null = document.head 兜底）+ 旗标重置注册表。
// mount3D 首建 overlay 时 setOverlayStyleTarget(shadowRoot)，已注入旗标全部复位 →
// 各 ensure 函数下次调用时向新目标重注入；cleanupPreview/_resetSingletons 传 null
// 还原 head 兜底，保证「无 overlay 时直接调 ensure 的单测」路径与迁移前完全一致。
//
// 不放 mount-preview-core.ts：menu/adapters 多个模块都要 import，挂 core 下会形成
// core → 桥 ← mount-preview-core 的环（mount-preview-core 已 import menu/core）。

export type OverlayStyleTarget = HTMLElement | ShadowRoot | null;

let _target: OverlayStyleTarget = null;
const _resets: Array<() => void> = [];

/** 设定注入目标（null = document.head 兜底），并复位所有已注册 ensure 函数的注入旗标 */
export function setOverlayStyleTarget(target: OverlayStyleTarget): void {
  _target = target;
  for (const fn of _resets) fn();
}

/** 当前注入目标：未设定（无 overlay 单例）时回退 document.head——单测直调 ensure 路径不变 */
export function overlayStyleRoot(): HTMLElement | ShadowRoot {
  return _target ?? document.head;
}

/** ensure 函数注册「旗标复位」回调：目标切换时调用（新 shadow root 需重注入） */
export function onOverlayStyleTargetReset(fn: () => void): void {
  _resets.push(fn);
}
