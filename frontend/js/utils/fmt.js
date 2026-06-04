// ===== 文件大小格式化 =====
export function fmt(b) {
  if (!b && b !== 0) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

/** 文件大小颜色 class：<1MB 绿色，1-3MB 正常，>3MB 红色 */
export function sizeColor(b) {
  if (!b && b !== 0) return "";
  if (b < 1048576) return "sz-green";
  if (b < 3145728) return "";
  return "sz-red";
}

// ===== 日期格式化 =====
export function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // 今年显示 M月D日，往年显示 YYYY/M/D
  if (d.getFullYear() === now.getFullYear()) {
    return d.getMonth() + 1 + "月" + d.getDate() + "日";
  }
  return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
}
