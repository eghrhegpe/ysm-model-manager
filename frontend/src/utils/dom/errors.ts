// ===== 错误信息友好化（类型化版 — ADR-014 P2 + ADR-045 i18n）=====
// Go 返回的原始错误 → 用户能看懂的友好提示（支持多语言）

import { t } from "../../core/i18n/t.ts";

/**
 * 将 Go 错误转换为友好提示
 * @param err - 错误对象或字符串
 * @param fallback - 未匹配时的前缀，默认 "操作失败"
 */
export function friendlyError(err: unknown, fallback?: string): string {
  const fb = fallback ?? t("error.fallback");
  if (!err) return t("error.unknown");
  const msg =
    typeof err === "string"
      ? err
      : String((err as { message?: unknown }).message || err);

  // 已经包含汉字 → 直接使用（Go 端已有友好提示或已翻译）
  if (/[\u4e00-\u9fff]/.test(msg)) return msg;

  // 常见错误模式匹配 → i18n key
  // 优先级：社区抓取常见错误 > 通用文件/网络错误
  const patterns: Array<[RegExp, string]> = [
    // ===== 社区功能高频错误 =====
    [/\brate limit\b|\b429\b|\btoo many requests\b/i, "error.rateLimited"],
    [/abort|cancelled/i, "error.cancelled"],
    [/parse error|unexpected token|malformed|syntaxerror/i, "error.dataFormat"],
    [/dns|getaddrinfo|ENOTFOUND|resolve host|resolve.*domain/i, "error.dnsFailed"],
    [/econnrefused|econnreset|eof|socket|connection refused/i, "error.connectionLost"],
    [/ssl|tls|certificate/i, "error.sslError"],
    // ===== 通用文件/网络错误 =====
    [/access is denied|permission denied|eacces|access refused/i, "error.permissionDenied"],
    [/no such file|not found|cannot find|does not exist/i, "error.notFound"],
    [/sharing violation|used by another process|is locked|file exists/i, "error.fileLocked"],
    [/(?:directory|folder) is empty|no files/i, "error.dirEmpty"],
    [/timeout|timed out/i, "error.timeout"],
    [/network|proxy|fetch/i, "error.networkError"],
    [/invalid argument/i, "error.invalidArg"],
    [/already exists/i, "error.alreadyExists"],
    [/disk full|no space|disk quota/i, "error.diskFull"],
    [/unsupported|not supported/i, "error.unsupported"],
    [/too many/i, "error.tooMany"],
    [/not a directory/i, "error.notADir"],
    [/is a directory/i, "error.isADir"],
  ];

  for (const [regex, key] of patterns) {
    if (regex.test(msg)) return t(key);
  }

  return `${fb}: ${msg}`;
}
