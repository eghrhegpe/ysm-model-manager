// ===== UI 报错落日记：toast:show(type=error|warn) → 日记系统（go/logs）=====
// error/warn toast 自动写入运行时日志环，诊断页可回溯。
// ADR-189 D1：core 不感知 Wails——落盘通道 DiarySink 由装配层注入
//（AddOpLog 适配见 backend/diary-sink.ts）；本模块只持净化/去重/截断策略。

import { bus, type ToastPayload } from "../bus.ts";
import { setLogSink } from "../utils/core/log.ts";
import { stripPathSegments } from "../utils/dom/errors.ts";

/** 日记状态（与 go/logs status 枚举对齐） */
export type DiaryStatus = "failed" | "warn";

/** 净化后的日记条目：title/detail 均已剥离 emoji 前缀与内部路径段并截断 */
export interface DiaryEntry {
  /** 短标题（200 截断），对应 AddOpLog modelName 位 */
  title: string;
  /** 完整消息（500 截断），对应 AddOpLog errMsg 位 */
  detail: string;
  status: DiaryStatus;
}

/** 落盘通道：由装配层注入；实现须自行捕获异步失败，不得向调用方逸出未处理拒绝 */
export type DiarySink = (entry: DiaryEntry) => void;

let _registered = false;
let _sink: DiarySink | undefined;
let _unsubToast: (() => void) | undefined;
let _unsubError: ((e: ErrorEvent) => void) | undefined;
let _unsubRejection: ((e: PromiseRejectionEvent) => void) | undefined;

// 魔数收口：clean 截断 200 字符、detail 截断 500 字符（前端 500 与 go/logs
// maxLogEntries 条数上限数值巧合但语义无关；Go 侧 maxFieldLen=1024 会再截断，
// 前端截断是冗余防御，保留但收口成常量）。
const DIARY_MODEL_MAX = 200;
const DIARY_ERRMSG_MAX = 500;
// 同 (msg+status) 连续去重：网络抖动/批量导入失败风暴防写入放大
//（UI 错误挤占 500 条共享环形缓冲）；A-B-A 交错风暴按设计逐条记录
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
  _sink = undefined;
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
 * 注册 UI 报错落日记功能（sink 注入式，ADR-189 D1）。
 * 幂等，可重复调用；注册中途任一步失败则整体回滚（unregisterErrorDiary），
 * 防止部分注册成功后重试叠加监听（同条 toast 落两遍日记）。
 */
export function registerErrorDiary(sink: DiarySink): void {
  if (_registered) return;
  try {
    registerErrorDiaryInner(sink);
  } catch (e) {
    unregisterErrorDiary();
    console.warn("[error-diary] 注册失败（已回滚，可重试）:", e);
  }
}

function registerErrorDiaryInner(sink: DiarySink): void {
  if (_registered) return;
  if (typeof sink !== "function") {
    throw new TypeError("registerErrorDiary: sink 必须为函数");
  }

  // 1. error/warn toast → 日记
  const unsubToast = bus.on("toast:show", (p: ToastPayload) => {
    if (p.type !== "error" && p.type !== "warn") return;
    logUiMsg(p.msg, p.type === "error" ? "failed" : "warn");
  });

  // 2. 未捕获异常 → 日记
  const onError = (e: ErrorEvent): void => {
    const msg = e.message || String(e.error || "未知脚本错误");
    logUiMsg(msg, "failed");
  };
  window.addEventListener("error", onError);

  const onRejection = (e: PromiseRejectionEvent): void => {
    const msg = e.reason?.message || String(e.reason || "未处理的 Promise 拒绝");
    logUiMsg(msg, "failed");
  };
  window.addEventListener("unhandledrejection", onRejection);

  // 三组监听全部挂载成功后才登记 sink 与置位——任一 addEventListener/bus.on
  // 抛错则整体回滚，模块不会永久静默失效
  _unsubToast = unsubToast;
  _unsubError = onError;
  _unsubRejection = onRejection;
  _sink = sink;

  // 3. logWarn/logError 透写日记：经 log.ts 的注入式 sink 收敛到本模块落盘，
  // 复用 5s 去重防写入放大
  setLogSink((level, tag, msg, err) => {
    const detail = err instanceof Error ? err.message : err === undefined ? "" : String(err);
    logUiMsg(
      `[${tag}] ${msg}${detail ? `: ${detail}` : ""}`,
      level === "error" ? "failed" : "warn",
    );
  });
  _registered = true;
}

function logUiMsg(msg: string, status: DiaryStatus): void {
  if (!_sink) return;
  // 同 (msg+status) 5s 去重——实为「连续相同消息」去重（只记 _lastDedupKey 单条）
  const key = `${status}:${msg}`;
  const now = Date.now();
  if (key === _lastDedupKey && now - _lastDedupAt < DIARY_DEDUP_WINDOW) return;
  _lastDedupKey = key;
  _lastDedupAt = now;
  // 净化：剥 ❌/⚠️ 前缀（含 U+FE0F 变体选择器）+ 剥离内部路径段（title/detail
  // 两持久化字段都需要，stripPathSegments 只算一次复用）+ 截断（ADR-051：
  // 日记持久化不引入完整路径）
  const stripped = stripPathSegments(msg);
  const title = stripped.replace(/^[❌❎⚠]️?\s*/, "").slice(0, DIARY_MODEL_MAX);
  const detail = stripped.slice(0, DIARY_ERRMSG_MAX);
  try {
    _sink({ title, detail, status });
  } catch (e) {
    // 日记写入失败不影响调用方；异步拒绝由 sink 实现自行截断（diary-sink.ts）
    console.warn("[error-diary] 写入失败:", e);
  }
}
