/**
 * 下载纯文本文件（DOM 职责下沉到 utils/dom，供 core 层调用——context-menu-handlers 等
 * 不再直接操作 document/URL）。与 utils/dom/clipboard.ts 同形：纯函数，可单测，
 * 失败由调用方 catch 后转 toast。
 */

/**
 * 触发浏览器下载纯文本文件：Blob → ObjectURL → 临时 `<a download>` → click → revoke。
 * @param content 文件内容（UTF-8 文本）
 * @param filename 下载时的文件名（含扩展名）
 * @returns 创建并点击的 anchor 元素（测试断言用；生产可忽略）
 */
export function downloadTextFile(content: string, filename: string): HTMLAnchorElement {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  return a;
}