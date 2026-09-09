// ===== 全局错误监听（DOM 原语层）：window error / unhandledrejection → 日记 =====
// 此层才允许碰 window；事件转发经 core/error-diary 的 pushToDiary 入口收口进同一套净化/去重策略，
// 故 core 保持引擎无关、不挂 window 监听。装配层（app-modules 启动期）调用一次即可，应用级常驻单例。

import { pushToDiary } from "@/core/error-diary.ts";

/** 已安装的全局监听 disposer（幂等守卫：重复安装返回 no-op，避免叠加） */
let activeDisposer: (() => void) | null = null;

/**
 * 安装全局错误监听：把未捕获异常 / 未处理 Promise 拒绝转发进 error-diary 日记。
 * 幂等：已安装则直接返回空 disposer；返回函数用于移除监听（测试隔离 / 卸载路径）。
 */
export function installGlobalErrorListeners(): () => void {
  if (activeDisposer) return () => {};

  const onError = (e: ErrorEvent): void => {
    const msg = e.message || String(e.error || "未知脚本错误");
    pushToDiary(msg, "failed");
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    const msg = e.reason?.message || String(e.reason || "未处理的 Promise 拒绝");
    pushToDiary(msg, "failed");
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  activeDisposer = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    activeDisposer = null;
  };
  return activeDisposer;
}
