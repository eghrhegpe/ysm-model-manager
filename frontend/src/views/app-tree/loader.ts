// ===== Go 数据加载层 =====

import { getApp } from "../../backend/app.ts";
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { getAndroidBridge } from "../../utils/dom/android-bridge.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";

/** 树条目（loader 转换后的渲染格式） */
export interface TreeEntry {
  name: string;
  path: string;
  fullPath: string;
  size: number;
  modTime: number;
  banned: boolean;
  type: string;
  /** 标签标记（row-tpl 用到，Go 端可选） */
  HasTags?: boolean;
}

/** 加载失败 toast 节流：自动重载（stats:refresh/tree:reload）可能高频触发，防刷屏 */
let _lastErrorToastAt = 0;
const ERROR_TOAST_MIN_GAP = 5000; // 5s 内只提示一次

function toastLoadError(err: unknown): void {
  const now = Date.now();
  if (now - _lastErrorToastAt < ERROR_TOAST_MIN_GAP) return;
  _lastErrorToastAt = now;
  bus.emit("toast:show", {
    msg: "❌ " + t("tree.loadFailed") + ": " + friendlyError(err, t("tree.repoLoadFailed")),
    duration: TOAST_MS.long,
    type: "error",
  });
}

// ---- Android 存储授权引导（ADR-046 P2）----
// Java 桥（WailsJSBridge 以 "wails" 名注册，MainActivity addJavascriptInterface）
// 暴露 hasStoragePermission / requestStoragePermission；桌面端无此桥。
// 库加载失败且未授权（MANAGE_EXTERNAL_STORAGE）时，引导用户开启"所有文件访问"。
// 桥访问复用 utils/dom/android-bridge.ts（与 directory-picker 共享，避免重复实现）。

/** 节流：自动重载可能高频触发，5s 内只引导一次 */
let _lastStoragePromptAt = 0;
const STORAGE_PROMPT_MIN_GAP = 5000;

function maybePromptAndroidStorage(): void {
  const bridge = getAndroidBridge();
  if (!bridge) return; // 桌面端无此桥
  if (bridge.hasStoragePermission?.()) return; // 已授权
  const now = Date.now();
  if (now - _lastStoragePromptAt < STORAGE_PROMPT_MIN_GAP) return;
  _lastStoragePromptAt = now;
  bus.emit("toast:show", {
    msg: t("settings.path.needStoragePermission"),
    duration: TOAST_MS.verbose,
    type: "warn",
  });
  bridge.requestStoragePermission?.();
}

/** 从 Go 后端加载仓库文件列表，返回格式化的 entries
 *  @param rtype 资源类型 ID（如 "ysm"/"EntityPlayer"）
 *  @param subdir 可选：覆盖类型 ID（如 "SceneModel"/"CustomAnim"），
 *  扁平化架构下每个 MMD 子类型为独立顶级类型，直接用 subdir 作为类型 ID 查表
 */
export async function loadEntries(
  rtype: string,
  subdir?: string,
): Promise<{ filesRoot: string; entries: TreeEntry[] }> {
  try {
    const { GetRepoRoot, ScanModelEntriesFiltered } = await getApp();
    // 扁平化架构：subdir 作为实际类型 ID 覆盖 rtype
    const targetType = subdir || rtype;
    const filesRoot = await GetRepoRoot(targetType || "");
    if (!filesRoot) return { filesRoot: "", entries: [] };

    const label = RESOURCE_TYPE_LABELS[targetType] || targetType;
    const raw = await ScanModelEntriesFiltered(filesRoot, targetType, "", label);
    if (!raw || !raw.length) return { filesRoot, entries: [] };

    // 禁用态由 Go 扫描结果直接下发（e.Banned，ADR-038 D3.7 判定归 Go）——
    // 原逐文件 IsFileBanned 桥调用为 N+1 IPC（2000 模型 = 2000 次，code review #2）。

    const entries: TreeEntry[] = raw.map((e) => {
      let relPath = e.Path;
      const normRoot = filesRoot ? filesRoot.replace(/\\/g, "/").replace(/\/+$/, "") : "";
      const normPath = e.Path.replace(/\\/g, "/");
      if (normRoot && (normPath.startsWith(normRoot + "/") || normPath === normRoot)) {
        relPath = normPath.slice(normRoot.length).replace(/^[/\\]+/, "");
      }
      return {
        name: e.Name,
        path: relPath,
        fullPath: e.Path,
        size: e.Size,
        modTime: e.ModTime,
        banned: e.banned || false,
        type: e.type || "",
      };
    });
    return { filesRoot, entries };
  } catch (err) {
    // 失败不静默：自动重载场景用户看不到报错，明确 toast 提示（带节流防刷屏）
    toastLoadError(err);
    // Android 未授权时引导开启"所有文件访问"（Java 弹窗跳设置页）
    maybePromptAndroidStorage();
    return { filesRoot: "", entries: [] };
  }
}
