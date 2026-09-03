// ===== context-menu-file-handlers.ts — file 类右键菜单 handler（从 context-menu-handlers.ts 拆出，ADR-040 P1）=====
import { getApp } from "../backend/app.ts";
import { modalConfirm, modalSelect } from "../utils/dom/dialogs/modal.ts";
import { showRenameDialog } from "../utils/dom/dialogs/rename.ts";
import { modalTagEditor } from "../utils/dom/dialogs/tag-editor.ts";
import { tr } from "./i18n/tr.ts";
import { refreshUI, toast, toastError, resolveDstDir } from "./context-menu-shared.ts";
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { copyText } from "../utils/dom/clipboard.ts";
import type { MenuCtx } from "./context-menu-handlers.ts";

/** file 类 handler 子表 */
export const FILE_HANDLERS: Record<string, (ctx: MenuCtx) => void> = {
  "file.rename": async (ctx) => {
    try {
      const fileName = (ctx.path || "").split(/[/\\]/).pop() || "";
      if (fileName.toLowerCase() === "ysm.json") {
        toast(tr("ctx.renameYsmJson", "ysm.json is the model directory manifest — right-click its folder and choose 'Rename'"),
          4000,
          "warn",
        );
        return;
      }
      const newName = await showRenameDialog(ctx.path || "", fileName);
      if (!newName) return;
      const { RenameFile } = await getApp();
      await RenameFile(ctx.path || "", newName);
      refreshUI();
    } catch (e) {
      toastError(e, tr("ctx.renameFail", "Rename failed"));
    }
  },
  "file.move": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: tr("ctx.moveDialogTitle", "Move to Folder"),
        icon: "📂",
        okText: tr("ctx.moveDialogOk", "Move"),
        emptyMsg: tr("ctx.emptyMoveRoot", "❌ Configure a storage path first"),
      }, ctx.rtype);
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { MoveModelFile } = await getApp();
      await MoveModelFile(ctx.path || "", dstDir);
      toast(tr("ctx.fileMoveOk", "✅ Moved to {folder}", { folder }), TOAST_MS.normal);
      refreshUI();
    } catch (e) {
      toastError(e, tr("ctx.moveFail", "Move failed"));
    }
  },
  "file.copy": async (ctx) => {
    try {
      const resolved = await resolveDstDir({
        title: tr("ctx.copyDialogTitle", "Copy to Folder"),
        icon: "📋",
        okText: tr("ctx.copyDialogOk", "Copy"),
        emptyMsg: tr("ctx.emptyCopyRoot", "❌ Configure a repository directory first"),
      }, ctx.rtype);
      if (!resolved) return;
      const { folder, dstDir } = resolved;
      const { CopyModelFile } = await getApp();
      await CopyModelFile(ctx.path || "", dstDir);
      toast(tr("ctx.fileCopyOk", "✅ Copied to {folder}", { folder }), TOAST_MS.normal);
      refreshUI();
    } catch (e) {
      toastError(e, tr("ctx.copyFail", "Copy failed"));
    }
  },
  "file.push-to-pack": async (ctx) => {
    try {
      const { LoadAppConfig, ListVersionInstances, InstallModelTo } = await getApp();
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      if (!mcRoot) {
        toast(tr("ctx.pushNoMcRoot", "Configure the game directory first"), TOAST_MS.success, "warn");
        return;
      }
      const instances = (await ListVersionInstances(mcRoot)) ?? [];
      if (!instances.length) {
        toast(tr("ctx.pushNoInstances", "No packs found"), TOAST_MS.success, "warn");
        return;
      }
      const names = instances.map((i) => i.Name);
      const chosen = await modalSelect({
        title: tr("ctx.pushDialogTitle", "Push to Pack"),
        icon: "📦",
        items: names,
        okText: tr("ctx.pushOkText", "📦 Push"),
      });
      if (!chosen) return;
      const match = instances.find((i) => i.Name === chosen);
      if (!match) return;
      try {
        await InstallModelTo(ctx.path || "", match.CustomDir);
        toast(tr("ctx.pushOk", "✅ Pushed to {pack}", { pack: chosen }), TOAST_MS.success);
      } catch (e) {
        toastError(e, tr("ctx.pushFail", "Push failed"));
      }
    } catch (e) {
      toastError(e, tr("ctx.pushFail", "Push failed"));
    }
  },
  "file.edit-tags": async (ctx) => {
    try {
      const result = await modalTagEditor(ctx.path || "");
      if (result) toast(tr("ctx.tagsSaved", "🏷️ Saved {n} tags", { n: result.length }), TOAST_MS.success);
    } catch (e) {
      toastError(e, tr("ctx.tagsFail", "Failed to edit tags"));
    }
  },
  "file.recycle": async (ctx) => {
    try {
      const ok2 = await modalConfirm({
        title: tr("ctx.fileRecycleTitle", "Recycle"),
        icon: "♻️",
        message: tr("ctx.fileRecycleConfirm", "Move {name} to recycle bin?", {
          name: (ctx.path || "").split(/[/\\]/).pop() || "",
        }),
        okText: tr("ctx.recycleOkText", "♻️ Recycle"),
        danger: true,
      });
      if (!ok2) return;
      const { MoveToRecycle } = await getApp();
      try {
        await MoveToRecycle(ctx.path || "");
        refreshUI();
      } catch (e) {
        toastError(e, tr("ctx.recycleFail", "Failed to recycle"));
      }
    } catch (e) {
      toastError(e, tr("ctx.recycleFail", "Failed to recycle"));
    }
  },
  "file.reveal": async (ctx) => {
    try {
      const { RevealInExplorer } = await getApp();
      await RevealInExplorer(ctx.path || "");
    } catch (e) {
      toastError(e, tr("ctx.revealFail", "Failed to open"));
    }
  },
  "file.copy-path": async (ctx) => {
    // 复用 utils/dom/clipboard.ts copyText（Clipboard API + textarea fallback），
    // 与 batch.copy-paths 同一实现——不再手写 navigator/textarea 双路径
    const ok = await copyText(ctx.path || "");
    toast(
      ok ? tr("ctx.copyPathOk", "✅ Path copied to clipboard") : tr("ctx.copyPathFail", "❌ Copy failed, please copy the path manually"),
      ok ? TOAST_MS.success : TOAST_MS.normal,
      ok ? undefined : "error",
    );
  },
};
