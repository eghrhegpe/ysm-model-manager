// ===== 全局 toast 时长语义常量表（单一事实源）=====
// 所有 `bus.emit("toast:show", { ..., duration: N })` 与 toast helper 必须引用本表，
// 禁止内联魔法数字或在本文件外另起同名命名（命名冲突会造成语义漂移）。
// 改动本表须同步更新 toast-ms.test.ts 契约测试。

import type { ToastPayload } from "../../bus.ts";

export const TOAST_MS = {
  /** 瞬时提示（操作进行中、快速确认） */
  quick: 1500,
  /** 成功反馈 */
  success: 2000,
  /** 常规提示 / warn */
  info: 2500,
  /** 常规错误 / toast helper 默认 */
  normal: 3000,
  /** 需多读的失败详情（含友好错信息） */
  verbose: 4000,
  /** 长错误 / 部分失败汇总 / 渲染失败 */
  long: 5000,
  /** 长期通知（如「发现新版本」常驻提示，需多读） */
  persist: 10000,
  /** 近常驻（如下载进行中，几乎不被自动关闭） */
  sticky: 60000,
} as const;

/** toast:show 的 type 取值域——单一事实源 = bus.ts ToastPayload.type，编译期锁定对齐 */
export type ToastType = NonNullable<ToastPayload["type"]>;
