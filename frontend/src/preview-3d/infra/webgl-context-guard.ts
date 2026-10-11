// ===== WebGL context lost/restored 守卫（锐评 2026-10-11 P2 落地）=====
// 病症：renderer 全生命周期零监听 contextlost——桌面 WebView2 的 GPU 进程被系统回收
// （内存压力/驱动重置/核显-独显切换）时浏览器抛 `webglcontextlost`，three 的响应是
// **静默挂起渲染**（无异常、无回调），用户只看到预览冻结黑场，且无任何说明——与其
// 他一贯「失败可视化」（showLoadFailure / toast）的标准相悖。恢复前多帧可能持续黑场。
//
// 本模块在 renderer.domElement 上挂 lost/restored 一对监听，把「发生了什么」变成
// 可观测的 toast + 日志，并保留 `isWebGlContextLost()` 供渲染循环/诊断查询。
// **不接管恢复本身**：context 恢复由浏览器 + three 内部完成（restored 事件后
// three 会重新初始化 GL 状态并将 renderer 视为可用），本守卫只负责让用户知道
// 「GPU 被重置了，正在等恢复」——这是既有链路补上的缺失的一环，不引入新的恢复语义。
//
// 生命周期：`installWebGlContextGuard` 在 renderer 创建时（shared-infra buildSharedInfra
// 首次装配分支）调用一次；renderer 跨 session 复用（ADR-227），故守卫也随 renderer
// 常驻——**禁止**挂在 session 级 cleanup 摘除（那会是「每次关预览就丢监听」的复活病，
// 因为 renderer 单例还在）。uninstall 只在 renderer 终局拆除（teardown）时调用。
//
// 事件语义（WebGL 标准）：`webglcontextlost` 若不 `preventDefault()`，context 将永久
// 销毁不可恢复；恢复流程要求 preventDefault + 浏览器自动重试 → `webglcontextrestored`。

import type * as THREE from "three";
import { logWarn } from "@/utils/base/primitives/log.ts";

/** context 当前是否处于 lost 态（供渲染循环/诊断查询；false = 正常或已恢复） */
let _contextLost = false;

/** 当前是否处于 WebGL context lost 态 */
export function isWebGlContextLost(): boolean {
  return _contextLost;
}

/** 测试用：复位内部标志（防跨用例串扰） */
export function __resetWebGlContextLostForTest(): void {
  _contextLost = false;
}

/** 守卫句柄：uninstall 摘除监听（仅在 renderer 终局拆除时调用） */
export interface WebGlContextGuard {
  uninstall(): void;
}

/**
 * 在 renderer 上挂 context lost/restored 监听。renderer 单例生命周期内调用一次。
 *
 * @param renderer  目标 renderer（取其 domElement 挂监听）
 * @param hooks     可选回调（toast/日志接入点；默认仅置标志位）
 * @returns 守卫句柄（uninstall 幂等）
 */
export function installWebGlContextGuard(
  renderer: THREE.WebGLRenderer,
  hooks: { onLost?: () => void; onRestored?: () => void } = {},
): WebGlContextGuard {
  const el = renderer.domElement;
  if (!el) return { uninstall: () => {} }; // 防御：无 DOM 元素（异常构造）则空守卫

  const onLost = (e: Event): void => {
    // preventDefault 是恢复的前提：不 prevent 则 context 被销毁、重启预览才能回来
    e.preventDefault();
    _contextLost = true;
    hooks.onLost?.();
  };
  const onRestored = (): void => {
    _contextLost = false;
    hooks.onRestored?.();
  };
  el.addEventListener("webglcontextlost", onLost, false);
  el.addEventListener("webglcontextrestored", onRestored, false);

  return {
    uninstall: () => {
      el.removeEventListener("webglcontextlost", onLost);
      el.removeEventListener("webglcontextrestored", onRestored);
      _contextLost = false;
    },
  };
}

/** 生产接线回调：lost → 提示等待恢复；restored → 提示已恢复（toast 由调用方注入）。 */
export function defaultContextLostHooks(): { onLost: () => void; onRestored: () => void } {
  return {
    onLost: () => {
      logWarn("preview-3d", "WebGL context lost — waiting for browser to restore");
    },
    onRestored: () => {
      logWarn("preview-3d", "WebGL context restored");
    },
  };
}
