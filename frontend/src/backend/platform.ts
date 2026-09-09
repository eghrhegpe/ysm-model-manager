// ===== 平台环境判定（ADR-049 Phase 1，参考 MikuMikuAR ADR-176/177 Tier 分层）=====
// 判定网页版（无 Wails 壳的纯浏览器）以路由到 browser adapter。
//
// 本文件是平台判定原语的叶子模块：Tier 0/1 信号读取 + Tier 2 wails 桥存在性探测
// + Android 返回键栈。
//
// Tier 0：入口 HTML 显式声明 globalThis.__YSM_BACKEND__（'go' | 'browser'）——权威信号。
//          浏览器构建置 'browser' 后即便误嵌进 WebView 也强制走 browserAdapter，
//          消除「网页构建参杂 Go 逻辑」误判；桌面/Android 构建不声明（走 Tier 2）。
// Tier 1：旧 web 短路标记 __YSM_WEB__ === true 或 import.meta.env.MODE === 'web'。
// Tier 2：运行时探测 window.go（Wails 桌面）或 window.wails（Android 桥）——纯浏览器
//          两者都不存在。Phase 1 用同步判定（Tier 0/1 足够）；awaitWailsBridge 的
//          冷启动等待（桌面 WebView2 注入竞态）留到 Phase 3 引入。
//
// ADR-203 D2（2026-09-07）：原 utils/dom/android-bridge.ts 的 re-export shim +
// isViewerMode/registerAndroidBackHandler/emitAndroidBack 合并入本文件，
// 消除 utils/dom → backend 反向依赖。

/** Android Java 桥最小形状（MainActivity addJavascriptInterface 注册名 "wails"；桌面端无此桥） */
export interface WailsAndroidBridge {
  hasStoragePermission?: () => boolean;
  requestStoragePermission?: () => void;
}

/** Tier 2 原语：返回 Android Java 桥（桌面端为 null），类型安全断言（无 as any） */
export function getAndroidBridge(): WailsAndroidBridge | null {
  if (typeof window === "undefined") return null; // node/SSR 无 window（纯逻辑模块 / 测试桩），先行守卫，对齐 vitest.config.ts 护栏约定
  const w = (window as unknown as { wails?: WailsAndroidBridge }).wails;
  return w && typeof w.requestStoragePermission === "function" ? w : null;
}

/** 读取入口 HTML 声明的适配器身份（'go' | 'browser'），未声明返回 undefined */
export function readDeclaredBackend(): "go" | "browser" | undefined {
  const v = (globalThis as Record<string, unknown>).__YSM_BACKEND__;
  return v === "go" || v === "browser" ? v : undefined;
}

/** Tier 1：旧 web 短路标记 / vite MODE=web 构建 */
export function isWebEntryMode(): boolean {
  if ((globalThis as Record<string, unknown>).__YSM_WEB__ === true) return true;
  // ⚠️ 必须直接写 `import.meta.env.MODE`（无中间变量/可选链）：vite 的 define 是
  // 文本替换，`meta.env?.MODE` 编译后变成 `(t=import.meta.env)==null?void 0:t.MODE`，
  // 匹配不到 `import.meta.env.MODE` 原文 → mode:"web" 构建不生效（实测 2026-08）
  return import.meta.env.MODE === "web";
}

/** 平台三态（与 platform-web.ts 的 PlatformMode 同源；类型定义在叶子层避免环） */
export type PlatformMode = "desktop" | "web" | "android";

/**
 * 平台 Tier 单一组合（ADR-217 收敛）：Tier 0 入口声明 > Tier 1 构建模式 > Tier 2 Android 桥探测。
 * 所有平台谓词（resolveWebMode / isViewerPlatform / resolvePlatformMode）均从此派生，
 * 消除三处重复拼装（原由 platform-parity 对拍守护双源漂移）。
 */
export function resolveTier(): PlatformMode {
  const declared = readDeclaredBackend();
  if (declared === "browser") return "web";
  if (declared === "go") return "desktop";
  if (isWebEntryMode()) return "web";
  return getAndroidBridge() !== null ? "android" : "desktop";
}

/** 同步判定：当前是否应路由到 browser adapter（网页版）——委托 resolveTier */
export function resolveWebMode(): boolean {
  return resolveTier() === "web";
}

/**
 * 网页版谓词 = 仅 web（非 Android）。与 resolveWebMode 同源（均 = resolveTier() === "web"），
 * 作为 19 处 web-only 分支的统一入口（ADR-217 环 B：上移中性叶子，断 workers→platform-web 反向环）。
 */
export function isWebPlatform(): boolean {
  return resolveTier() === "web";
}

// ── Android 桥与返回键（ADR-203 D2：从 utils/dom/android-bridge.ts 合并入此）──

/**
 * 查看器模式判定（ADR-049 Phase 3）：
 * Android（双端桥存在）或网页版（browser adapter）——均无本地文件系统写能力、
 * 无桌面专属 UI。各按钮/功能守卫统一用本函数，禁止各自拼 getAndroidBridge()/resolveWebMode()。
 * code_review 6efe049e9 #2/#3/#5/#6：本实现即唯一事实源（platform.ts 为叶子，
 * 不能反向 import platform-web）——platform-web 原 isViewerPlatform 副本已删，
 * parity 契约②由 platform-parity.test.ts 与本文件对拍守护（语义 =
 * platform-web 原 resolvePlatformMode() !== "desktop"）。
 */
export function isViewerPlatform(): boolean {
  // 委托 resolveTier（ADR-217 收敛）：viewer = web ∪ android
  const t = resolveTier();
  return t === "web" || t === "android";
}

/** 别名：保持既有消费方命名兼容 */
export const isViewerMode = isViewerPlatform;

/**
 * 安卓系统返回键处理器注册表（ADR-057 §2.5，对齐 MikuMikuAR handleAndroidBack）。
 * 栈顶优先：android-events.ts 收到 MainActivity 的 android:back 事件后调用
 * emitAndroidBack()，从栈顶向下询问已注册处理器；返回 true 表示已消费
 * （如 3D overlay 打开时关层），否则透传上层。
 */
type AndroidBackHandler = () => boolean | undefined;
const _androidBackHandlers: AndroidBackHandler[] = [];

/** 注册安卓返回键处理器，返回取消函数（供调用方在自身销毁/关闭时注销）。 */
export function registerAndroidBackHandler(fn: AndroidBackHandler): () => void {
  _androidBackHandlers.push(fn);
  return (): void => {
    const i = _androidBackHandlers.indexOf(fn);
    if (i > -1) _androidBackHandlers.splice(i, 1);
  };
}

/**
 * 系统返回键的前端触发入口：依次从栈顶触发已注册处理器。
 * 当前由 android-events.ts 在收到 MainActivity 的 android:back 事件时调用；
 * 返回 true 表示已被消费（阻止原生默认返回/退出）。
 */
export function emitAndroidBack(): boolean {
  for (let i = _androidBackHandlers.length - 1; i >= 0; i--) {
    if (_androidBackHandlers[i]() === true) return true;
  }
  return false;
}
