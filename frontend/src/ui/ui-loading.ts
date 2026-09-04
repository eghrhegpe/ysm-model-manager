// [doc:architecture] Loading indicator wrapper.
// 自 MikuMikuAR 迁移：解耦其全局 dom.loadingEl 遮罩与 i18n，改为自包含覆盖层。
//
// 收敛各加载器重复的「显示遮罩 → 执行 fn → finally 隐藏」样板（ADR-096 复用收敛）。
// 仅封装遮罩显隐与 finally 清理；异常处理由 fn 内部自行负责，以保留各加载器
// 差异化的错误文案与提前 return 语义。带进度回调的加载器不适用本包裹器。
//
// @param text 加载文案（原 textKey 改为字面量，ysm 可后续接 i18n 自行替换）
// @param fn   加载主体（自行 try/catch 差异化错误）
export async function withLoadingIndicator<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  const span = document.createElement("span");
  span.className = "loading-overlay-text";
  span.textContent = text;
  overlay.appendChild(span);
  document.body.appendChild(overlay);
  // 强制 reflow 以触发过渡动画
  void overlay.offsetWidth;
  overlay.classList.add("visible");
  try {
    return await fn();
  } finally {
    overlay.classList.remove("visible");
    // 等淡出过渡结束再移除
    setTimeout(() => overlay.remove(), 200);
  }
}
