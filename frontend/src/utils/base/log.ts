// utils/base/log.ts — 极简日志出口，供 async 等叶模块复用。
// 保持零应用层依赖：仅封装 console.warn / console.error，作为 ysm 统一告警通道的薄封装。
// 透写环形日志（code review #6）：经可注入 sink 收敛——error-diary 注册时调
// setLogSink 把告警接进 AddOpLog 日记（对齐 setSceneCapabilityLookup 注入范式，
// 本模块仍不 import 应用层）；sink 为 null 时仅 console，行为同旧版。

/** 日志透写 sink：level 区分 warn/error；err 原样透传给消费方自行格式化 */
export type LogSink = (level: "warn" | "error", tag: string, msg: string, err?: unknown) => void;

let _sink: LogSink | null = null;

/** 注入/清除透写 sink（error-diary 注册时安装；传 null 恢复纯 console） */
export function setLogSink(sink: LogSink | null): void {
  _sink = sink;
}

/** 统一告警日志。tag 用于按模块聚合排查；err 可为任意错误值。 */
export function logWarn(tag: string, msg: string, err?: unknown): void {
  // 无 err 时不追加空参数槽（code review #11：err ?? "" 会让控制台多一个空槽）
  if (err === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[${tag}] ${msg}`);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[${tag}] ${msg}`, err);
  }
  _sink?.("warn", tag, msg, err);
}

/** 统一错误日志。 */
export function logError(tag: string, msg: string, err?: unknown): void {
  if (err === undefined) {
    // eslint-disable-next-line no-console
    console.error(`[${tag}] ${msg}`);
  } else {
    // eslint-disable-next-line no-console
    console.error(`[${tag}] ${msg}`, err);
  }
  _sink?.("error", tag, msg, err);
}
