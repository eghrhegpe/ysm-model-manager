/**
 * 剪贴板纯工具（DOM 职责下沉到 utils/dom，供 core 层调用——context-menu-handlers 等
 * 不再直接操作 document/navigator）。
 */
import { logWarn } from "@/utils/base/log.ts";

/** copyText 返回类型：区分成功 / 剪贴板拒绝 / 剪贴板不可用 / execCommand 失败 */
export type CopyResult =
  | { ok: true }
  | { ok: false; reason: "denied" | "unsupported" | "exec-failed" };

/** 复制纯文本到剪贴板：优先 Clipboard API（需要安全上下文），降级隐藏 textarea + execCommand */
export async function copyText(text: string): Promise<CopyResult> {
  // 追踪 clipboard API 失败原因，供 execCommand 也失败时返回
  let clipboardError: "denied" | "unsupported" | null = null;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (err) {
      logWarn("clipboard", "Clipboard API 不可用，降级 textarea+execCommand", err);
      clipboardError = "denied";
    }
  } else {
    clipboardError = "unsupported";
  }
  // 降级：隐藏 textarea + execCommand
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    const copied = document.execCommand("copy");
    return copied ? { ok: true } : { ok: false, reason: clipboardError ?? "exec-failed" };
  } catch (err) {
    logWarn("clipboard", "execCommand('copy') 失败", err);
    return { ok: false, reason: clipboardError ?? "exec-failed" };
  } finally {
    document.body.removeChild(ta);
  }
}
