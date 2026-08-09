// ===== 文件大小/日期格式化（类型化版 — ADR-014 P2）=====

// 阈值具名常量（P3：魔法数值治理）
const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
/** 红色阈值：≥3MB（含边界，sizeColor 语义「≥」） */
const RED_BOUND = 3 * MB;

/** 字节数 → 可读大小（B/KB/MB/GB），非法值返回空串 */
export function fmt(b: number): string {
  // P2 修复：±Infinity 是 truthy，`!b && b !== 0` 挡不住 → 输出 "Infinity GB"。
  // 用 Number.isFinite 一并拦截 NaN/±Infinity，落实「非法输入一律返回空串」不变量。
  // P3 修复：负值同样非法（文件大小不可能为负，`fmt(-5)` 原输出 "-5 B"）——
  // Number.isFinite 对负值返回 true，需显式拒绝
  if (!Number.isFinite(b) || b < 0) return "";
  if (b < KB) return b + " B";
  if (b < MB) return (b / KB).toFixed(1) + " KB";
  if (b < GB) return (b / MB).toFixed(1) + " MB";
  return (b / GB).toFixed(1) + " GB";
}

/** 文件大小颜色 class：<1MB 绿色，1-3MB 正常，≥3MB 红色 */
export function sizeColor(b: number): string {
  if (!Number.isFinite(b) || b < 0) return "";
  if (b < MB) return "sz-green";
  if (b < RED_BOUND) return "";
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
