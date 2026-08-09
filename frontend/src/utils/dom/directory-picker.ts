// ===== 跨平台目录选择器（ADR-046 P2）=====
// 桌面：Wails Dialog（CanChooseDirectories，官方支持）
// Android：Wails v3 官方明确拒绝目录选择（dialogs_android.go 报错，SAF 返回
//   content:// URI 而非文件系统路径，Go os.* 不可读；MikuMikuAR ADR-194 亦废弃 SAF）
//   → 改为「授权检查 → modalPrompt 输入绝对路径」（MANAGE_EXTERNAL_STORAGE
//   授权后 Go os.* 可直读任意路径）。
import { getApp } from "../../wails/app.ts";
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { getAndroidBridge } from "./android-bridge.ts";
import { modalPrompt } from "./dialogs/modal.ts";

/** 选择目录：桌面走系统对话框；Android 走授权检查 + 手动输入绝对路径 */
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

  // 已授权：手动输入绝对路径（MANAGE_EXTERNAL_STORAGE 授权后 os.* 可直读）
  const dir = await modalPrompt({
    title: t("settings.path.selectDir"),
    placeholder: t("settings.path.androidPathPlaceholder"),
    okText: t("common.confirm"),
  });
  return dir && dir.trim() ? dir.trim() : null;
}
