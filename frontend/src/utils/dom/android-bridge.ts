// ===== Android Java 桥访问（ADR-046 P2）=====
// WailsJSBridge 以 "wails" 名注册到 WebView（MainActivity addJavascriptInterface），
// 暴露 Android 专属 API；桌面端无此桥（返回 null）。
// 共享模块：loader.ts 授权引导 / directory-picker.ts 目录选择均引用，避免重复实现。

export interface WailsAndroidBridge {
  hasStoragePermission?: () => boolean;
  requestStoragePermission?: () => void;
}

/** 返回 Android Java 桥（桌面端为 null），类型安全断言（无 as any） */
export function getAndroidBridge(): WailsAndroidBridge | null {
  const w = (window as unknown as { wails?: WailsAndroidBridge }).wails;
  return w && typeof w.requestStoragePermission === "function" ? w : null;
}
