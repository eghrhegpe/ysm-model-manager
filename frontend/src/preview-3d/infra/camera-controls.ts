// ===== camera-controls.ts — CameraControlBridge 类型（ADR-066 P3 拆出破环 + ADR-193 第一刀瘦身）=====
// 历史包袱清理：buildCameraControls DOM 拼装器已被 settings.ts buildCameraSchema 的
// 声明式三节点（select/slider/button）取代——renderCustom 逃生舱退役，本文件只剩桥类型。
// （原注释：buildCameraControls / CameraControlBridge 原定义在 mount-preview-core.ts，
//   为破 mount-preview-core ↔ preview-menu 循环依赖拆至本文件；环早已不存在。）

/** 相机控制桥：shared/self 双模式统一旋转/速度/重置控件的回调集合（方案 A：消灭 ysm-adapter 双份实现） */
export interface CameraControlBridge {
  /** 当前旋转模式（true=环绕） */
  getOrbit(): boolean;
  /** 设置旋转模式（含 shared 模式的 controls.enableRotate / orbitTarget 同步） */
  setOrbit(v: boolean): void;
  /** 当前相机速度 */
  getSpeed(): number;
  /** 设置相机速度 */
  setSpeed(n: number): void;
  /** 重置视角（shared 模式经 content.resetCamera，build 前调用安全——闭包延迟求值） */
  reset(): void;
}
