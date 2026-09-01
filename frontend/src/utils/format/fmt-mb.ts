// utils/format/fmt-mb.ts — 字节 → MB 文本格式化。
// 自 modal.ts 下沉至 format 层：进度弹窗与窗口标题共用（原注释即声明共用，
// 却定义在弹窗文件里——共用逻辑应在格式化层，避免 dom 层被反向拖入标题栏等非弹窗场景）。

/** 格式化字节为 MB（进度弹窗/窗口标题共用）；非有限值/负值回退 "0.0 MB" */
export function fmtMB(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0.0 MB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
