// ===== context-menu-shared.ts — 右键菜单共享原语（ADR-040 拆分 / ADR-185 迁入 features）=====
// 从 context-menu-handlers.ts 下沉的纯前端共享函数，供 handlers / file-handlers /
// dir-handlers 共用，破除循环依赖。通知原语（toast/toastError/toastEmptyRtype）
// 已下沉 utils/dom/toast.ts（跨层复用，ADR-185 下沉，ADR-189 D3 归位）。
// 依赖：bus / modalPrompt / getApp / RESOURCE_TYPES——均不引 handlers，本文件不在环内。

import { bus } from "../../bus.ts";
import { tr } from "../../core/i18n/tr.ts";
import { toast, toastError } from "../../utils/dom/toast.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { modalPrompt } from "../dialogs/modal-prompt.ts";
import { contextMenuGetApp } from "./context-menu-deps.ts";

/** 通知树组件和统计面板刷新 */
export function refreshUI(): void {
  bus.emit("tree:reload");
  bus.emit("stats:refresh");
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
export async function resolveDstDir(
  opts: {
    title: string;
    icon: string;
    okText: string;
    emptyMsg: string;
  },
  rtype?: string,
): Promise<{ folder: string; dstDir: string } | null> {
  const folder = await modalPrompt({
    title: opts.title,
    icon: opts.icon,
    placeholder: tr("ctx.dstPlaceholder", "Enter target folder name, e.g. [author]"),
    okText: opts.okText,
  });
  if (!folder) return null;
  if (isUnsafeFolderName(folder)) {
    toast(
      tr("ctx.unsafeFolderName", "❌ Folder name contains illegal characters"),
      TOAST_MS.normal,
      "error",
    );
    return null;
  }
  const { GetRepoRoot } = await contextMenuGetApp();
  const filesRoot = await GetRepoRoot(rtype || RESOURCE_TYPES.YSM);
  if (!filesRoot) {
    toast(opts.emptyMsg, TOAST_MS.normal, "error");
    return null;
  }
  return { folder, dstDir: `${filesRoot}/${folder.replace(/\\/g, "/")}` };
}

/**
 * 单目标 move|copy 模板（2026-09-06 锐评 P2 #5 收敛）：file.move/file.copy/dir.move/dir.copy
 * 四胞胎共用 resolveDstDir → getApp → binding → toast → refreshUI → catch 同构段，
 * 与 batch 侧 runBatchFileOp + BATCH_TPL 同一屋檐。调用方只给差异项：路径、rtype、
 * 绑定名、弹窗标题与成功文案（i18n key，本函数内 tr）。
 */
export async function runSingleOp(
  pathOf: string,
  rtype: string | undefined,
  binding: "MoveModelFile" | "CopyModelFile",
  mode: "move" | "copy",
  i18n: { dialogTitle: string; okMsg: string },
): Promise<void> {
  const isMove = mode === "move";
  try {
    const resolved = await resolveDstDir(
      {
        title: tr(i18n.dialogTitle, isMove ? "Move to Folder" : "Copy to Folder"),
        icon: isMove ? "📂" : "📋",
        okText: tr(isMove ? "ctx.moveDialogOk" : "ctx.copyDialogOk", isMove ? "Move" : "Copy"),
        emptyMsg: tr(
          isMove ? "ctx.emptyMoveRoot" : "ctx.emptyCopyRoot",
          isMove
            ? "❌ Configure a storage path first"
            : "❌ Configure a repository directory first",
        ),
      },
      rtype,
    );
    if (!resolved) return;
    const { folder, dstDir } = resolved;
    const app = await contextMenuGetApp();
    await app[binding](pathOf, dstDir);
    toast(
      tr(i18n.okMsg, isMove ? "✅ Moved to {folder}" : "✅ Copied to {folder}", { folder }),
      TOAST_MS.normal,
    );
    refreshUI();
  } catch (e) {
    toastError(
      e,
      tr(isMove ? "ctx.moveFail" : "ctx.copyFail", isMove ? "Move failed" : "Copy failed"),
    );
  }
}
