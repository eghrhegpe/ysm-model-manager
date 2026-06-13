// ===== 错误信息友好化 =====
// Go 返回的原始错误 → 用户能看懂的中文提示

/**
 * 将 Go 错误转换为中文友好提示
 * @param {*} err - 错误对象或字符串
 * @param {string} fallback - 未匹配时的前缀，默认 "操作失败"
 * @returns {string}
 */
export function friendlyError(err, fallback = "操作失败") {
  if (!err) return "未知错误";
  const msg = typeof err === "string" ? err : String(err.message || err);

  // 已经包含汉字 → 直接使用（Go 端已有友好提示或已翻译）
  if (/[\u4e00-\u9fff]/.test(msg)) return msg;

  // 常见错误模式匹配
  const patterns = [
    [/access is denied|permission denied|eacces/i, "权限不足，无法访问文件"],
    [/no such file|not found|cannot find|does not exist/i, "文件或目录不存在"],
    [/sharing violation|used by another process|is locked|file exists/i, "文件被其他程序占用，请关闭相关程序后重试"],
    [/(?:is )?empty|no files/i, "目录为空，没有可操作的文件"],
    [/timeout|timed out/i, "连接超时，请检查网络"],
    [/refused|connection refused/i, "连接被拒绝，请检查网络或防火墙"],
    [/network|proxy|fetch/i, "网络连接异常"],
    [/invalid argument|invalid/i, "参数无效"],
    [/already exists/i, "文件已存在"],
    [/disk full|no space|disk quota/i, "磁盘空间不足"],
    [/unsupported|not supported/i, "不支持的格式或操作"],
    [/too many/i, "操作过于频繁，请稍后重试"],
    [/not a directory/i, "路径不是目录"],
    [/is a directory/i, "路径是目录，不是文件"],
  ];

  for (const [regex, cn] of patterns) {
    if (regex.test(msg)) return cn;
  }

  return `${fallback}: ${msg}`;
}
