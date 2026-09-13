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
//
// 2026-09-14 架构复核（生命周期样板不抽工厂，勿再提）：
//   blink/breath/gaze/autodance/lipsync 的 disposed 标志 + apply 早退 + dispose 置位
//   是同构的「约 3 行样板」（5 文件共 ~15 行），但：
//   ① 早退形态不一（blink/autodance/lipsync 揉进复合守卫还夹 callback/paused 检查，
//      breath/gaze 独立一行，blink 另在 scheduleNext 内多一处早退）；
//   ② apply 签名 4 种形态（(dt,cb)/(dt,map)/(dt,map,camPos)/(dt,amplitudes,cb)）+ 状态全异构
//      （warmup 快照 / internalTime / multiStates / scratch 预分配）——完整工厂必退化为 any；
//   ③ beat-detector 完全无此模式（纯数值检测），证明它不是感知层万能模板。
//   结论：3 行样板抽抽象 = 阅读路径从「一眼看到行内模式」变「跳 helper 再跳回」，负收益，
//   维持现状。未来**新增** controller 若仍遵循 disposed 模式，建议顺手带上
//   `makeDisposedGuard()`（core.ts 可加），不强迁现存 5 个。
export interface PerceptionPauseRef {
  /** true=动画激活，感知 controller 静默 */
  paused: boolean;
}
export function createPerceptionPauseRef(): PerceptionPauseRef {
  return { paused: false };
}
