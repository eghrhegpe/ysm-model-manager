// ===== 感知层全局暂停标志 =====
// 收敛此前各消费方手写的「动画激活时暂停感知」守卫（mmd/vrm/ysm adapter 的
// update() 里 `!action || action.paused` / isAnimActive 分散判定，见 sharp-review #9）。
// 用法：消费方每帧调用一次 setPerceptionPaused(动画是否激活)，
// 各 controller 的 apply() 内部自查，动画优先级决策收归感知系统自身。
let _globalPause = false;

/** 置全局暂停标志（true=动画激活，感知 controller 全部静默） */
export function setPerceptionPaused(paused: boolean): void {
  _globalPause = paused;
}

/** 感知 controller 内部自查：暂停中则跳过本帧 */
export function isPerceptionPaused(): boolean {
  return _globalPause;
}
