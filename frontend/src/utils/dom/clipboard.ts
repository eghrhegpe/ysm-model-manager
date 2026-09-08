/**
 * 剪贴板纯工具（DOM 职责下沉到 utils/dom，供 core 层调用——context-menu-handlers 等
 * 不再直接操作 document/navigator）。
 */
import { logWarn } from "@/utils/base/log.ts";

/** 复制纯文本到剪贴板：优先 Clipboard API（需要安全上下文），降级隐藏 textarea + execCommand */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    logWarn("clipboard", "Clipboard API 不可用，降级 textarea+execCommand", err);
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (err2) {
      logWarn("clipboard", "execCommand('copy') 失败", err2);
      copied = false;
    }
    document.body.removeChild(ta);
    return copied;
  }
}
