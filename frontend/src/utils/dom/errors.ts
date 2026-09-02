// ===== 错误信息友好化（类型化版 — ADR-014 P2 + ADR-045 i18n + ADR-051 单一事实来源）=====
// Go 返回的原始错误 → 用户能看懂的友好提示（支持多语言）
//
// ADR-051 决策：删除正则兜底表，只消费结构化 AppError.Code。

import { t, type LocaleKey } from "../../core/i18n/t.ts";
// CODE_KEYS 覆盖所有有明确分类语义的 Code；未列出的 Code（IO_ERROR/MKDIR_FAILED/
// WRITE_FAILED/FILE_EMPTY/FILE_TOO_LARGE/LINK_FAILED）语义靠 Reason 中文透传，
// 不在此武断归类（各 Code 的 Reason/Suggestion 比通用分类更具体，映射会误导用户）。
// 值收窄为 LocaleKey：映射表的 key 必须是语言包合法 key（字面量拼错编译期报错）。
const CODE_KEYS: Record<string, LocaleKey> = {
  FILE_EXISTS: "error.alreadyExists",
  ALREADY_EXISTS: "error.alreadyExists",
  INVALID_PARAM: "error.invalidArg",
  INVALID_PATH: "error.invalidArg",
  FILENAME_INVALID: "error.invalidArg",
  FILE_TYPE_UNSUPPORTED: "error.unsupported",
  UNSUPPORTED_FORMAT: "error.unsupported",
  DECODE_FAILED: "error.dataFormat",
};

/**
 * 从错误对象提取 AppError.Code。
 * Wails v3 将 Go 返回的 error 序列化到异常对象的 cause 属性（calls.d.ts：
 * "The exception might have a 'cause' field with the value returned"），
 * 即 RuntimeError.cause.Code 才是 AppError 的 Code 字段；err.Code 仅作兼容兜底。
 */
function extractAppErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const cause = (err as { cause?: unknown }).cause;
  const codeSource =
    cause !== null && typeof cause === "object" && "Code" in cause
      ? (cause as { Code: unknown }).Code
      : "Code" in err
        ? (err as { Code: unknown }).Code
        : undefined;
  return codeSource === undefined ? undefined : String(codeSource);
}

/**
 * 将 Go 错误转换为友好提示
 * @param err - 错误对象或字符串
 * @param fallback - 未匹配时的前缀，默认 "操作失败"
 */
export function friendlyError(err: unknown, fallback?: string): string {
  const fb = fallback ?? t("error.fallback");
  if (!err) return t("error.unknown");

  // ADR-051：优先消费结构化 Code（Wails 把 AppError 放异常 cause.Code）
  const code = extractAppErrorCode(err);
  if (code !== undefined) {
    const key = CODE_KEYS[code];
    if (key) return t(key);
    // 未列出的 Code：透传 Reason 中文（Go 端已在 Reason 中填写用户可读文案）
    const msg = String((err as { message?: unknown }).message || err);
    if (/[\u4e00-\u9fff]/.test(msg)) return stripPathSegments(msg);
    return `${fb}: ${stripPathSegments(msg)}`;
  }

  // 非 AppError（如纯字符串/JS Error）：含中文直接透传，否则 fallback
  const msg =
    typeof err === "string"
      ? err
      : String((err as { message?: unknown }).message || err);
  if (/[\u4e00-\u9fff]/.test(msg)) return stripPathSegments(msg);
  return `${fb}: ${stripPathSegments(msg)}`;
}

// stripPathSegments 剥离 Go 端 AppError.Error() 拼入的内部路径段（ADR-051 透传截断）。
// 格式：`问题描述：X 操作：Y 源路径：P 目标路径：Q 解决建议：R`——路径为内部绝对
// 路径（Windows 驱动器号/UNC），用户侧 toast 不应泄漏。仅剥离标记段，保留其余文案。
// P3 修复（审核）：导出供 error-diary 复用（写日记同样不应持久化完整内部路径）
export function stripPathSegments(msg: string): string {
  // 路径可含空格：剥到下一个字段标记（操作/目标路径/解决建议）为止
  return msg.replace(
    /\s+(?:源路径|目标路径)：.*?(?=\s+(?:操作|目标路径|解决建议)：|$)/g,
    "",
  );
}

/**
 * 判断错误消息是否为「文件已存在」冲突（索引 4.2 收敛）。
 * 统一消费结构化 AppError.Code 优先，字符串匹配兜底——两处调用点（import-executor/
 * import-queue-events）原各自手写 `includes("FILE_EXISTS") || includes(中文文案)`，
 * 且中文文案已漂移（「目标已存在」 vs 「文件已存在」），收敛后任一处新增/调整
 * 文案只需改本函数。
 */
export function isFileExistsError(err: unknown): boolean {
  const code = extractAppErrorCode(err);
  if (code === "FILE_EXISTS" || code === "ALREADY_EXISTS") return true;
  const msg =
    typeof err === "string"
      ? err
      : String((err as { message?: unknown }).message || err);
  return (
    msg.includes("FILE_EXISTS") ||
    msg.includes("目标已存在") ||
    msg.includes("文件已存在")
  );
}
