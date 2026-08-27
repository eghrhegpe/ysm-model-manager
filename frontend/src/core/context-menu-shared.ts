// ===== context-menu-shared.ts — 右键菜单共享原语（ADR-040 拆分）=====
// 从 context-menu-handlers.ts 下沉的纯前端共享函数，供 handlers / file-handlers /
// dir-handlers 共用，破除 `handlers ↔ {file,dir}-handlers` 循环依赖
// （file/dir 动态 import handlers 的 resolveDstDir 会成环，迁入本叶子模块后破环）。
// 依赖：bus / modalPrompt / getApp / RESOURCE_TYPES——均不引 handlers，本文件不在环内。
import { bus, type ToastPayload } from "../bus.ts";
import { modalPrompt } from "../utils/dom/dialogs/modal.ts";
import { getApp } from "../backend/app.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { t } from "./i18n/t.ts";

type ToastType = NonNullable<ToastPayload["type"]>;

/** 通知树组件和统计面板刷新 */
export function refreshUI(): void {
  bus.emit("tree:reload");
  bus.emit("stats:refresh");
}

/** 显示 toast 通知 */
export function toast(msg: string, duration: number = TOAST_MS.normal, type: ToastType = "success"): void {
  bus.emit("toast:show", { msg, duration, type });
}

/** rtype 契约缺失守卫 toast（context-menu / instance-ops / app-sidebar 7 处重复，抽一行收口） */
export function toastEmptyRtype(): void {
  toast(t("ctx.emptyRtype"), TOAST_MS.normal, "error");
}

/** 路径安全过滤：禁止逃逸段（. / ..）与绝对路径 */
export function isUnsafeFolderName(folder: string): boolean {
  const trimmed = folder.trim();
  if (!trimmed) return true;
  if (/^[/\\]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed)) return true;
  return trimmed.split(/[/\\]/).some((seg) => seg === "." || seg === "..");
}

/**
 * 解析「移动/复制到文件夹」的目标路径（batch.move / batch.copy / file.move / file.copy 共用）。
 * 用户取消或校验失败时返回 null（已 toast 告知）。
 * @param rtype 资源类型 ID（如 "ysm"/"EntityPlayer"），为空时回退 YSM。
 */
export async function resolveDstDir(opts: {
  title: string;
  icon: string;
  okText: string;
  emptyMsg: string;
}, rtype?: string): Promise<{ folder: string; dstDir: string } | null> {
  const folder = await modalPrompt({
    title: opts.title,
    icon: opts.icon,
    placeholder: "输入目标文件夹名，如 [作者名]",
    okText: opts.okText,
  });
  if (!folder) return null;
  if (isUnsafeFolderName(folder)) {
    bus.emit("toast:show", {
      msg: "❌ 文件夹名包含非法字符",
      duration: TOAST_MS.normal,
      type: "error",
    });
    return null;
  }
  const { GetRepoRoot } = await getApp();
  const filesRoot = await GetRepoRoot(rtype || RESOURCE_TYPES.YSM);
  if (!filesRoot) {
    bus.emit("toast:show", {
      msg: opts.emptyMsg,
      duration: TOAST_MS.normal,
      type: "error",
    });
    return null;
  }
  return { folder, dstDir: filesRoot + "/" + folder.replace(/\\/g, "/") };
}