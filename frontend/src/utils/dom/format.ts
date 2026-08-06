// ===== 文件大小/日期格式化（类型化版 — ADR-014 P2）=====

/** 字节数 → 可读大小（B/KB/MB/GB），非法值返回空串 */
export function fmt(b: number): string {
  if (!b && b !== 0) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(1) + " GB";
}

/** 文件大小颜色 class：<1MB 绿色，1-3MB 正常，>3MB 红色 */
export function sizeColor(b: number): string {
  if (!b && b !== 0) return "";
  if (b < 1048576) return "sz-green";
  if (b < 3145728) return "";
  return "sz-red";
}

// ===== 日期格式化 =====

/** 时间戳 → 友好日期：今天显时间，今年显 M月D日，往年显 YYYY/M/D */
export function fmtDate(ts: number): string {
  if (!ts || Number.isNaN(ts)) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  // 固定 24 小时制 HH:mm：不依赖运行环境 locale（en-US 会输出 "10:30 AM"，
  // 与其余中文固定格式不一致，且导致 CI 与本地行为漂移）
  if (isToday)
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  // 今年显示 M月D日，往年显示 YYYY/M/D
  if (d.getFullYear() === now.getFullYear()) {
    return d.getMonth() + 1 + "月" + d.getDate() + "日";
  }
  return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
}
