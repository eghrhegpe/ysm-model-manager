// ===== 渲染循环薄门面（P1 单例收敛：逻辑已迁至 render-host.ts 的 RendererHost 实例）=====
// 本文件仅保留对外 API 兼容层——8 个导出函数签名与重构前完全一致，内部全部委托给
// 全局唯一渲染宿主 `rendererHost`（方案 A「RendererHost 单例」：renderer 受 WebGL
// context 数量硬约束必须唯一，单 host 合理；perFrame / 活跃输入会话等状态收为实例字段，
// 不再依赖模块级 let 全局）。外部消费方（mount-preview-core / mount-session / unload-model）
// 与 render-loop.test.ts 均零改动。
//
// 历史：原 §4b 自 mount-preview-core 拆出（2026 锐评整改），持有 7 个模块级 let 单例；
// 现收敛为 RendererHost 实例字段（preview-3d P1 战役，与兄弟会话 A1 同一步伐）。
import type { ActiveInputSession } from "./render-host.ts";
import { rendererHost } from "./render-host.ts";
import type { SharedInfra } from "./shared-infra.ts";

/** 注册活跃输入会话（build 成功后调用；重复注册同一引用为 no-op） */
export function setActiveInputSession(s: ActiveInputSession): void {
  rendererHost.setActiveInputSession(s);
}

/** 注销活跃输入会话（cleanup 时调用）：从存活列表移除并置 active 为最新存活者 */
export function unregisterActiveInputSession(s: ActiveInputSession): void {
  rendererHost.unregisterActiveInputSession(s);
}

/** 取当前活跃输入会话（rAF 热路径调用；null 表示无活跃 session） */
export function getActiveInputSession(): ActiveInputSession | null {
  return rendererHost.getActiveInputSession();
}

/** 注册 perFrame 回调（setPerFrame 统一入口的落点） */
export function registerPerFrame(f: (dt: number) => void): void {
  rendererHost.registerPerFrame(f);
}

/** 注销 perFrame 回调（setPerFrame 换回调 / unloadModel / fullCleanup 用） */
export function removePerFrame(f: (dt: number) => void): void {
  rendererHost.removePerFrame(f);
}

/** 所有 session 的 perFrame 清空后停 rAF（fullCleanup 尾部调用） */
export function stopIfIdle(): void {
  rendererHost.stopIfIdle();
}

/** 测试用：重置循环状态（对应 RendererHost.reset） */
export function resetLoopState(): void {
  rendererHost.reset();
}

/**
 * 首个 session 启动全局 loop（幂等：仅未运行时创建；后续 session 只追加 perFrame）。
 * 实际驱动逻辑见 RendererHost.start。
 */
export function startGlobalRenderLoop(viewContainer: HTMLElement, infra: SharedInfra): void {
  rendererHost.start(viewContainer, infra);
}
