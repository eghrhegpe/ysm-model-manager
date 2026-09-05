import { dbg } from "./utils/debug/debug.ts";

/** Wait until the DOM has been upgraded and painted before exposing the native window. */
export async function revealMainWindow(
  show: () => void | Promise<void>,
  nextFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
): Promise<void> {
  if (document.readyState === "loading") {
    await new Promise<void>((resolve) => {
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
  }

  // rAF 等待竞速超时（code review P2）：隐藏窗口下 Chromium/WebView2 节流 rAF，
  // 两帧永不完成 → 窗口永久不可见；1.5s 超时仍强制 app-ready + show() 兜底
  const twoFrames = new Promise<void>((resolve) => {
    let remaining = 2;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
    };
    nextFrame(done);
    nextFrame(done);
  });
  const revealTimeout = new Promise<void>((resolve) => {
    setTimeout(resolve, 1500);
  });
  await Promise.race([twoFrames, revealTimeout]);
  document.documentElement.classList.add("app-ready");

  try {
    await show();
  } catch (error) {
    // Browser development mode has no native Wails window; the CSS reveal above is enough.
    dbg("startup-reveal", "native window show unavailable", error);
  }
}
