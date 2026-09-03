// ===== context-menu-shared.ts — 右键菜单共享原语（ADR-040 拆分）=====
// 从 context-menu-handlers.ts 下沉的纯前端共享函数，供 handlers / file-handlers /
// dir-handlers 共用，破除 `handlers ↔ {file,dir}-handlers` 循环依赖
// （file/dir 动态 import handlers 的 resolveDstDir 会成环，迁入本叶子模块后破环）。
// 依赖：bus / modalPrompt / getApp / RESOURCE_TYPES——均不引 handlers，本文件不在环内。
import { bus, type ToastPayload } from "../bus.ts";
import { modalPrompt } from "../features/dialogs/modal.ts";
import { getApp } from "../backend/app.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { t } from "./i18n/t.ts";
import { tr } from "./i18n/tr.ts";

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

/** 错误 toast（`❌ ${friendlyError(e)}` 模板收敛——instance-ops / settings/init 等 catch 块共用）。
 *  @param err       错误对象
 *  @param fallback  friendlyError 未匹配时的回退文案（仅错误无中文时生效）
 *  @param prefix    操作名前缀（如 "统计失败"），拼在 friendlyError 前：`❌ ${prefix}: ${msg}` */
export function toastError(err: unknown, fallback?: string, prefix?: string): void {
  toast(prefix ? `❌ ${prefix}: ${friendlyError(err, fallback)}` : `❌ ${friendlyError(err, fallback)}`, TOAST_MS.long, "error");
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
    placeholder: tr("ctx.dstPlaceholder", "Enter target folder name, e.g. [author]"),
    okText: opts.okText,
  });
  if (!folder) return null;
  if (isUnsafeFolderName(folder)) {
    bus.emit("toast:show", {
      msg: tr("ctx.unsafeFolderName", "❌ Folder name contains illegal characters"),
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