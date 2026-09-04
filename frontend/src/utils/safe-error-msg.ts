// ===== 安全错误消息提取（Worker 安全，无 i18n 依赖）=====
// 统一 `e instanceof Error ? e.message : String(e)` 内联模式。
// 与 errors.ts 的 friendlyError 区别：
//   - safeErrorMessage：轻量、无 i18n、Worker 可安全 import
//   - friendlyError：消费 AppError.Code + i18n 翻译 + 路径剥离（用户侧 toast）
//
// 使用场景：
//   - Worker 内错误消息提取（stats.worker / mmd-ktx2-worker / pmx-parser.worker）
//   - 内部日志/诊断（devLog / 性能面板）——不需要 i18n 翻译
//   - 任何只需 "拿到错误字符串" 的场景

/**
 * 从任意错误对象提取可读消息字符串。
 * - Error 实例 → `.message`
 * - 含 `.message` 属性的对象 → `.message`
 * - 其他 → `String(err)`
 * - null/undefined → `"unknown error"`
 */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err == null) return "unknown error";
  if (
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}
