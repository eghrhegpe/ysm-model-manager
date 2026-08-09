// ===== 跨平台目录选择器（ADR-046 P2）=====
// 桌面：Wails Dialog（CanChooseDirectories，官方支持）
// Android：Wails v3 官方明确拒绝目录选择（dialogs_android.go 报错，SAF 返回
//   content:// URI 而非文件系统路径，Go os.* 不可读；MikuMikuAR ADR-194 亦废弃 SAF）
//   → 改为「授权检查 → 自动定位公共仓库目录」（查看器模式：固定路径
//   /storage/emulated/0/YSM-Model-Manager，授权 MANAGE_EXTERNAL_STORAGE 后 Go os.*
//   直读，用户把模型放入该目录即可使用，无需选择器）。
import { getApp } from "../../wails/app.ts";
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { getAndroidBridge } from "./android-bridge.ts";

/** 选择目录：桌面走系统对话框；Android 走授权检查 + 自动定位公共目录 */
export async function pickDirectory(): Promise<string | null> {
  const bridge = getAndroidBridge();
  if (!bridge) {
    // 桌面：Wails Dialog
    const { SelectDirectory } = await getApp();
    return SelectDirectory();
  }

  // Android：先检查「所有文件访问」授权
  if (!bridge.hasStoragePermission?.()) {
    bus.emit("toast:show", {
      msg: t("settings.path.needStoragePermission"),
      duration: 4000,
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
    duration: 4000,
    type: "info",
  });
  return dir;
}
