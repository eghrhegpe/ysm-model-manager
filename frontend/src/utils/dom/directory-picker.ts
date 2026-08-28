// ===== 跨平台目录选择器（ADR-046 P2）=====
// 桌面：Wails Dialog（CanChooseDirectories，官方支持）
// Android：Wails v3 官方明确拒绝目录选择（dialogs_android.go 报错，SAF 返回
//   content:// URI 而非文件系统路径，Go os.* 不可读；MikuMikuAR ADR-194 亦废弃 SAF）
//   → 改为「授权检查 → 自动定位公共仓库目录」（查看器模式：固定路径
//   /storage/emulated/0/YSM-Model-Manager，授权 MANAGE_EXTERNAL_STORAGE 后 Go os.*
//   直读，用户把模型放入该目录即可使用，无需选择器）。
import { TOAST_MS } from ".//toast-ms.ts";
import { getApp } from "../../backend/app.ts";
import { isWebPlatform } from "../../backend/platform-web.ts";
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { getAndroidBridge, isViewerMode } from "./android-bridge.ts";

/**
 * Android 共享仓库目录解析（双端桥接：授权引导 + 定位公共目录）。
 * Android 目录选择不可用（Wails v3 dialogs_android.go 拒绝，SAF 亦废弃），
 * 本函数是「需要目录路径」场景的查看器模式统一入口——设置页路径卡片
 * （pickDirectory）、树「打开/导入文件夹」（toolbar-events）、资源管理器
 * （app-resource-manager）均复用：
 * - Android：未授权 → warn toast + requestStoragePermission（Java 桥 → 系统授权页），返回 null；
 * - 网页版（ADR-049 Phase 3）：无授权概念 → 直接定位虚拟根 /web（浏览器本地存储），返回路径；
 * - 已授权/已定位：GetDefaultRepoRoot 返回路径 + info toast。
 * 桌面端（非查看器模式）返回 null（调用方自行走 Wails Dialog）。
 */
export async function resolveAndroidRepoDir(): Promise<string | null> {
  const bridge = getAndroidBridge();
  if (!bridge) {
    // 网页版：无授权概念，直接定位虚拟根（browser adapter 的 GetDefaultRepoRoot → /web）
    if (isWebPlatform()) {
      const { GetDefaultRepoRoot } = await getApp();
      const dir = await GetDefaultRepoRoot();
      if (!dir) return null;
      bus.emit("toast:show", {
        msg: t("settings.path.autoRepoRoot") + " " + dir,
        duration: TOAST_MS.verbose,
        type: "info",
      });
      return dir;
    }
    return null; // 桌面：由调用方走 Wails Dialog
  }
  // 未授权：先检查「所有文件访问」授权
  if (!bridge.hasStoragePermission?.()) {
    bus.emit("toast:show", {
      msg: t("settings.path.needStoragePermission"),
      duration: TOAST_MS.verbose,
      type: "warn",
    });
    bridge.requestStoragePermission?.();
    return null;
  }
  // 已授权：自动定位公共仓库目录（固定路径，查看器模式）
  const { GetDefaultRepoRoot } = await getApp();
  const dir = await GetDefaultRepoRoot();
  if (!dir) return null;
  bus.emit("toast:show", {
    msg: t("settings.path.autoRepoRoot") + " " + dir,
    duration: TOAST_MS.verbose,
    type: "info",
  });
  return dir;
}

/** 选择目录：桌面走系统对话框；查看器模式（Android/网页版）走授权检查 + 自动定位公共目录 */
export async function pickDirectory(): Promise<string | null> {
  // 统一门控入口（ADR-049 Phase 3）：Android 或网页版均走 resolveAndroidRepoDir——
  // 网页版其内部定位虚拟根 /web（browser adapter 的 GetDefaultRepoRoot），
  // 而非调用桌面专属 SelectDirectory（browser adapter 未实现，fail-fast 抛
  // WebUnsupportedError，违反「各按钮守卫统一用 isViewerMode」约定）。
  if (isViewerMode()) return resolveAndroidRepoDir();
  // 桌面：Wails Dialog
  const { SelectDirectory } = await getApp();
  return SelectDirectory();
}
