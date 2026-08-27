// ===== 跨平台模式统一判定（ADR-123 P3）=====
// 三态（desktop / web / android）单一事实源 + 能力矩阵。收敛原散落三处的信号拼装：
//   - capabilities.ts：桌面恒 true / web 查 adapter has / Android 查黑名单 的三路 if
//   - android-bridge.isViewerMode()：readDeclaredBackend + getAndroidBridge + resolveWebMode 自行组合
// 平台信号源优先级与 platform.ts 一致：
//   Tier 0 入口声明 __YSM_BACKEND__（权威）> Tier 1 构建模式 MODE=web > Tier 2 同步
//   探测 window.wails。Tier 2 为同步判定，Android 冷启动桥未注入时可能误判 desktop——
//   仅用于运行时 UI 降级，启动期 backend 选型由 app.ts 缓存链路另行保证
//   （MikuMikuAR ADR-176 P1 竞态教训，awaitWailsBridge 异步化待真需要时再引入）。
//
// 范围边界（ADR-122 教训：针对性修复非全量重写）：本模块只收「是什么平台 / 该能力
// 是否可用」的判定；各功能的 web 降级动作（下载入库、导入、toast 早退）留在原地，
// 仅消费统一谓词。resolveWebMode() 继续作为 web 单态薄谓词供既有调用方使用，
// 不做 19 文件全量换皮。
import { readDeclaredBackend, isWebEntryMode, getAndroidBridge } from "./platform.ts";
import { browserAdapter } from "./browser-adapter.ts";

export type PlatformMode = "desktop" | "web" | "android";

/**
 * 当前平台三态判定（同步）。
 * Tier 0 声明 'browser' 恒 web；声明 'go' 恒 desktop（即使 WebView 内残留 wails 桥）。
 */
export function resolvePlatformMode(): PlatformMode {
  const declared = readDeclaredBackend();
  if (declared !== undefined) return declared === "browser" ? "web" : "desktop";
  if (isWebEntryMode()) return "web";
  // Tier 2（未实现 await 异步探测）：仅认 Android Java 桥的存在性
  return getAndroidBridge() !== null ? "android" : "desktop";
}

/** Android 桌面专属/无意义 binding 黑名单（蓝本 = go-android-platform-guard.md）。原驻 capabilities.ts，P3 归位 backend 层 */
export const ANDROID_UNAVAILABLE: ReadonlySet<string> = new Set([
  "RevealInExplorer",
  "OpenFolder",
  "RestartApplication",
  "ListVersionInstances",
]);

/**
 * 能力矩阵（对齐 MikuMikuAR ADR-176 capabilities 矩阵范式）：
 *   desktop — Go 桥全量可用；web — adapter has 探测（未实现 = false → UI 隐藏，
 *   防「幽灵入口」）；android — Go binding 全量可达，仅黑名单四项排除。
 * can()（capabilities.ts）消费本矩阵，是唯一的门控对外入口。
 */
export function canBinding(binding: string): boolean {
  switch (resolvePlatformMode()) {
    case "web":
      return binding in browserAdapter;
    case "android":
      return !ANDROID_UNAVAILABLE.has(binding);
    default:
      return true;
  }
}

/**
 * 查看器平台谓词 = 非桌面（web ∪ android）。parity 契约②的规范实现：
 * `isViewerPlatform() === (resolvePlatformMode() !== "desktop")`（契约由
 * platform-parity.test.ts 钉死）。android-bridge.isViewerMode 委托本函数，
 * 不再自行拼装信号（消除「第四处拼装点」）。
 */
export function isViewerPlatform(): boolean {
  return resolvePlatformMode() !== "desktop";
}
