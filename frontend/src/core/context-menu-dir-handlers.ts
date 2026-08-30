// ===== context-menu-dir-handlers.ts — dir 类右键菜单 handler（从 context-menu-handlers.ts 拆出，ADR-040 P1）=====
import { bus } from "../bus.ts";
import { getApp } from "../backend/app.ts";
import { tr } from "./i18n/tr.ts";
import { refreshUI, toast, toastError, resolveDstDir } from "./context-menu-shared.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import type { MenuCtx } from "./context-menu-handlers.ts";

/** dir 类 handler 子表 */
export const DIR_HANDLERS: Record<string, (ctx: MenuCtx) => void> = {
  "dir.rename": (ctx) => bus.emit("dir:rename", { dir: ctx.dir || "" }),
  "dir.batch-rename": (ctx) =>
    bus.emit("dir:batch-rename", { dir: ctx.dir || "" }),
  "dir.move": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: tr("ctx.dirMoveDialogTitle", "Move Folder To"),
        icon: "📂",
        okText: tr("ctx.moveDialogOk", "Move"),
        emptyMsg: tr("ctx.emptyMoveRoot", "❌ Configure a storage path first"),
      }, ctx.rtype);
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { MoveModelFile } = await getApp();
      await MoveModelFile(ctx.dir || "", dstDir);
      toast(tr("ctx.dirMoveOk", "✅ Moved folder to {folder}", { folder }), TOAST_MS.normal);
      refreshUI();
    } catch (e) {
      toastError(e, tr("ctx.moveFail", "Move failed"));
    }
  },
  "dir.copy": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: tr("ctx.dirCopyDialogTitle", "Copy Folder To"),
        icon: "📋",
        okText: tr("ctx.copyDialogOk", "Copy"),
        emptyMsg: tr("ctx.emptyCopyRoot", "❌ Configure a repository directory first"),
      }, ctx.rtype);
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { CopyModelFile } = await getApp();
      await CopyModelFile(ctx.dir || "", dstDir);
      toast(tr("ctx.dirCopyOk", "✅ Copied folder to {folder}", { folder }), TOAST_MS.normal);
      refreshUI();
    } catch (e) {
      toastError(e, tr("ctx.copyFail", "Copy failed"));
    }
  },
  "dir.mkdir": (ctx) => bus.emit("dir:mkdir", { dir: ctx.dir || "" }),
  "dir.recycle": (ctx) => bus.emit("dir:recycle", { dir: ctx.dir || "" }),
};
