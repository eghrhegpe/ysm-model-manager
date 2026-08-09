// ===== UI 报错落日记：toast:show(type=error|warn) → 日记系统（go/logs）=====
// error/warn toast 自动写入 ImportLog（op="ui"），诊断页可回溯

import { bus, type ToastPayload } from "../bus.ts";
import { getApp } from "../wails/app.ts";

let _registered = false;
let _unsubToast: (() => void) | undefined;
let _unsubError: ((e: ErrorEvent) => void) | undefined;
let _unsubRejection: ((e: PromiseRejectionEvent) => void) | undefined;

/**
 * 仅测试用：重置注册状态使下次 registerErrorDiary 可重新注册。
 * 不在生产代码中调用。
 */
export function __TEST__resetDiary(): void {
  _registered = false;
  _unsubToast?.();
  _unsubToast = undefined;
  if (_unsubError) {
    window.removeEventListener("error", _unsubError as EventListener);
    _unsubError = undefined;
  }
  if (_unsubRejection) {
    window.removeEventListener("unhandledrejection", _unsubRejection as EventListener);
    _unsubRejection = undefined;
  }
}

/**
 * 注册 UI 报错落日记功能。
 * 幂等，可重复调用。
 */
export function registerErrorDiary(): void {
  if (_registered) return;
  _registered = true;

  // 1. error/warn toast → 日记
  _unsubToast = bus.on("toast:show", (p: ToastPayload) => {
    if (p.type !== "error" && p.type !== "warn") return;
    const status = p.type === "error" ? "failed" : "warn";
    void logUiMsg(p.msg, status);
  });

  // 2. 未捕获异常 → 日记
  const onError = (e: ErrorEvent): void => {
    const msg = e.message || String(e.error || "未知脚本错误");
    void logUiMsg(msg, "failed");
  };
  window.addEventListener("error", onError);
  _unsubError = onError;

  const onRejection = (e: PromiseRejectionEvent): void => {
    const msg = e.reason?.message || String(e.reason || "未处理的 Promise 拒绝");
    void logUiMsg(msg, "failed");
  };
  window.addEventListener("unhandledrejection", onRejection);
  _unsubRejection = onRejection;
}

async function logUiMsg(msg: string, status: string): Promise<void> {
  try {
    const { AddOpLog } = await getApp();
    // 净化：去掉 ❌/⚠️ 前缀（含 U+FE0F 变体选择器）+ 截断
    const clean = msg.replace(/^[❌❎⚠]️?\s*/, "").slice(0, 200);
    // P2 修复（审核发现）：原 `void AddOpLog(...)` 浮空 Promise 未 catch——Wails 调用
    // 失败会 reject → unhandledrejection → 触发本模块 onRejection → 再 logUiMsg →
    // 再 AddOpLog → 拒绝 → 死循环；补 .catch 截断错误链
    AddOpLog("ui", clean, "", "", 0, status, msg.slice(0, 500)).catch((e) => {
      console.warn("[error-diary] AddOpLog 失败:", e);
    });
  } catch {
    // 日记写入失败不影响调用方
  }
}