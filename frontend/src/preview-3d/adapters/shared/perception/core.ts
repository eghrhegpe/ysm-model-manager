// ===== 感知层暂停引用（实例级，取代全局单例 #9）=====
// 收敛此前各消费方手写的「动画激活时暂停感知」守卫（mmd/vrm/ysm adapter 的
// update() 里 `!action || action.paused` / isAnimActive 分散判定，见 sharp-review #9）。
// 设计（P1 根因修复）：属主 adapter 每 build 创建一份 PerceptionPauseRef，注入其下所有
// 感知 controller；controller apply 自查 ref.paused —— 多模型同框时各实例互不影响，
// 彻底消除「模块级单例跨模型冻结同框感知」的缺陷。pauseRef 为必选参数（编译期强制）。
// 用法：属主 update() 每帧写 `ref.paused = 动画是否激活`，感知优先级决策收归感知系统自身。
//
// 受控清单（apply 内自查 ref.paused，暂停即静默）：
//   breath / blink / lipSync / autoDance（mmd-build-result.ts、vrm-adapter.ts、ysm-adapter.ts）
// 例外（不随暂停，设计意图）：
//   gaze——注视属「摄像机追踪」而非动画优先级，动画播放中仍应跟随相机
//   （见 mmd-build-result.ts update 内注释；VRM 走原生 lookAt 同理不受暂停管辖）。
// ⚠️ 此 ref 仅限主线程访问。若未来感知层扩展出 Worker 驱动路径，需重新设计同步机制。
export interface PerceptionPauseRef {
  /** true=动画激活，感知 controller 静默 */
  paused: boolean;
}
export function createPerceptionPauseRef(): PerceptionPauseRef {
  return { paused: false };
}
