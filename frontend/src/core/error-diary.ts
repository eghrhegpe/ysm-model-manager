// ===== UI 报错落日记：error/warn toast → 日记系统（go/logs）=====
// core 不感知 Wails、不摸 window：落盘通道 DiarySink 由装配层注入（backend/diary-sink.ts 适配 AddOpLog）；
// 全局错误监听（window error/unhandledrejection）下沉 backend/global-error-listeners.ts（装配层，唯一碰 window 处），
// 经本模块 pushToDiary 入口收口（ADR-189 D4：DOM 原语不进 core）。本模块只持净化/去重/截断策略。
// 设计沿革与陷阱 → docs/knowledge/core-error-diary.md
import { bus, type ToastPayload } from "@/bus";
import { setLogSink } from "@/utils/base/primitives/log.ts";
import { stripAppErrorPaths } from "@/utils/base/pure/apperror-text.ts";

export type DiaryStatus = "failed" | "warn";

export interface DiaryEntry {
  title: string;
  detail: string;
  status: DiaryStatus;
}

export type DiarySink = (entry: DiaryEntry) => void;

export interface DiaryHandle {
  /** 本次注册是否实际接管了 sink（false = 已被先前注册占位 / 注册失败，dispose 为 no-op） */
  readonly taken: boolean;
  dispose(): void;
}

// 截断上限：title 200 / detail 500（前端冗余防御，Go 侧 maxFieldLen=1024 再截）
const DIARY_MODEL_MAX = 200;
const DIARY_ERRMSG_MAX = 500;
// 去重：同键（status + 净化后 title）5s 窗口；窗口表上限 32 键，超限淘汰最旧（fail-open）
const DIARY_DEDUP_WINDOW = 5000;
const DEDUP_MAX_KEYS = 32;

// 模块级唯一状态：当前活跃 handle（注册守卫 + 注销入口）
let currentHandle: DiaryHandle | null = null;
// 当前活跃策略闭包（pushToDiary 入口转发目标；window 监听层经此进 core，core 不摸 window）
let currentPush: ((msg: string, status: DiaryStatus) => void) | null = null;
// 未注册态告警一次（ADR-210 D5：日记系统静默失活须留痕；注册成功复位，再失活可再告警）
let pushUnregisteredWarned = false;

/** 注销日记监听（与 registerErrorDiary 对称的正式生命周期 API，幂等）。 */
export function unregisterErrorDiary(): void {
  currentHandle?.dispose();
}

/**
 * 全局错误转发入口：供 window 监听层（backend/global-error-listeners.ts）
 * 把未捕获异常 / 未处理拒绝收口进同一套净化/去重策略。core 自身不挂 window 监听（ADR-189 D4）。
 * 未注册时告警一次并返回（ADR-210 D5：装配顺序漏 registerErrorDiary 会让全局错误静默丢失，
 * 不再静默 no-op；后续调用抑制，避免风暴）。
 */
export function pushToDiary(msg: string, status: DiaryStatus): void {
  if (!currentPush) {
    if (!pushUnregisteredWarned) {
      pushUnregisteredWarned = true;
      console.warn(
        "[error-diary] pushToDiary 未注册态调用：此错误未记录（装配层漏 registerErrorDiary?），后续调用静默",
      );
    }
    return;
  }
  currentPush(msg, status);
}

export function registerErrorDiary(sink: DiarySink): DiaryHandle {
  // 幂等：已注册则返回「未接管」句柄（taken=false 可区分「本人 sink 未生效」，不再静默 no-op）
  if (currentHandle) return { taken: false, dispose() {} };
  if (typeof sink !== "function") {
    throw new TypeError("registerErrorDiary: sink 必须为函数");
  }

  // ── 闭包状态（registerErrorDiary 调用间隔离；重注册即重置去重窗口）──
  const dedupAt = new Map<string, number>();
  let disposed = false;

  function logUiMsg(msg: string, status: DiaryStatus): void {
    // 净化：剥 ❌/⚠️ 前缀（含 U+FE0F 变体选择器）+ 剥 Go AppError 内部路径段（ADR-051）+ 截断
    const stripped = stripAppErrorPaths(msg);
    const title = stripped.replace(/^[❌⚠]️?\s*/, "").slice(0, DIARY_MODEL_MAX);
    const detail = stripped.slice(0, DIARY_ERRMSG_MAX);
    // 去重键 = 净化后（status + title）：仅路径段不同的原始文本塌缩为同键 → 同类 5s 落一条；
    // 按 key 独立窗口（A-B 交错风暴各自抑制），超 DEDUP_MAX_KEYS 淘汰最旧 fail-open（ADR-207 D1）
    const key = `${status}:${title}`;
    const now = Date.now();
    const last = dedupAt.get(key);
    if (last !== undefined && now - last < DIARY_DEDUP_WINDOW) return;
    if (dedupAt.size >= DEDUP_MAX_KEYS) {
      let oldestKey: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [k, at] of dedupAt) {
        if (at < oldestAt) {
          oldestAt = at;
          oldestKey = k;
        }
      }
      dedupAt.delete(oldestKey as string);
    }
    dedupAt.set(key, now);
    try {
      sink({ title, detail, status });
    } catch (e) {
      // 日记写入失败不影响调用方；异步拒绝由 sink 实现自行截断（diary-sink.ts）
      console.warn("[error-diary] 写入失败:", e);
    }
  }

  // ── 挂载副作用（可能失败）──
  // 全部成功后才提交 currentPush / currentHandle（见下），故部分失败时无僵尸句柄占用槽位——
  // currentHandle 未赋值则后续注册不被短路，可安全重试（不再需要 dispose 整体回滚）。
  let unsubToast: (() => void) | undefined;
  let logSinkInstalled = false;
  try {
    // 1. error/warn toast → 日记
    unsubToast = bus.on("toast:show", (p: ToastPayload) => {
      if (p.type !== "error" && p.type !== "warn") return;
      logUiMsg(p.msg, p.type === "error" ? "failed" : "warn");
    });

    // 2. logWarn/logError 透写日记：经 log.ts 的注入式 sink 收敛到本模块落盘，复用去重窗口
    setLogSink((level, tag, msg, err) => {
      const detail = err instanceof Error ? err.message : err === undefined ? "" : String(err);
      logUiMsg(
        `[${tag}] ${msg}${detail ? `: ${detail}` : ""}`,
        level === "error" ? "failed" : "warn",
      );
    });
    logSinkInstalled = true;
  } catch (e) {
    // 部分挂载失败 → 拆除已挂载项；currentHandle 尚未赋值，无僵尸风险，可重试
    unsubToast?.();
    if (logSinkInstalled) {
      setLogSink(null);
      logSinkInstalled = false;
    }
    console.warn("[error-diary] 注册失败（已回滚，可重试）:", e);
    return { taken: false, dispose() {} };
  }

  // ── 全部成功后才提交：赋值即生效（此前 pushToDiary 走未注册态告警，不会误收）──
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubToast?.();
    unsubToast = undefined;
    if (logSinkInstalled) {
      setLogSink(null);
      logSinkInstalled = false;
    }
    currentPush = null;
    currentHandle = null;
  };

  currentPush = logUiMsg;
  const handle: DiaryHandle = { taken: true, dispose };
  currentHandle = handle;
  pushUnregisteredWarned = false; // 注册成功复位失活告警：再卸载-未注册可重新告警（ADR-210 D5）
  return handle;
}
