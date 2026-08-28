// ===== 平台环境判定（ADR-049 Phase 1，参考 MikuMikuAR ADR-176/177 Tier 分层）=====
// 判定网页版（无 Wails 壳的纯浏览器）以路由到 browser adapter。
//
// 本文件是平台判定原语的叶子模块：Tier 0/1 信号读取 + Tier 2 wails 桥存在性探测
// （ADR-123 P3 审核补强——探测原语原驻 utils/dom/android-bridge.ts，造成
// 「platform-web 想收编 isViewerMode 却与其成环」的放置问题；原语下沉后判定链
// 单向化：android-bridge → platform-web → platform）。
//
// Tier 0：入口 HTML 显式声明 globalThis.__YSM_BACKEND__（'go' | 'browser'）——权威信号。
//          web.html 置 'browser' 后即便误嵌进 WebView 也强制走 browserAdapter，
//          消除「网页构建参杂 Go 逻辑」误判；桌面/Android 构建不声明（走 Tier 2）。
// Tier 1：旧 web 短路标记 __YSM_WEB__ === true 或 import.meta.env.MODE === 'web'。
// Tier 2：运行时探测 window.go（Wails 桌面）或 window.wails（Android 桥）——纯浏览器
//          两者都不存在。Phase 1 用同步判定（Tier 0/1 足够）；awaitWailsBridge 的
//          冷启动等待（桌面 WebView2 注入竞态）留到 Phase 3 引入。

/** Android Java 桥最小形状（MainActivity addJavascriptInterface 注册名 "wails"；桌面端无此桥） */
export interface WailsAndroidBridge {
  hasStoragePermission?: () => boolean;
  requestStoragePermission?: () => void;
}

/** Tier 2 原语：返回 Android Java 桥（桌面端为 null），类型安全断言（无 as any） */
export function getAndroidBridge(): WailsAndroidBridge | null {
  const w = (window as unknown as { wails?: WailsAndroidBridge }).wails;
  return w && typeof w.requestStoragePermission === "function" ? w : null;
}

/** 读取入口 HTML 声明的适配器身份（'go' | 'browser'），未声明返回 undefined */
export function readDeclaredBackend(): "go" | "browser" | undefined {
  const v = (globalThis as Record<string, unknown>)["__YSM_BACKEND__"];
  return v === "go" || v === "browser" ? v : undefined;
}

/** Tier 1：旧 web 短路标记 / vite MODE=web 构建 */
export function isWebEntryMode(): boolean {
  if ((globalThis as Record<string, unknown>)["__YSM_WEB__"] === true) return true;
  // ⚠️ 必须直接写 `import.meta.env.MODE`（无中间变量/可选链）：vite 的 define 是
  // 文本替换，`meta.env?.MODE` 编译后变成 `(t=import.meta.env)==null?void 0:t.MODE`，
  // 匹配不到 `import.meta.env.MODE` 原文 → mode:"web" 构建不生效（实测 2026-08）
  return import.meta.env.MODE === "web";
}

/** 同步判定：当前是否应路由到 browser adapter（网页版）——薄委派，复用三态源（tier 语义由 platform-web 统一承载） */
export function resolveWebMode(): boolean {
  // 复用 Tier 0/1 语义：`mode === "web"` 与此谓词由 platform-parity 契约钉等价
  // 避免在两个文件中各自拼装 `readDeclaredBackend()/isWebEntryMode()` 双实现漂移
  // 不可直接 import platform-web（会成环：platform-web → platform），保留直读原语
  const declared = readDeclaredBackend();
  if (declared !== undefined) return declared === "browser";
  return isWebEntryMode();
}
