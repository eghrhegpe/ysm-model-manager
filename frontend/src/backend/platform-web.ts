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
// 仅消费统一谓词。resolveWebMode() 薄谓词保留于 platform.ts 供存量调用；本模块
// 暴露 isWebPlatform() 作为 web-only 语义的统一入口，19 处按需渐进迁移。

import { browserAdapter } from "./browser-adapter.ts";
import type { PlatformMode } from "./platform.ts";
import { resolveTier } from "./platform.ts";

export type { PlatformMode };

/**
 * 当前平台三态判定（同步）。Tier 0/1 复用 resolveWebMode 语义（tier 语义与 platform.ts 同源），
 * Tier 2 追加 Android 桥探测。
 */
export function resolvePlatformMode(): PlatformMode {
  // ADR-217 收敛：委托 platform.ts 的单一 resolveTier，消除 Tier 拼装重复
  return resolveTier();
}

/** Android 桌面专属/无意义 binding 黑名单（蓝本 = go-android-platform-guard.md）。原驻 capabilities.ts，P3 归位 backend 层 */
export const ANDROID_UNAVAILABLE: ReadonlySet<string> = new Set([
  "RevealInExplorer",
  "OpenFolder",
  "OpenInBrowser",
  "RestartApplication",
  "ListVersionInstances",
  "GetMinecraftPaths",
  "ValidateMinecraftDir",
  // Wails 窗口注入（Android 单窗口无此操作）
  "SetMainWindow",
  "SetApp",
  // 广场多窗口（Android 暂不支持）
  "NavigatePlazaWindow",
  "ClosePlazaWindow",
  "PlazaGoBack",
  "PlazaGoForward",
  "PlazaReload",
  "PlazaZoomIn",
  "PlazaZoomOut",
  "PlazaZoomReset",
  // 文件选择器（Android 有独立实现）
  "SelectDirectory",
  "SelectImportFile",
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

// ADR-217 环 B：isWebPlatform 已上移至 platform.ts 中性叶子（Tier 派生纯谓词），
// 本模块仅 re-export 保持 19 处消费方命名兼容，消除 workers→platform-web 反向环。
// 语义与 platform.ts 的 resolveWebMode() 等价（契约由 platform-parity.test.ts 钉死）。
export { isWebPlatform } from "./platform.ts";
