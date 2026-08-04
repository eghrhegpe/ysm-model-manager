// ===== UI 报错落日记：toast:show(type=error) → 日记系统（go/logs）=====
// 所有 error toast 自动写入 ImportLog（op="ui"），诊断页可回溯

import { bus, type ToastPayload } from "../bus.ts";
import { getApp } from "../wails/app.ts";

let _registered = false;

/**
 * 注册 UI 报错落日记功能。
 * 幂等，可重复调用。
 */
export function registerErrorDiary(): void {
  if (_registered) return;
  _registered = true;

  // 1. error toast → 日记
  bus.on("toast:show", (p: ToastPayload) => {
    if (p.type !== "error") return;
    logUiError(p.msg);
  });

  // 2. 未捕获异常 → 日记 + toast
  window.addEventListener("error", (e) => {
    const msg = e.message || String(e.error || "未知脚本错误");
    logUiError(msg);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg =
      e.reason?.message || String(e.reason || "未处理的 Promise 拒绝");
    logUiError(msg);
  });
}

async function logUiError(msg: string): Promise<void> {
  try {
    const { AddOpLog } = await getApp();
    // 净化：去掉 ❌ 前缀 + 截断过长消息
    const clean = msg.replace(/^[❌❎]\s*/, "").slice(0, 200);
    void AddOpLog("ui", "", clean, "", 0, "failed", msg.slice(0, 500));
  } catch {
    // 日记写入失败不影响调用方
  }
}