// ===== UI 报错落日记：toast:show(type=error|warn) → 日记系统（go/logs）=====
// error/warn toast 自动写入 ImportLog（op="ui"），诊断页可回溯

import { getApp } from "../backend/app.ts";
import { bus, type ToastPayload } from "../bus.ts";
import { setLogSink } from "../utils/core/log.ts";
import { stripPathSegments } from "../utils/dom/errors.ts";

let _registered = false;
let _unsubToast: (() => void) | undefined;
let _unsubError: ((e: ErrorEvent) => void) | undefined;
let _unsubRejection: ((e: PromiseRejectionEvent) => void) | undefined;

// P3 修复（审核）：魔数收口——clean 截断 200 字符、errMsg 截断 500 字符。
// 前端 500 与 go/logs maxLogEntries 数值巧合但语义无关（条数上限）；Go 侧
// maxFieldLen=1024 会再截断一次，前端截断是冗余防御，保留但收口成常量。
const DIARY_MODEL_MAX = 200;
const DIARY_ERRMSG_MAX = 500;
// P2 修复（审核，写入放大去重）：同 (msg+status) 时间窗内只记一条——
// 网络抖动/批量导入失败风暴会触发 N 次 AddOpLog + 全文件重写，且 UI 错误
// 挤掉真实业务日志（500 条共享环形缓冲）；5s 去重成本最低
const DIARY_DEDUP_WINDOW = 5000;
let _lastDedupKey = "";
let _lastDedupAt = 0;

/**
 * 注销日记监听（与 registerErrorDiary 对称的正式生命周期 API，幂等）。
 * 拆除 toast/error/unhandledrejection/logSink 四路监听并重置去重状态，
 * 下次 registerErrorDiary 可重新注册。应用生命周期内通常只在测试中使用。
 */
export function unregisterErrorDiary(): void {
  _registered = false;
  // 重置去重状态——残留的 _lastDedupKey/_lastDedupAt 会让重新注册后
  // 相邻相同 (msg,status) 被 5s 窗口误去重
  _lastDedupKey = "";
  _lastDedupAt = 0;
  setLogSink(null); // 同步拆除 logWarn/logError 透写（防 sink 残留串扰）
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

  // 1. error/warn toast → 日记
  const unsubToast = bus.on("toast:show", (p: ToastPayload) => {
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

  const onRejection = (e: PromiseRejectionEvent): void => {
    const msg = e.reason?.message || String(e.reason || "未处理的 Promise 拒绝");
    void logUiMsg(msg, "failed");
  };
  window.addEventListener("unhandledrejection", onRejection);

  // P3 修复（审核）：_registered 挪到三组监听全部挂载成功后置位——
  // 原先置位后注册，任一 addEventListener/bus.on 抛错则模块永久静默失效
  _unsubToast = unsubToast;
  _unsubError = onError;
  _unsubRejection = onRejection;
  // 4. logWarn/logError 透写日记（code review #6：生产 143 处 console.* 中热路径/
  //    加载失败类告警原只进 console，与「排查往环形日志塞」红线相悖）——经 log.ts
  //    的注入式 sink 收敛到本模块 AddOpLog，复用 5s 去重防写入放大
  setLogSink((level, tag, msg, err) => {
    const detail = err instanceof Error ? err.message : err === undefined ? "" : String(err);
    const status = level === "error" ? "failed" : "warn";
    void logUiMsg(`[${tag}] ${msg}${detail ? `: ${detail}` : ""}`, status);
  });
  _registered = true;
}

async function logUiMsg(msg: string, status: string): Promise<void> {
  // P2 修复（审核）：同 (msg+status) 5s 去重——错误风暴只记首条
  const key = `${status}:${msg}`;
  const now = Date.now();
  if (key === _lastDedupKey && now - _lastDedupAt < DIARY_DEDUP_WINDOW) return;
  _lastDedupKey = key;
  _lastDedupAt = now;
  try {
    const { AddOpLog } = await getApp();
    // 净化：去掉 ❌/⚠️ 前缀（含 U+FE0F 变体选择器）+ 剥离内部路径段 + 截断
    // P2 修复（code_review）：clean 同样应用 stripPathSegments——ModelName 字段
    // 也会持久化进日记并在诊断页展示/复制，单边剥离 errMsg 会让路径从 ModelName
    // 字段泄漏（路径通常 < 200 字符，截断拦不住），与新注释承诺的剥离边界不一致
    const clean = stripPathSegments(msg)
      .replace(/^[❌❎⚠]️?\s*/, "")
      .slice(0, DIARY_MODEL_MAX);
    // P2 修复（审核，敏感路径）：写日记同样剥离内部路径段——与 ADR-051 透传截断
    // 边界一致（friendlyError 已对用户侧剥离，日记持久化不应重新引入完整路径）
    const errMsg = stripPathSegments(msg).slice(0, DIARY_ERRMSG_MAX);
    // P2 修复（审核发现）：原 `void AddOpLog(...)` 浮空 Promise 未 catch——Wails 调用
    // 失败会 reject → unhandledrejection → 触发本模块 onRejection → 再 logUiMsg →
    // 再 AddOpLog → 拒绝 → 死循环；补 .catch 截断错误链
    AddOpLog("ui", clean, "", "", 0, status, errMsg).catch((e) => {
      console.warn("[error-diary] AddOpLog 失败:", e);
    });
  } catch (e) {
    // 日记写入失败不影响调用方；节流留痕（原空 catch 全静默，与 .catch 分支不对称）
    console.warn("[error-diary] 写入失败:", e);
  }
}
