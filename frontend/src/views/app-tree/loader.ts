// ===== Go 数据加载层 =====
import { t } from "../../core/i18n/t.ts";
import { getExts } from "../../utils/resource/extensions.ts";
import { RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import { getApp } from "../../wails/app.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { getAndroidBridge } from "../../utils/dom/android-bridge.ts";

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
    duration: 5000,
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
    msg: "需要「所有文件访问」权限才能读取模型库，正在引导授权…",
    duration: 4000,
    type: "warn",
  });
  bridge.requestStoragePermission?.();
}

/** 从 Go 后端加载仓库文件列表，返回格式化的 entries */
export async function loadEntries(
  rtype: string,
): Promise<{ repoRoot: string; entries: TreeEntry[] }> {
  try {
    const { GetRepoRoot, ScanModelEntriesWithLabel, IsFileBanned } = await getApp();
    const repoRoot = await GetRepoRoot(rtype || "");
    if (!repoRoot) return { repoRoot: "", entries: [] };

    const raw = await ScanModelEntriesWithLabel(repoRoot, RESOURCE_TYPE_LABELS[rtype] || rtype);
    if (!raw || !raw.length) return { repoRoot, entries: [] };

    // 按类型过滤扩展名（防止共享仓库中混入其他类型的文件）
    const exts = getExts(rtype);
    const filtered = exts.length
      ? raw.filter((e) => {
          let name = e.Name.toLowerCase();
          // 去掉 .ban 后缀再判断
          name = name.replace(/\.ban$/, "");
          return exts.some((ext) => name.endsWith(ext));
        })
      : raw;

    // 并发检查禁用状态
    const bannedResults = await Promise.all(
      filtered.map((e) => IsFileBanned(e.Path).catch(() => false)),
    );

    const entries: TreeEntry[] = filtered.map((e, i) => {
      let relPath = e.Path;
      const normRoot = repoRoot ? repoRoot.replace(/\\/g, "/") : "";
      const normPath = e.Path.replace(/\\/g, "/");
      if (normRoot && normPath.startsWith(normRoot)) {
        relPath = normPath.slice(normRoot.length).replace(/^[/\\]+/, "");
      }
      return {
        name: e.Name,
        path: relPath,
        fullPath: e.Path,
        size: e.Size,
        modTime: e.ModTime,
        banned: bannedResults[i] || false,
        type: "",
      };
    });
    return { repoRoot, entries };
  } catch (err) {
    // 失败不静默：自动重载场景用户看不到报错，明确 toast 提示（带节流防刷屏）
    toastLoadError(err);
    // Android 未授权时引导开启"所有文件访问"（Java 弹窗跳设置页）
    maybePromptAndroidStorage();
    return { repoRoot: "", entries: [] };
  }
}
